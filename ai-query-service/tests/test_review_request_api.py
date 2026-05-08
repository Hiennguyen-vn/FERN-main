from fastapi.testclient import TestClient

from app.main import app


def test_review_request_endpoint_publishes_audit(monkeypatch):
    sent = []

    async def fake_emit(event):
        sent.append(event)

    monkeypatch.setattr("app.main.emit_review_request", fake_emit)
    monkeypatch.setattr("app.main.get_settings", lambda: type("S", (), {"internal_service_token": "t"})())

    client = TestClient(app)
    resp = client.post(
        "/api/v1/ai-query/review-request",
        headers={
            "X-Internal-Service": "gateway",
            "X-Internal-Token": "t",
            "X-Internal-User-Id": "42",
            "X-Internal-Outlet-Ids": "1",
            "X-Internal-Roles": "finance",
            "X-Internal-Session-Id": "s",
        },
        json={
            "question": "doanh thu hôm nay",
            "answer": "100",
            "reason": "nghi ngờ số liệu",
            "rows_preview": [{"net_revenue": 100}],
            "workflow_summary": {
                "lane": "analytics",
                "escalation_candidate": True,
                "escalation_reason": "still_missing_slots_after_followup",
            },
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "queued"
    assert sent
    assert sent[0]["event_type"] == "ai_query_review_requested"
    assert sent[0]["user_id"] == 42
    assert sent[0]["workflow_summary"]["escalation_candidate"] is True
    assert "sql" not in sent[0]
