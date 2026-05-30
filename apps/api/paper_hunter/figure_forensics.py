from __future__ import annotations

import hashlib
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageOps
from pydantic import BaseModel


class ImageComparison(BaseModel):
    source_path: str
    target_path: str
    confidence: float
    hash_similarity: float
    pixel_similarity: float
    method: str = "pHash + normalized pixel difference"


def checksum_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _load_grayscale(path: Path, size: tuple[int, int] = (128, 128)) -> Image.Image:
    with Image.open(path) as image:
        return ImageOps.grayscale(image.convert("RGB")).resize(size, Image.Resampling.LANCZOS)


def _average_hash(path: Path, size: int = 16) -> np.ndarray:
    image = _load_grayscale(path, (size, size))
    pixels = np.asarray(image, dtype=np.float32)
    return pixels > pixels.mean()


def _hash_similarity(source: Path, target: Path) -> float:
    source_hash = _average_hash(source)
    target_hash = _average_hash(target)
    distance = np.count_nonzero(source_hash != target_hash)
    return 1.0 - (distance / source_hash.size)


def _pixel_similarity(source: Path, target: Path) -> float:
    source_image = _load_grayscale(source)
    target_image = _load_grayscale(target)
    source_array = np.asarray(source_image, dtype=np.float32) / 255.0
    target_array = np.asarray(target_image, dtype=np.float32) / 255.0
    mse = float(np.mean((source_array - target_array) ** 2))
    return max(0.0, 1.0 - mse)


def compare_images(source: Path | str, target: Path | str) -> ImageComparison:
    source_path = Path(source)
    target_path = Path(target)
    if checksum_file(source_path) == checksum_file(target_path):
        return ImageComparison(
            source_path=str(source_path),
            target_path=str(target_path),
            confidence=1.0,
            hash_similarity=1.0,
            pixel_similarity=1.0,
        )

    hash_similarity = _hash_similarity(source_path, target_path)
    pixel_similarity = _pixel_similarity(source_path, target_path)
    confidence = round(min(1.0, (hash_similarity * 0.62) + (pixel_similarity * 0.38)), 4)
    return ImageComparison(
        source_path=str(source_path),
        target_path=str(target_path),
        confidence=confidence,
        hash_similarity=round(hash_similarity, 4),
        pixel_similarity=round(pixel_similarity, 4),
    )


def write_difference_image(source: Path | str, target: Path | str, output: Path | str) -> Path:
    source_image = _load_grayscale(Path(source))
    target_image = _load_grayscale(Path(target))
    diff = ImageChops.difference(source_image, target_image)
    colorized = ImageOps.colorize(ImageOps.autocontrast(diff), black="#111827", white="#ef4444")
    output_path = Path(output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    colorized.save(output_path)
    return output_path


def write_side_by_side_image(source: Path | str, target: Path | str, output: Path | str) -> Path:
    source_image = Image.open(source).convert("RGB").resize((320, 240), Image.Resampling.LANCZOS)
    target_image = Image.open(target).convert("RGB").resize((320, 240), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (660, 240), "#111827")
    canvas.paste(source_image, (0, 0))
    canvas.paste(target_image, (340, 0))
    output_path = Path(output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output_path)
    return output_path
