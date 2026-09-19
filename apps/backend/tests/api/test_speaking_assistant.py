from __future__ import annotations

import asyncio
import logging

import httpx
import pytest

from suaraai.infrastructure.settings import Settings
from suaraai.main import create_app


async def _prepare(
    client: httpx.AsyncClient,
    input_text: str = "How a bicycle works",
) -> dict[str, object]:
    response = await client.post(
        "/api/v1/session/prepare",
        json={"input_kind": "topic", "input_text": input_text},
    )
    assert response.status_code == 201, response.text
    payload: dict[str, object] = response.json()
    return payload


def test_long_topic_produces_a_bounded_talk_map_without_an_llm() -> None:
    async def run() -> None:
        application = create_app(Settings(database_url=None, assemblyai_api_key=None))
        transport = httpx.ASGITransport(app=application)
        paragraph = (
            "Artificial intelligence learns patterns from data and supports practical decisions. "
        )
        long_topic = (paragraph * 200)[:9_900]
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            payload = await _prepare(client, long_topic)

        talk_map = payload["talk_map"]
        assert isinstance(talk_map, dict)
        nodes = talk_map["nodes"]
        assert isinstance(nodes, list)
        assert 3 <= len(nodes) <= 7
        assert len(str(talk_map["title"])) <= 160
        for node in nodes:
            assert isinstance(node, dict)
            assert len(str(node["title"])) <= 120
            assert len(str(node["intent"])) <= 240
            assert len(str(node["semantic_summary"])) <= 500
            assert len(str(node["starter"])) <= 240
            assert len(str(node["next_prompt"])) <= 240
            assert 1 <= len(node["keywords"]) <= 12

    asyncio.run(run())


def test_hint_rejects_an_active_index_outside_the_session_talk_map() -> None:
    async def run() -> None:
        application = create_app(Settings(database_url=None, assemblyai_api_key=None))
        transport = httpx.ASGITransport(app=application)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            session = await _prepare(client)
            response = await client.post(
                f"/api/v1/session/{session['session_id']}/hint",
                headers={"X-Session-Token": str(session["access_token"])},
                json={"active_index": 6},
            )

        assert response.status_code == 422
        assert response.json() == {"detail": "Active Talk Map index is out of range"}

    asyncio.run(run())


def test_hint_endpoint_returns_a_complete_deterministic_fallback(
    caplog: pytest.LogCaptureFixture,
) -> None:
    async def run() -> None:
        application = create_app(Settings(database_url=None, assemblyai_api_key=None))
        transport = httpx.ASGITransport(app=application)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            session = await _prepare(client)
            response = await client.post(
                f"/api/v1/session/{session['session_id']}/hint",
                headers={"X-Session-Token": str(session["access_token"])},
                json={"active_index": 0, "context_id": "take-1:revision-2", "final_transcript": ""},
            )

        assert response.status_code == 200
        payload = response.json()
        assert payload["source"] == "deterministic"
        assert payload["level"] == 2
        assert payload["keyword"]
        assert payload["starter"]
        assert payload["next_idea"]
        assert payload["context_id"] == "take-1:revision-2"
        assert payload["generation_status"] == "local_fallback"
        assert payload["node_id"] == "node-1"
        assert payload["continuation"] == ""

    caplog.set_level(logging.INFO)
    asyncio.run(run())
    assert "context_id='take-1:revision-2'" in caplog.text
    assert "source=deterministic" in caplog.text
    assert "generation_status=local_fallback" in caplog.text
