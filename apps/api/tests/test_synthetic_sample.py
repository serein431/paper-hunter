from scripts.generate_synthetic_sample import build_synthetic_pdf


def test_build_synthetic_pdf_creates_pdf(tmp_path):
    pdf_path = build_synthetic_pdf(tmp_path)

    assert pdf_path.exists()
    assert pdf_path.suffix == ".pdf"
    assert pdf_path.stat().st_size > 1000
