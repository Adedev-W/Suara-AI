from __future__ import annotations

import asyncio
from collections.abc import Sequence

from suaraai.application.ports import HintGenerator
from suaraai.application.repositories import InMemorySessionRepository
from suaraai.application.session import GenerateHint, PrepareSession
from suaraai.domain.copilot import Hint, HintContext, InputKind, Session, TalkMap
from suaraai.infrastructure.deterministic import (
    DeterministicHintGenerator,
    DeterministicTalkMapGenerator,
)
from suaraai.infrastructure.hint_generator import ResilientHintGenerator
from suaraai.infrastructure.llm_gateway import LlmProviderError


class _SuccessfulHintGenerator:
    def __init__(self) -> None:
        self.calls: list[tuple[int, str, list[str], list[str]]] = []

    async def generate_hint(
        self,
        talk_map: TalkMap,
        active_index: int,
        recent_transcript: str,
        covered_keywords: Sequence[str],
        previous_hints: Sequence[str],
        context: HintContext | None = None,
    ) -> Hint:
        del talk_map
        self.calls.append(
            (active_index, recent_transcript, list(covered_keywords), list(previous_hints))
        )
        return Hint(
            level=2,
            keyword="example",
            starter="For example...",
            next_idea="Describe one practical use.",
            source="ai",
        )


class _FailingHintGenerator:
    async def generate_hint(
        self,
        talk_map: TalkMap,
        active_index: int,
        recent_transcript: str,
        covered_keywords: Sequence[str],
        previous_hints: Sequence[str],
        context: HintContext | None = None,
    ) -> Hint:
        del talk_map, active_index, recent_transcript, covered_keywords, previous_hints
        raise LlmProviderError("provider timed out")


async def _prepared_hint_use_case(generator: HintGenerator) -> tuple[GenerateHint, Session]:
    repository = InMemorySessionRepository()
    session = await PrepareSession(repository, DeterministicTalkMapGenerator()).execute(
        InputKind.TOPIC,
        "How a bicycle works",
    )
    return GenerateHint(repository, generator), session


def test_contextual_ai_hint_receives_the_bounded_conversation_context() -> None:
    async def run() -> None:
        generator = _SuccessfulHintGenerator()
        generate_hint, session = await _prepared_hint_use_case(generator)
        generated = await generate_hint.execute(
            session.id,
            session.access_token,
            0,
            "A bicycle uses pedals.",
            ["bicycle"],
            ["Start with the main idea."],
        )

        assert generated.source == "ai"
        assert generator.calls == [
            (0, "A bicycle uses pedals.", ["bicycle"], ["Start with the main idea."])
        ]

    asyncio.run(run())


def test_provider_failure_returns_a_deterministic_hint() -> None:
    async def run() -> None:
        generator = ResilientHintGenerator(
            _FailingHintGenerator(),
            DeterministicHintGenerator(),
        )
        generate_hint, session = await _prepared_hint_use_case(generator)
        generated = await generate_hint.execute(
            session.id,
            session.access_token,
            0,
            "",
            [],
            [],
        )

        assert generated.source == "deterministic"
        assert generated.starter

    asyncio.run(run())
