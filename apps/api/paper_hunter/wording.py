from __future__ import annotations

BANNED_FINAL_JUDGMENT_PHRASES = (
    "该论文造假",
    "作者伪造数据",
    "实锤",
    "学术不端已成立",
    "必须撤稿",
)


def assert_safe_report_text(text: str) -> None:
    """Reject final-judgment language that the product must never emit."""
    for phrase in BANNED_FINAL_JUDGMENT_PHRASES:
        if phrase in text:
            raise ValueError(f"Unsafe final-judgment wording detected: {phrase}")
