import asyncio
import logging
from unittest.mock import patch

import httpx
import pytest
from fastapi.testclient import TestClient

from suaraai.infrastructure.llm_gateway import AssemblyAILlmGateway, LlmGatewayError
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


def test_session_prepare_logs_diagnostic_llm_gateway_error(
    caplog: pytest.LogCaptureFixture,
) -> None:
    async def fail_generation(*_: object, **__: object) -> None:
        raise LlmGatewayError(
            "LLM Gateway returned HTTP 400: Invalid request",
            diagnostic_message=(
                "LLM Gateway returned HTTP 400: Invalid request; "
                "provider response contains the complete validation detail"
            ),
        )

    async def make_request() -> httpx.Response:
        application = create_app(Settings(database_url=None, assemblyai_api_key="test-key"))
        transport = httpx.ASGITransport(app=application)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.post(
                "/api/v1/session/prepare",
                json={"input_kind": "topic", "input_text": "How a bicycle works"},
            )

    with caplog.at_level(logging.WARNING), patch.object(
        AssemblyAILlmGateway, "generate", new=fail_generation
    ):
        response = asyncio.run(make_request())

    assert response.status_code == 502
    assert response.json() == {"detail": "LLM Gateway returned HTTP 400: Invalid request"}
    assert "complete validation detail" in caplog.text
