from __future__ import annotations

import os
from pathlib import Path
from typing import Annotated

import httpx
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
from paper_hunter.models import (
    AnalysisResult,
    EvidenceCard,
    ModelReview,
    ReferenceCheck,
    ReviewStatus,
)
from paper_hunter.orchestrator import AnalysisOrchestrator
from paper_hunter.synthetic_sample import build_synthetic_pdf
from paper_hunter.wording import assert_safe_report_text

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
    provider: str = "deepseek"
    display_name: str = "DeepSeek"
    base_url: str = "https://api.deepseek.com/v1"
    model: str = "deepseek-chat"
    api_key: str = ""
    temperature: float = Field(default=0.2, ge=0.0, le=2.0)
    use_for: list[str] = Field(default_factory=lambda: ["证据解释", "风险摘要", "报告润色"])


class ModelRuntimeConfig(BaseModel):
    provider: str
    display_name: str
    base_url: str
    model: str
    api_key_configured: bool
    temperature: float
    use_for: list[str]
    status: str


def configured_model_secret() -> str:
    return (
        MODEL_SECRET_CACHE.get("review_model")
        or os.environ.get("PAPER_HUNTER_MODEL_API_KEY", "").strip()
        or os.environ.get("DEEPSEEK_API_KEY", "").strip()
    )


def initial_model_config() -> ModelRuntimeConfig:
    provider = os.environ.get("PAPER_HUNTER_MODEL_PROVIDER", "deepseek")
    base_url = os.environ.get("PAPER_HUNTER_MODEL_BASE_URL", "https://api.deepseek.com/v1")
    model = os.environ.get("PAPER_HUNTER_MODEL_NAME", "deepseek-chat")
    display_name = os.environ.get("PAPER_HUNTER_MODEL_DISPLAY_NAME", "DeepSeek")
    api_key_configured = bool(configured_model_secret())
    return ModelRuntimeConfig(
        provider=provider,
        display_name=display_name,
        base_url=base_url.rstrip("/"),
        model=model,
        api_key_configured=api_key_configured,
        temperature=float(os.environ.get("PAPER_HUNTER_MODEL_TEMPERATURE", "0.2")),
        use_for=["证据解释", "风险摘要", "报告润色"],
        status="configured" if api_key_configured else "waiting_for_api_key",
    )


MODEL_CONFIG = initial_model_config()


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
    api_key_configured = bool(cleaned_key or configured_model_secret())
    MODEL_CONFIG = ModelRuntimeConfig(
        provider=config.provider,
        display_name=config.display_name,
        base_url=str(config.base_url).rstrip("/"),
        model=config.model,
        api_key_configured=api_key_configured,
        temperature=config.temperature,
        use_for=config.use_for,
        status="configured" if api_key_configured else "waiting_for_api_key",
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
    result = await attach_model_review(result)
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


async def attach_model_review(result: AnalysisResult) -> AnalysisResult:
    secret = configured_model_secret()
    if not secret:
        result.model_review = ModelReview(
            provider=MODEL_CONFIG.provider,
            model=MODEL_CONFIG.model,
            status="skipped",
            summary="模型辅助未启用：请先配置 API Key。确定性扫描、证据卡和报告仍可正常生成。",
        )
        result.report_markdown = append_model_review_to_report(
            result.report_markdown,
            result.model_review,
        )
        return result

    try:
        review = await request_model_review(
            api_key=secret,
            base_url=MODEL_CONFIG.base_url,
            model=MODEL_CONFIG.model,
            provider=MODEL_CONFIG.provider,
            temperature=MODEL_CONFIG.temperature,
            evidence=result.evidence,
            references=result.references,
            risk_score=result.task.risk_score,
        )
    except Exception as exc:  # noqa: BLE001 - model failures should not break deterministic scanning.
        review = ModelReview(
            provider=MODEL_CONFIG.provider,
            model=MODEL_CONFIG.model,
            status="failed",
            summary="模型辅助调用失败。确定性扫描、证据卡和报告已正常生成。",
            error=str(exc)[:240],
        )

    result.model_review = review
    result.report_markdown = append_model_review_to_report(result.report_markdown, review)
    return result


async def request_model_review(
    *,
    api_key: str,
    base_url: str,
    model: str,
    provider: str,
    temperature: float,
    evidence: list[EvidenceCard],
    references: list[ReferenceCheck],
    risk_score: int,
) -> ModelReview:
    evidence_lines = [
        (
            f"- {card.type} / {card.severity} / confidence={card.confidence:.2f}: "
            f"{card.title}; location={card.location}; action={card.recommended_action}"
        )
        for card in evidence[:8]
    ] or ["- 当前未生成疑点证据卡。"]
    reference_lines = [
        f"- {reference.normalized_doi}: {reference.status}"
        for reference in references[:8]
    ] or ["- 当前未抽取到 DOI 信号。"]
    prompt = "\n".join(
        [
            "你是 Paper Hunter 的科研诚信复核助手。",
            "请基于下列确定性扫描结果，输出中文、克制、可复核的摘要。",
            "禁止下最终判决，禁止使用“实锤”“该论文造假”“必须撤稿”等措辞。",
            "格式：三句话以内，说明风险重点、需要复核的材料、当前边界。",
            f"风险分：{risk_score}",
            "证据卡：",
            *evidence_lines,
            "引用检查：",
            *reference_lines,
        ]
    )
    url = f"{base_url.rstrip('/')}/chat/completions"
    async with httpx.AsyncClient(timeout=12) as client:
        response = await client.post(
            url,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": model,
                "messages": [
                    {
                        "role": "system",
                        "content": "你只输出谨慎的科研诚信复核辅助意见，不做最终定性。",
                    },
                    {"role": "user", "content": prompt},
                ],
                "temperature": temperature,
                "max_tokens": 360,
            },
        )
        response.raise_for_status()
        payload = response.json()
    summary = payload["choices"][0]["message"]["content"].strip()
    assert_safe_report_text(summary)
    return ModelReview(provider=provider, model=model, status="completed", summary=summary)


def append_model_review_to_report(report: str, review: ModelReview) -> str:
    model_lines = [
        "",
        "## Model-Assisted Review",
        "",
        f"- Provider: `{review.provider}`",
        f"- Model: `{review.model}`",
        f"- Status: `{review.status}`",
        f"- Summary: {review.summary}",
    ]
    if review.error:
        model_lines.append(f"- Error: {review.error}")
    updated_report = report.rstrip() + "\n" + "\n".join(model_lines) + "\n"
    assert_safe_report_text(updated_report)
    return updated_report
