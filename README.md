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

More detailed run commands are added as the implementation lands.

## Safety Language

Reports must use cautious language such as:

- "系统发现疑似异常".
- "该疑点需要结合原始数据进一步复核".
- "当前证据不足以支持最终结论".
- "本报告仅用于初筛和复核辅助".

Reports must avoid final-judgment phrases such as "该论文造假", "作者伪造数据", "实锤", "学术不端已成立", and "必须撤稿".
