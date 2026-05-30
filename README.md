# Paper Hunter / 论文打假人

Paper Hunter is a hackathon MVP for research-integrity evidence discovery. It uploads or launches a paper PDF, extracts image and text signals, creates reviewable evidence cards, and generates a cautious Markdown report.

The product does not decide that a paper or author committed misconduct. It finds suspicious signals that need human review, original data, and institutional process.

## MVP

- PDF upload and synthetic sample launch.
- PyMuPDF-based PDF text and image extraction.
- Figure similarity checks using perceptual hash and image-difference scoring.
- DOI extraction and Crossref-style verification with demo-safe fallback.
- Hidden AI-review prompt signal scanning.
- Evidence cards with severity, confidence, method, location, and recommended action.
- Markdown report export and browser print/save-as-PDF.
- Single-user local workflow plus public demo deployment path.

## Public Case Boundary

The real-case story may reference the public Nature article `Human HDAC6 senses valine abundancy to regulate DNA damage`, DOI `10.1038/s41586-024-08248-5`, using the public article page and related public notes as source links.

The repository must not redistribute copyrighted full-text PDFs. If a local demo uses a real PDF, place it under `storage/samples/private/`; that folder is ignored by git.

## Local Development

The implementation is intentionally lightweight:

- API: FastAPI under `apps/api`.
- Web: Next.js under `apps/web`.
- Storage: local `storage/`.
- Python environment: `uv`.
- Node package manager: `pnpm`.

Install dependencies:

```bash
uv sync --python 3.11
pnpm install
```

Run tests and build:

```bash
uv run --python 3.11 pytest -q
pnpm --filter @paper-hunter/web build
```

Start the local demo:

```bash
./scripts/dev.sh
```

Open [http://localhost:3000](http://localhost:3000). The Next.js app proxies `/api/*` to the FastAPI service on `127.0.0.1:8000`.

Generate the synthetic sample manually:

```bash
uv run --python 3.11 python scripts/generate_synthetic_sample.py
```

## Demo Flow

1. Open the workbench.
2. Click `Synthetic integrity review sample`.
3. Inspect the dashboard risk score and evidence counts.
4. Open `证据中心` and review the figure-similarity and hidden-prompt cards.
5. Open `图像复核` and inspect the side-by-side comparison and difference map.
6. Open `引用核验` to view DOI extraction results.
7. Open `报告导出` and use `Save as PDF`.

## Cloud Demo

The app can be deployed as a single container. The container runs FastAPI on `127.0.0.1:8000`, Next.js on port `3000`, and uses local ephemeral `storage/` for uploads and artifacts.

```bash
docker build -t paper-hunter .
docker run --rm -p 3000:3000 paper-hunter
```

For Railway, Render, or Fly.io, expose port `3000`. Do not mount or publish `storage/samples/private` unless you intentionally need a local-only real-case demo.

## Safety Language

Reports must use cautious language such as:

- "系统发现疑似异常".
- "该疑点需要结合原始数据进一步复核".
- "当前证据不足以支持最终结论".
- "本报告仅用于初筛和复核辅助".

Reports must avoid final-judgment phrases such as "该论文造假", "作者伪造数据", "实锤", "学术不端已成立", and "必须撤稿".
