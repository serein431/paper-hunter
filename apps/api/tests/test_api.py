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


def test_model_config_masks_user_key():
    client = TestClient(app)
    response = client.post(
        "/api/model-config",
        json={
            "provider": "openai-compatible",
            "display_name": "Team gateway",
            "base_url": "https://models.example.com/v1",
            "model": "research-reviewer",
            "api_key": "secret-token",
            "temperature": 0.1,
            "use_for": ["证据解释"],
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["api_key_configured"] is True
    assert "api_key" not in body
    assert body["model"] == "research-reviewer"


def test_knowledge_bases_endpoint_lists_public_connectors():
    client = TestClient(app)
    response = client.get("/api/knowledge-bases")

    assert response.status_code == 200
    connector_ids = {connector["id"] for connector in response.json()["connectors"]}
    assert {"openalex", "crossref", "semantic_scholar", "arxiv", "pubmed"}.issubset(connector_ids)


def test_create_sample_task_returns_completed_analysis(tmp_path, monkeypatch):
    monkeypatch.setenv("PAPER_HUNTER_STORAGE", str(tmp_path / "storage"))
    client = TestClient(app)

    response = client.post("/api/tasks", data={"sample_id": "synthetic-paper"})

    assert response.status_code == 200
    body = response.json()
    assert body["task"]["status"] == "completed"
    assert body["evidence"]
    assert body["report_markdown"]
