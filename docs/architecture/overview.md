# Architecture Overview

Paper Hunter is a single-user hackathon web app with a real analysis pipeline.

```text
Next.js Workbench
  -> FastAPI API
    -> AnalysisOrchestrator
      -> PDFParser
      -> FigureForensics
      -> CitationVerifier
      -> HiddenPromptScanner
      -> ReportGenerator
    -> local storage artifacts
```

The MVP keeps infrastructure deliberately small. PostgreSQL, Redis, object storage, workers, and RBAC are roadmap items, not required for the five-minute demo.

## Data Flow

1. A PDF is uploaded or generated from the synthetic sample.
2. The API stores the file under `storage/uploads/{task_id}/`.
3. The parser extracts text and image candidates.
4. The forensics module compares extracted images pairwise.
5. Text helpers extract DOI-like strings and hidden prompt signals.
6. Evidence cards are built from the signals.
7. The report generator produces Markdown.
8. The frontend displays dashboard, evidence, image review, citation checks, and report tabs.

## Safety Boundary

The system outputs evidence cards, not verdicts. User-facing text must keep "疑似异常" and "需人工复核" framing.
