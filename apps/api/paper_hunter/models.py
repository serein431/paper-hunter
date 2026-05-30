from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, Field

EvidenceType = Literal[
    "figure_similarity",
    "image_clone",
    "western_blot_anomaly",
    "citation_not_found",
    "citation_mismatch",
    "citation_not_supporting_claim",
    "retracted_reference",
    "data_anomaly",
    "paper_mill_signal",
    "hidden_prompt",
    "metadata_anomaly",
]

Severity = Literal["low", "medium", "high", "critical"]
ReviewStatus = Literal[
    "pending",
    "confirmed",
    "rejected",
    "needs_original_data",
    "escalated",
    "resolved",
]
TaskStatus = Literal["queued", "running", "completed", "failed"]


def utc_now() -> datetime:
    return datetime.now(UTC)


class ArtifactRef(BaseModel):
    artifact_id: str
    kind: str
    path: str
    url: str | None = None


class ExtractedImage(BaseModel):
    image_id: str
    task_id: str
    page: int
    index: int
    width: int
    height: int
    checksum: str
    artifact_id: str
    path: str
    extraction_method: str = "pymupdf-xref"


class ReferenceCheck(BaseModel):
    reference_id: str
    task_id: str
    raw_doi: str
    normalized_doi: str
    status: Literal["unchecked", "found", "not_found", "network_error", "demo_fallback"]
    title: str | None = None
    source: str = "crossref"
    checked_at: datetime = Field(default_factory=utc_now)


class EvidenceCard(BaseModel):
    evidence_id: str
    task_id: str
    type: EvidenceType
    severity: Severity
    confidence: float = Field(ge=0.0, le=1.0)
    title: str
    claim: str
    method: str
    location: str
    recommended_action: str
    visual_assets: dict[str, str] = Field(default_factory=dict)
    review_status: ReviewStatus = "pending"
    reviewer_note: str = ""
    algorithm_version: str = "paper-hunter-mvp-0.1"
    created_at: datetime = Field(default_factory=utc_now)


class AnalysisTask(BaseModel):
    task_id: str
    source_label: str
    file_name: str
    status: TaskStatus = "queued"
    current_step: str = "queued"
    risk_score: int = 0
    evidence_count: int = 0
    image_count: int = 0
    reference_count: int = 0
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
    error: str | None = None


class ReportResult(BaseModel):
    task_id: str
    markdown: str
    artifact_id: str | None = None
    created_at: datetime = Field(default_factory=utc_now)


class AnalysisResult(BaseModel):
    task: AnalysisTask
    images: list[ExtractedImage] = Field(default_factory=list)
    references: list[ReferenceCheck] = Field(default_factory=list)
    evidence: list[EvidenceCard] = Field(default_factory=list)
    report_markdown: str
