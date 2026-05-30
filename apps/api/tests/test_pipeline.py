from scripts.generate_synthetic_sample import build_synthetic_pdf

from paper_hunter.orchestrator import AnalysisOrchestrator
from paper_hunter.wording import assert_safe_report_text


def test_orchestrator_analyzes_synthetic_pdf(tmp_path):
    pdf_path = build_synthetic_pdf(tmp_path)
    orchestrator = AnalysisOrchestrator(storage_root=tmp_path / "storage")

    result = orchestrator.analyze_pdf(pdf_path, source_label="Synthetic paper")

    assert result.task.status == "completed"
    assert result.images
    assert result.evidence
    assert any(card.type == "figure_similarity" for card in result.evidence)
    assert any(card.type == "hidden_prompt" for card in result.evidence)
    assert result.references
    assert "本报告仅用于初筛和复核辅助" in result.report_markdown
    assert_safe_report_text(result.report_markdown)
