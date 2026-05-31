from __future__ import annotations

import os
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from paper_hunter.knowledge_bases import (
    KnowledgeBaseConnector,
    KnowledgeSearchResponse,
    list_connectors,
    search_knowledge_bases,
)
from paper_hunter.models import AnalysisResult, ReviewStatus
from paper_hunter.orchestrator import AnalysisOrchestrator
from paper_hunter.synthetic_sample import build_synthetic_pdf

app = FastAPI(title="Paper Hunter API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

TASKS: dict[str, AnalysisResult] = {}
MODEL_SECRET_CACHE: dict[str, str] = {}


class SampleCase(BaseModel):
    id: str
    name: str
    description: str
    source_type: str


class SamplesResponse(BaseModel):
    samples: list[SampleCase]


class ReviewPatch(BaseModel):
    review_status: ReviewStatus
    reviewer_note: str = ""


class ModelRuntimeConfigIn(BaseModel):
    provider: str = "openai-compatible"
    display_name: str = "OpenAI-compatible model"
    base_url: str = "https://api.openai.com/v1"
    model: str = "paper-reviewer-model"
    api_key: str = ""
    temperature: float = Field(default=0.2, ge=0.0, le=2.0)
    use_for: list[str] = Field(default_factory=lambda: ["证据解释", "引用核验", "报告润色"])


class ModelRuntimeConfig(BaseModel):
    provider: str
    display_name: str
    base_url: str
    model: str
    api_key_configured: bool
    temperature: float
    use_for: list[str]
    status: str


MODEL_CONFIG = ModelRuntimeConfig(
    provider="openai-compatible",
    display_name="OpenAI-compatible model",
    base_url="https://api.openai.com/v1",
    model="paper-reviewer-model",
    api_key_configured=False,
    temperature=0.2,
    use_for=["证据解释", "引用核验", "报告润色"],
    status="waiting_for_user_model",
)


class KnowledgeBasesResponse(BaseModel):
    connectors: list[KnowledgeBaseConnector]


def storage_root() -> Path:
    default_root = "/tmp/paper-hunter-storage" if os.environ.get("VERCEL") else "storage"
    return Path(os.environ.get("PAPER_HUNTER_STORAGE", default_root))


def samples() -> list[SampleCase]:
    return [
        SampleCase(
            id="synthetic-paper",
            name="Synthetic integrity review sample",
            description=(
                "Generated PDF with controlled duplicate-image, DOI, "
                "and hidden prompt signals."
            ),
            source_type="generated",
        ),
        SampleCase(
            id="private-real-case",
            name="Private public-case PDF",
            description=(
                "Optional local-only case. Place a PDF in storage/samples/private; "
                "the repository does not redistribute real paper PDFs."
            ),
            source_type="private",
        ),
    ]


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "paper-hunter-api"}


@app.get("/api/model-config", response_model=ModelRuntimeConfig)
def get_model_config() -> ModelRuntimeConfig:
    return MODEL_CONFIG


@app.post("/api/model-config", response_model=ModelRuntimeConfig)
def update_model_config(config: ModelRuntimeConfigIn) -> ModelRuntimeConfig:
    global MODEL_CONFIG
    cleaned_key = config.api_key.strip()
    if cleaned_key:
        MODEL_SECRET_CACHE["review_model"] = cleaned_key
    MODEL_CONFIG = ModelRuntimeConfig(
        provider=config.provider,
        display_name=config.display_name,
        base_url=str(config.base_url).rstrip("/"),
        model=config.model,
        api_key_configured=bool(cleaned_key or MODEL_SECRET_CACHE.get("review_model")),
        temperature=config.temperature,
        use_for=config.use_for,
        status="configured",
    )
    return MODEL_CONFIG


@app.get("/api/knowledge-bases", response_model=KnowledgeBasesResponse)
def get_knowledge_bases() -> KnowledgeBasesResponse:
    return KnowledgeBasesResponse(connectors=list_connectors())


