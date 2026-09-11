from __future__ import annotations

import asyncio
import logging
from collections.abc import Sequence
from unittest.mock import patch

import httpx
import pytest
from fastapi import FastAPI

from suaraai.application.session import DeterministicTalkMapGenerator
from suaraai.domain.copilot import Hint, TalkMap
from suaraai.infrastructure.hint_generator import ResilientHintGenerator
from suaraai.infrastructure.llm_gateway import AssemblyAILlmGateway, LlmGatewayError
from suaraai.infrastructure.settings import Settings
from suaraai.main import create_app
from tests.support.realtime_simulator import RealtimeHintSimulator


class _FakeHintGenerator:
    def __init__(
        self,
        failure: LlmGatewayError | None = None,
        fail_after: int | None = None,
    ) -> None:
        self.failure = failure
        self.fail_after = fail_after
        self.calls: list[tuple[int, str, list[str], list[str]]] = []

    async def generate_hint(
        self,
        _talk_map: TalkMap,
        active_index: int,
        recent_transcript: str,
        covered_keywords: Sequence[str],
        previous_hints: Sequence[str],
    ) -> Hint:
        self.calls.append(
            (
                active_index,
                recent_transcript,
                list(covered_keywords),
                list(previous_hints),
            )
        )
        if self.failure is not None and (
            self.fail_after is None or len(self.calls) > self.fail_after
        ):
            raise self.failure
        return Hint(
            level=2,
            keyword="example",
            starter="For example, ...",
            next_idea="Describe one concrete use case.",
            source="ai",
        )


def _application(primary: _FakeHintGenerator) -> FastAPI:
    application = create_app(Settings(database_url=None, assemblyai_api_key=None))
    services = application.state.services
    services.generate_hint._generator = ResilientHintGenerator(
        primary,
        services.generate_hint._generator,
    )
    return application


async def _simulator(
    primary: _FakeHintGenerator,
) -> tuple[RealtimeHintSimulator, httpx.AsyncClient]:
    application = _application(primary)
    transport = httpx.ASGITransport(app=application)
    client = httpx.AsyncClient(transport=transport, base_url="http://test")
    simulator = await RealtimeHintSimulator.from_prepared_session(client, seed=19)
    return simulator, client


def test_word_delays_and_short_pause_do_not_trigger_a_hint() -> None:
    async def run() -> None:
        simulator, client = await _simulator(_FakeHintGenerator())
        try:
            delays = [simulator.next_word_delay_seconds() for _ in range(12)]
            assert all(0.5 <= delay <= 1.0 for delay in delays)
            assert 0.5 <= simulator.next_pause_seconds(stuck_probability=0) <= 1.0
            assert 3.1 <= simulator.next_pause_seconds(stuck_probability=1) <= 4.0

            await simulator.speak("I want to explain this subject")
            await simulator.pause(0.9)

            assert simulator.hint_request_count == 0
            assert "STUCK" not in simulator.states
        finally:
            await client.aclose()

    asyncio.run(run())


def test_stuck_episode_requests_one_contextual_ai_hint() -> None:
    async def run() -> None:
        primary = _FakeHintGenerator()
        simulator, client = await _simulator(primary)
        try:
            await simulator.speak("I want to explain this subject")
            await simulator.pause(3.2)

            assert simulator.hint_request_count == 1
            assert simulator.events[-1].status_code == 200
            assert simulator.events[-1].source == "ai"
            assert len(primary.calls) == 1
            assert primary.calls[0][1] == "I want to explain this subject"

            await simulator.pause(4.0)
            assert simulator.hint_request_count == 1

            await simulator.speak("Artificial intelligence")
            await simulator.pause(1.0)
            assert simulator.hint_request_count == 1
        finally:
            await client.aclose()

    asyncio.run(run())


def test_provider_failure_returns_deterministic_hint_and_keeps_recording_usable(
    caplog: pytest.LogCaptureFixture,
) -> None:
    async def run() -> None:
        primary = _FakeHintGenerator(
            LlmGatewayError(
                "LLM Gateway returned HTTP 429: rate limited",
                diagnostic_message="provider response was rate limited",
            )
        )
        simulator, client = await _simulator(primary)
        try:
            await simulator.speak("I want to explain this subject")
            await simulator.pause(3.2)
            response = next(
                event for event in reversed(simulator.events) if event.kind == "hint_response"
            )

            assert response.status_code == 200
            assert response.source == "deterministic"
            assert simulator.hint_request_count == 1
        finally:
            await client.aclose()

    with caplog.at_level(logging.WARNING):
        asyncio.run(run())
    assert "using deterministic fallback" in caplog.text


def test_later_stuck_episode_degrades_to_fallback_after_an_initial_ai_hint() -> None:
    async def run() -> None:
        primary = _FakeHintGenerator(
            LlmGatewayError("provider rate limited after the first request"),
            fail_after=1,
        )
        simulator, client = await _simulator(primary)
        try:
            await simulator.speak("I want to explain this subject")
            await simulator.pause(3.2)
            first_hint = simulator.events[-1]
            assert first_hint.source == "ai"

            await simulator.speak("I can continue")
            await simulator.pause(6.1)
            await simulator.pause(3.2)

            hint_events = [event for event in simulator.events if event.kind == "hint_response"]
            assert [event.source for event in hint_events] == ["ai", "deterministic"]
            assert [event.status_code for event in hint_events] == [200, 200]
        finally:
            await client.aclose()

    asyncio.run(run())


def test_configured_provider_failure_is_wired_to_the_api_fallback() -> None:
    async def fail_hint(*_: object, **__: object) -> Hint:
        raise LlmGatewayError("provider unavailable")

    async def run() -> None:
        application = create_app(
            Settings(database_url=None, assemblyai_api_key="configured-for-test")
        )
        application.state.services.prepare_session._generator = DeterministicTalkMapGenerator()
        transport = httpx.ASGITransport(app=application)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            with patch.object(AssemblyAILlmGateway, "generate_hint", new=fail_hint):
                simulator = await RealtimeHintSimulator.from_prepared_session(client, seed=3)
                await simulator.speak("I want to explain this subject")
                await simulator.pause(3.2)

            hint_event = next(
                event for event in reversed(simulator.events) if event.kind == "hint_response"
            )
            assert hint_event.status_code == 200
            assert hint_event.source == "deterministic"

    asyncio.run(run())
