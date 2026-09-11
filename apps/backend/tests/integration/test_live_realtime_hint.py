from __future__ import annotations

import asyncio
import os
from dataclasses import replace

import httpx
import pytest

from suaraai.application.session import DeterministicTalkMapGenerator
from suaraai.infrastructure.settings import load_settings
from suaraai.main import create_app

LIVE_TEST_TIMEOUT_SECONDS = 45

if os.getenv("SUARAAI_RUN_LIVE_LLM_TESTS") != "1":
    pytest.skip(
        "Set SUARAAI_RUN_LIVE_LLM_TESTS=1 to call the live LLM provider",
        allow_module_level=True,
    )


def test_live_api_key_generates_a_contextual_realtime_hint() -> None:
    async def run() -> None:
        settings = load_settings()
        if not settings.assemblyai_api_key:
            pytest.fail(
                "ASSEMBLYAI_API_KEY is not configured in the environment or repository .env"
            )

        # Keep this smoke test independent of PostgreSQL while using the real
        # provider-backed hint generator wired by create_services.
        application = create_app(replace(settings, database_url=None))
        application.state.services.prepare_session._generator = DeterministicTalkMapGenerator()
        transport = httpx.ASGITransport(app=application)
        async with httpx.AsyncClient(transport=transport, base_url="http://live-test") as client:
            prepared = await client.post(
                "/api/v1/session/prepare",
                json={"input_kind": "topic", "input_text": "Artificial Intelligence"},
            )
            assert prepared.status_code == 201, prepared.text
            session = prepared.json()

            response = await client.post(
                f"/api/v1/session/{session['session_id']}/hint",
                headers={"X-Session-Token": session["access_token"]},
                json={
                    "active_index": 0,
                    "recent_transcript": (
                        "Artificial intelligence refers to machines performing human-like tasks."
                    ),
                    "covered_keywords": [],
                    "previous_hints": [],
                },
            )

            assert response.status_code == 200, response.text
            payload = response.json()
            assert payload["source"] == "ai", payload
            assert payload["starter"]
            assert payload["next_idea"]

    asyncio.run(asyncio.wait_for(run(), timeout=LIVE_TEST_TIMEOUT_SECONDS))
