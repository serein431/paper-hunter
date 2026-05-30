from __future__ import annotations

import shutil
import uuid
from itertools import combinations
from pathlib import Path

from paper_hunter.figure_forensics import (
    compare_images,
    write_difference_image,
    write_side_by_side_image,
)
from paper_hunter.models import AnalysisResult, AnalysisTask, EvidenceCard, ReferenceCheck
from paper_hunter.pdf_parser import PDFParser
from paper_hunter.reporting import generate_report
from paper_hunter.text_signals import extract_dois, scan_hidden_prompt_signals


class AnalysisOrchestrator:
    def __init__(self, storage_root: Path | str = "storage"):
        self.storage_root = Path(storage_root)
        self.upload_root = self.storage_root / "uploads"
        self.artifact_root = self.storage_root / "artifacts"
        self.upload_root.mkdir(parents=True, exist_ok=True)
        self.artifact_root.mkdir(parents=True, exist_ok=True)

    def analyze_pdf(self, pdf_path: Path | str, source_label: str | None = None) -> AnalysisResult:
        source_path = Path(pdf_path)
        task_id = f"TASK-{uuid.uuid4().hex[:10]}"
        task_upload_dir = self.upload_root / task_id
        task_upload_dir.mkdir(parents=True, exist_ok=True)
        stored_pdf = task_upload_dir / "source.pdf"
        if source_path.resolve() != stored_pdf.resolve():
            shutil.copyfile(source_path, stored_pdf)

        task = AnalysisTask(
            task_id=task_id,
            source_label=source_label or source_path.stem,
            file_name=source_path.name,
            status="running",
            current_step="pdf_parsing",
        )
        parser = PDFParser(self.artifact_root)
        parsed = parser.parse(stored_pdf, task_id)
        evidence: list[EvidenceCard] = []
        references = self._verify_references(task_id, parsed.full_text)

        task.current_step = "figure_forensics"
        evidence.extend(self._build_figure_evidence(task_id, parsed.images))

        task.current_step = "hidden_prompt_scan"
        evidence.extend(self._build_hidden_prompt_evidence(task_id, parsed.full_text))

        task.status = "completed"
        task.current_step = "report_generated"
        task.image_count = len(parsed.images)
        task.reference_count = len(references)
        task.evidence_count = len(evidence)
        task.risk_score = self._risk_score(evidence)

        report_markdown = generate_report(task, evidence, references)
        report_path = self.artifact_root / task_id / "report.md"
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(report_markdown, encoding="utf-8")

        return AnalysisResult(
            task=task,
            images=parsed.images,
            references=references,
            evidence=evidence,
            report_markdown=report_markdown,
        )

    def _build_figure_evidence(self, task_id: str, images) -> list[EvidenceCard]:
        evidence: list[EvidenceCard] = []
        comparison_dir = self.artifact_root / task_id / "comparisons"
        comparison_dir.mkdir(parents=True, exist_ok=True)
        evidence_index = 1
        for source, target in combinations(images, 2):
            score = compare_images(source.path, target.path)
            if score.confidence < 0.90:
                continue
            comparison_path = comparison_dir / f"EV-{evidence_index:03d}-side-by-side.png"
            heatmap_path = comparison_dir / f"EV-{evidence_index:03d}-difference.png"
            write_side_by_side_image(source.path, target.path, comparison_path)
            write_difference_image(source.path, target.path, heatmap_path)
            severity = "high" if score.confidence >= 0.94 else "medium"
            evidence.append(
                EvidenceCard(
                    evidence_id=f"EV-{task_id}-{evidence_index:03d}",
                    task_id=task_id,
                    type="figure_similarity",
                    severity=severity,
                    confidence=score.confidence,
                    title="Possible reused figure region",
                    claim=(
                        "Two extracted image candidates are highly similar after normalization. "
                        "This signal needs manual comparison against original source data."
                    ),
                    method=score.method,
                    location=(
                        f"page {source.page} image {source.index} vs "
                        f"page {target.page} image {target.index}"
                    ),
                    recommended_action="Request original uncropped images and experiment records.",
                    visual_assets={
                        "source_image": source.artifact_id,
                        "target_image": target.artifact_id,
                        "comparison_image": f"{task_id}/comparisons/{comparison_path.name}",
                        "heatmap": f"{task_id}/comparisons/{heatmap_path.name}",
                    },
                )
            )
            evidence_index += 1
        return evidence

    def _build_hidden_prompt_evidence(self, task_id: str, text: str) -> list[EvidenceCard]:
        cards: list[EvidenceCard] = []
        for index, signal in enumerate(scan_hidden_prompt_signals(text), start=1):
            cards.append(
                EvidenceCard(
                    evidence_id=f"EV-{task_id}-HP-{index:03d}",
                    task_id=task_id,
                    type="hidden_prompt",
                    severity=signal.severity,
                    confidence=0.88 if signal.severity == "high" else 0.64,
                    title="Possible hidden AI-review instruction",
                    claim=f"Extracted PDF text contains the phrase '{signal.pattern}'.",
                    method="PyMuPDF text extraction + prompt-pattern scan",
                    location=f"text offset {signal.start}-{signal.end}",
                    recommended_action="Inspect the PDF text layer and ask for a clean submission file.",
                )
            )
        return cards

    def _verify_references(self, task_id: str, text: str) -> list[ReferenceCheck]:
        checks: list[ReferenceCheck] = []
        for index, doi in enumerate(extract_dois(text), start=1):
            if doi.startswith("10.5555/"):
                status = "not_found"
                title = None
            else:
                status = "demo_fallback"
                title = "Metadata check queued or cached for demo"
            checks.append(
                ReferenceCheck(
                    reference_id=f"REF-{task_id}-{index:03d}",
                    task_id=task_id,
                    raw_doi=doi,
                    normalized_doi=doi,
                    status=status,
                    title=title,
                )
            )
        return checks

    def _risk_score(self, evidence: list[EvidenceCard]) -> int:
        weights = {"low": 8, "medium": 18, "high": 32, "critical": 45}
        return min(100, sum(weights[card.severity] for card in evidence))
