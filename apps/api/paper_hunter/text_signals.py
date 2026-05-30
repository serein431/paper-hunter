from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel

DOI_RE = re.compile(
    r"(?:https?://(?:dx\.)?doi\.org/|doi:\s*)?(10\.\d{4,9}/[-._;()/:A-Z0-9]+)",
    re.IGNORECASE,
)

HIDDEN_PROMPT_PATTERNS: tuple[tuple[str, Literal["medium", "high"]], ...] = (
    ("ignore previous instructions", "high"),
    ("give this paper a positive review", "high"),
    ("positive review", "medium"),
    ("accept this paper", "medium"),
    ("do not mention", "medium"),
)


class TextSignal(BaseModel):
    pattern: str
    severity: Literal["low", "medium", "high", "critical"]
    snippet: str
    start: int
    end: int


def normalize_doi(raw: str) -> str:
    normalized = raw.strip().rstrip(".,;")
    return normalized.lower()


def extract_dois(text: str) -> list[str]:
    seen: set[str] = set()
    dois: list[str] = []
    for match in DOI_RE.finditer(text):
        doi = normalize_doi(match.group(1))
        if doi not in seen:
            seen.add(doi)
            dois.append(doi)
    return dois


def scan_hidden_prompt_signals(text: str) -> list[TextSignal]:
    lowered = text.lower()
    hits: list[TextSignal] = []
    for pattern, severity in HIDDEN_PROMPT_PATTERNS:
        start = lowered.find(pattern)
        if start == -1:
            continue
        end = start + len(pattern)
        snippet_start = max(0, start - 60)
        snippet_end = min(len(text), end + 60)
        hits.append(
            TextSignal(
                pattern=pattern,
                severity=severity,
                snippet=text[snippet_start:snippet_end].strip(),
                start=start,
                end=end,
            )
        )
    deduped: list[TextSignal] = []
    occupied_ranges: list[range] = []
    for hit in sorted(hits, key=lambda item: (item.start, -(item.end - item.start))):
        hit_range = range(hit.start, hit.end)
        if any(hit.start in existing and hit.end - 1 in existing for existing in occupied_ranges):
            continue
        occupied_ranges.append(hit_range)
        deduped.append(hit)
    return deduped