@app.get("/api/knowledge-search", response_model=KnowledgeSearchResponse)
async def knowledge_search(query: str, limit: int = 8) -> KnowledgeSearchResponse:
    if not query.strip():
        raise HTTPException(status_code=400, detail="Provide a query.")
    return await search_knowledge_bases(query.strip(), limit=limit)


@app.get("/api/samples", response_model=SamplesResponse)
def list_samples() -> SamplesResponse:
    return SamplesResponse(samples=samples())


@app.post("/api/tasks", response_model=AnalysisResult)
async def create_task(
    sample_id: Annotated[str | None, Form()] = None,
    file: Annotated[UploadFile | None, File()] = None,
) -> AnalysisResult:
    root = storage_root()
    if sample_id:
        pdf_path = resolve_sample_pdf(sample_id, root)
        result = AnalysisOrchestrator(root).analyze_pdf(pdf_path, source_label=sample_id)
    elif file is not None:
        upload_dir = root / "uploads" / "incoming"
        upload_dir.mkdir(parents=True, exist_ok=True)
        upload_path = upload_dir / safe_upload_name(file.filename or "uploaded.pdf")
        upload_path.write_bytes(await file.read())
        result = AnalysisOrchestrator(root).analyze_pdf(upload_path, source_label=file.filename)
    else:
        raise HTTPException(status_code=400, detail="Provide sample_id or PDF file.")
    TASKS[result.task.task_id] = result
    return result


@app.get("/api/tasks/{task_id}", response_model=AnalysisResult)
def get_task(task_id: str) -> AnalysisResult:
    if task_id not in TASKS:
        raise HTTPException(status_code=404, detail="Task not found.")
    return TASKS[task_id]


@app.get("/api/tasks/{task_id}/evidence")
def get_task_evidence(task_id: str) -> dict[str, object]:
    result = get_task(task_id)
    return {"task_id": task_id, "evidence": result.evidence}


@app.get("/api/tasks/{task_id}/report")
def get_task_report(task_id: str) -> dict[str, str]:
    result = get_task(task_id)
    return {"task_id": task_id, "markdown": result.report_markdown}


@app.patch("/api/evidence/{evidence_id}", response_model=AnalysisResult)
def update_evidence(evidence_id: str, patch: ReviewPatch) -> AnalysisResult:
    for task_id, result in TASKS.items():
        for index, card in enumerate(result.evidence):
            if card.evidence_id == evidence_id:
                updated = card.model_copy(
                    update={
                        "review_status": patch.review_status,
                        "reviewer_note": patch.reviewer_note,
                    }
                )
                result.evidence[index] = updated
                TASKS[task_id] = result
                return result
    raise HTTPException(status_code=404, detail="Evidence not found.")


@app.get("/api/artifacts/{artifact_path:path}")
def get_artifact(artifact_path: str) -> FileResponse:
    path = (storage_root() / "artifacts" / artifact_path).resolve()
    artifact_root = (storage_root() / "artifacts").resolve()
    if artifact_root not in path.parents and path != artifact_root:
        raise HTTPException(status_code=400, detail="Invalid artifact path.")
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="Artifact not found.")
    return FileResponse(path)


def resolve_sample_pdf(sample_id: str, root: Path) -> Path:
    if sample_id == "synthetic-paper":
        return build_synthetic_pdf(root / "samples" / "synthetic")
    if sample_id == "private-real-case":
        private_dir = root / "samples" / "private"
        candidates = sorted(private_dir.glob("*.pdf"))
        if not candidates:
            raise HTTPException(
                status_code=404,
                detail="No private real-case PDF found under storage/samples/private.",
            )
        return candidates[0]
    raise HTTPException(status_code=404, detail=f"Unknown sample id: {sample_id}")


def safe_upload_name(name: str) -> str:
    cleaned = "".join(char if char.isalnum() or char in ".-_" else "-" for char in name)
    return cleaned if cleaned.lower().endswith(".pdf") else f"{cleaned}.pdf"
