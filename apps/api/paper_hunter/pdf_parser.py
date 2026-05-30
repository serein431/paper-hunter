from __future__ import annotations

import io
from pathlib import Path

import fitz
from PIL import Image
from pydantic import BaseModel, Field

from paper_hunter.figure_forensics import checksum_file
from paper_hunter.models import ExtractedImage


class ParsedPdf(BaseModel):
    task_id: str
    text_by_page: list[str] = Field(default_factory=list)
    full_text: str = ""
    images: list[ExtractedImage] = Field(default_factory=list)


class PDFParser:
    def __init__(self, artifact_root: Path | str):
        self.artifact_root = Path(artifact_root)

    def parse(self, pdf_path: Path | str, task_id: str) -> ParsedPdf:
        pdf = fitz.open(pdf_path)
        image_dir = self.artifact_root / task_id / "images"
        image_dir.mkdir(parents=True, exist_ok=True)
        text_by_page: list[str] = []
        images: list[ExtractedImage] = []
        image_index = 1

        try:
            for page_index, page in enumerate(pdf, start=1):
                text_by_page.append(page.get_text("text"))
                seen_xrefs: set[int] = set()
                for image_info in page.get_images(full=True):
                    xref = image_info[0]
                    if xref in seen_xrefs:
                        continue
                    seen_xrefs.add(xref)
                    extracted = pdf.extract_image(xref)
                    image_bytes = extracted.get("image")
                    if not image_bytes:
                        continue
                    with Image.open(io.BytesIO(image_bytes)) as image:
                        rgb_image = image.convert("RGB")
                        if rgb_image.width < 80 or rgb_image.height < 80:
                            continue
                        output_path = image_dir / f"page-{page_index}-image-{image_index}.png"
                        rgb_image.save(output_path)
                    images.append(
                        ExtractedImage(
                            image_id=f"IMG-{task_id}-{image_index:03d}",
                            task_id=task_id,
                            page=page_index,
                            index=image_index,
                            width=rgb_image.width,
                            height=rgb_image.height,
                            checksum=checksum_file(output_path),
                            artifact_id=f"{task_id}/images/{output_path.name}",
                            path=str(output_path),
                        )
                    )
                    image_index += 1
        finally:
            pdf.close()

        return ParsedPdf(
            task_id=task_id,
            text_by_page=text_by_page,
            full_text="\n\n".join(text_by_page),
            images=images,
        )
