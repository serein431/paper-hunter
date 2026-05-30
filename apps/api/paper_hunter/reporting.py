from __future__ import annotations

from collections import Counter

from paper_hunter.models import AnalysisTask, EvidenceCard, ReferenceCheck
from paper_hunter.wording import assert_safe_report_text

DISCLAIMER = (
    "本报告仅用于初筛和复核辅助。系统发现的是疑似异常，不构成最终学术不端结论；"
    "最终判断需要结合原始数据、作者解释、同行专家和机构调查。"
)


def _severity_label(severity: str) -> str:
    return {
        "low": "Low",
        "medium": "Medium",
        "high": "High",
        "critical": "Critical",
    }.get(severity, severity)


def generate_report(
    task: AnalysisTask,
    evidence: list[EvidenceCard],
    references: list[ReferenceCheck],
) -> str:
    evidence_counts = Counter(card.type for card in evidence)
    severity_counts = Counter(card.severity for card in evidence)
    lines = [
        f"# Paper Hunter Evidence Report: {task.source_label}",
        "",
        "## Scope",
        "",
        "This report summarizes suspicious signals found by the Paper Hunter MVP pipeline.",
        "It prioritizes reproducible evidence cards and cautious human-review recommendations.",
        "",
        "## Overall Summary",
        "",
        f"- Task ID: `{task.task_id}`",
        f"- File: `{task.file_name}`",
        f"- Extracted images: {task.image_count}",
        f"- DOI-like references: {task.reference_count}",
        f"- Evidence cards: {len(evidence)}",
        f"- Risk score: {task.risk_score}",
        "",
        "## Evidence Type Counts",
        "",
    ]
    if evidence_counts:
        lines.extend(f"- {evidence_type}: {count}" for evidence_type, count in evidence_counts.items())
    else:
        lines.append("- No suspicious evidence cards were generated.")

    lines.extend(["", "## Severity Counts", ""])
    if severity_counts:
        lines.extend(f"- {_severity_label(severity)}: {count}" for severity, count in severity_counts.items())
    else:
        lines.append("- No severity counts.")

    lines.extend(["", "## Evidence Cards", ""])
    for card in evidence:
        lines.extend(
            [
                f"### {card.evidence_id}: {card.title}",
                "",
                f"- Type: `{card.type}`",
                f"- Severity: `{card.severity}`",
                f"- Confidence: {card.confidence:.2f}",
                f"- Location: {card.location}",
                f"- Method: {card.method}",
                f"- Claim: {card.claim}",
                f"- Review status: `{card.review_status}`",
                f"- Recommended action: {card.recommended_action}",
                "",
            ]
        )

    lines.extend(["## Citation Checks", ""])
    if references:
        for reference in references:
            lines.append(
                f"- `{reference.normalized_doi}`: {reference.status}"
                + (f" ({reference.title})" if reference.title else "")
            )
    else:
        lines.append("- No DOI-like references were extracted.")

    lines.extend(
        [
            "",
            "## Method Notes",
            "",
            "- PDF text and embedded images are extracted with PyMuPDF.",
            "- Image candidates are compared with perceptual hash and normalized pixel difference.",
            "- DOI checks use live or demo-safe verification depending on network and sample context.",
            "- Hidden AI-review instruction patterns are treated as risk signals only.",
            "",
            "## Disclaimer",
            "",
            DISCLAIMER,
            "",
        ]
    )
    report = "\n".join(lines)
    assert_safe_report_text(report)
    return report
