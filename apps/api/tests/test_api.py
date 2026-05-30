from fastapi.testclient import TestClient

from paper_hunter.api import app


def test_health_endpoint_reports_ok():
    client = TestClient(app)
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_samples_endpoint_lists_synthetic_sample():
    client = TestClient(app)
    response = client.get("/api/samples")

    assert response.status_code == 200
    assert any(sample["id"] == "synthetic-paper" for sample in response.json()["samples"])


def test_create_sample_task_returns_completed_analysis(tmp_path, monkeypatch):
    monkeypatch.setenv("PAPER_HUNTER_STORAGE", str(tmp_path / "storage"))
    client = TestClient(app)

    response = client.post("/api/tasks", data={"sample_id": "synthetic-paper"})

    assert response.status_code == 200
    body = response.json()
    assert body["task"]["status"] == "completed"
    assert body["evidence"]
    assert body["report_markdown"]
