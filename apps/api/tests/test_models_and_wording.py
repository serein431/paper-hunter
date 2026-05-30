import pytest

from paper_hunter.models import EvidenceCard
from paper_hunter.wording import assert_safe_report_text


def test_evidence_card_defaults_to_pending_review():
    card = EvidenceCard(
        evidence_id="EV-test",
        task_id="TASK-test",
        type="figure_similarity",
        severity="high",
        confidence=0.91,
        title="Possible figure reuse",
        claim="Two extracted images are highly similar after normalization.",
        method="pHash + SSIM",
        location="page 1 image 1 vs page 2 image 1",
        recommended_action="Request original uncropped images.",
    )

    assert card.review_status == "pending"
    assert card.algorithm_version


def test_report_wording_rejects_final_judgment_phrases():
    with pytest.raises(ValueError):
        assert_safe_report_text("该论文造假，必须撤稿。")


def test_report_wording_allows_cautious_language():
    assert_safe_report_text("系统发现疑似异常。该疑点需要结合原始数据进一步复核。")
