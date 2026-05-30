from pathlib import Path

from PIL import Image, ImageDraw

from paper_hunter.figure_forensics import compare_images


def _demo_image(path: Path, color: tuple[int, int, int], mark: bool = True) -> None:
    image = Image.new("RGB", (160, 120), color)
    draw = ImageDraw.Draw(image)
    if mark:
        draw.rectangle((30, 25, 120, 80), outline=(240, 240, 240), width=6)
        draw.line((20, 100, 145, 20), fill=(20, 20, 20), width=4)
    image.save(path)


def test_compare_images_scores_near_duplicate_higher_than_unrelated(tmp_path):
    source = tmp_path / "source.png"
    duplicate = tmp_path / "duplicate.png"
    unrelated = tmp_path / "unrelated.png"
    _demo_image(source, (70, 120, 150))
    _demo_image(duplicate, (74, 124, 154))
    _demo_image(unrelated, (210, 180, 80), mark=False)

    near = compare_images(source, duplicate)
    far = compare_images(source, unrelated)

    assert near.confidence > far.confidence
    assert near.confidence >= 0.70
    assert "pHash" in near.method


def test_compare_images_handles_same_file(tmp_path):
    source = tmp_path / "source.png"
    _demo_image(source, (70, 120, 150))

    score = compare_images(source, source)

    assert score.confidence == 1.0
