from fastapi.testclient import TestClient

from suaraai.infrastructure.settings import Settings
from suaraai.main import create_app


def test_session_prepare_and_complete_round_trip() -> None:
    client = TestClient(create_app(Settings(database_url=None, assemblyai_api_key=None)))

    prepared = client.post(
        "/api/v1/session/prepare",
        json={"input_kind": "topic", "input_text": "How a bicycle works"},
    )

    assert prepared.status_code == 201
    session = prepared.json()
    assert 3 <= len(session["talk_map"]["nodes"]) <= 7
    assert session["access_token"]

    completed = client.post(
        f"/api/v1/session/{session['session_id']}/complete",
        headers={"X-Session-Token": session["access_token"]},
        json={
            "transcript": "A bicycle uses pedals to move a chain and turn the wheels.",
            "state_events": [{"type": "RECORDING_STOPPED"}],
        },
    )

    assert completed.status_code == 200
    assert completed.json()["feedback"]["next_practice"]


def test_session_routes_reject_an_invalid_session_token() -> None:
    client = TestClient(create_app(Settings(database_url=None, assemblyai_api_key=None)))

    prepared = client.post(
        "/api/v1/session/prepare",
        json={"input_kind": "topic", "input_text": "A short presentation"},
    )
    session = prepared.json()

    response = client.post(
        f"/api/v1/session/{session['session_id']}/complete",
        headers={"X-Session-Token": "invalid-token"},
        json={"transcript": "This should not be stored."},
    )

    assert response.status_code == 404


def test_stt_token_reports_missing_provider_configuration() -> None:
    client = TestClient(create_app(Settings(database_url=None, assemblyai_api_key=None)))

    response = client.post("/api/v1/stt/token")

    assert response.status_code == 503
