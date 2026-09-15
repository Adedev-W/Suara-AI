from __future__ import annotations

import asyncio
from collections.abc import Sequence

import pytest

from suaraai.application.repositories import InMemorySessionRepository
from suaraai.application.session import GenerateHint, PrepareSession
from suaraai.domain.copilot import Hint, HintContext, InputKind, TalkMap
from suaraai.infrastructure.deterministic import (
    DeterministicHintGenerator,
    DeterministicTalkMapGenerator,
)
from suaraai.infrastructure.hint_generator import ResilientHintGenerator
from suaraai.infrastructure.llm_gateway import (
    AssemblyAILlmGateway,
    LlmGatewayError,
    _parse_hint,
    _parse_talk_map,
)
from suaraai.infrastructure.talk_map_generator import ResilientTalkMapGenerator
from suaraai.presentation.api.schemas import RealtimeHintRequest, TalkMapNodePayload

CONTINUATION = (
    "It focuses on building systems that can perform tasks such as recognizing patterns, "
    "understanding language, and making predictions. For example, an email service can use "
    "AI to identify spam by learning patterns from previous messages. This helps people "
    "handle large amounts of information more efficiently."
)


class CapturingGenerator:
    def __init__(self) -> None:
        self.context: HintContext | None = None
        self.recent = ""

    async def generate_hint(
        self,
        talk_map: TalkMap,
        active_index: int,
        recent_transcript: str,
        covered_keywords: Sequence[str],
        previous_hints: Sequence[str],
        context: HintContext | None = None,
    ) -> Hint:
        self.context = context
        self.recent = recent_transcript
        return Hint(
            2,
            "AI",
            "AI can help.",
            "Consider email.",
            "ai",
            CONTINUATION,
            "node-2",
            "invented evidence",
        )


def test_hint_receives_original_material_and_partial_context_without_false_progress() -> None:
    async def run() -> None:
        repository = InMemorySessionRepository()
        session = await PrepareSession(repository, DeterministicTalkMapGenerator()).execute(
            InputKind.TOPIC, "Artificial intelligence and its uses"
        )
        generator = CapturingGenerator()
        result = await GenerateHint(repository, generator).execute(
            session.id,
            session.access_token,
            0,
            "AI is a branch of computer science",
            [],
            [],
            "AI is",
        )
        assert generator.context == HintContext(session.input_text, "AI is")
        assert generator.recent == "AI is a branch of computer science"
        assert result.evidence == ""
        assert result.continuation == CONTINUATION

    asyncio.run(run())


def test_hint_parser_requires_substantive_continuation_and_bounded_evidence() -> None:
    payload: dict[str, object] = {
        "level": 2,
        "keyword": "AI",
        "starter": "AI can help.",
        "next_idea": "Consider email.",
        "continuation": CONTINUATION,
        "node_id": "node-1",
        "evidence": "",
    }
    assert _parse_hint(payload).continuation == CONTINUATION
    with pytest.raises(LlmGatewayError, match="40 to 70"):
        _parse_hint({**payload, "continuation": "What is AI?"})
    with pytest.raises(LlmGatewayError, match="evidence"):
        _parse_hint({**payload, "evidence": "x" * 601})


class SlowRetryGateway(AssemblyAILlmGateway):
    async def _completion(
        self,
        system: str,
        user: str,
        post_process_json: bool = False,
        max_tokens: int = 1400,
        timeout_seconds: float | None = None,
    ) -> str:
        await asyncio.sleep(2)
        return "{}"


def test_rescue_deadline_bounds_structured_retries_together() -> None:
    async def run() -> None:
        gateway = SlowRetryGateway("test", "test", "https://example.invalid")
        generator = ResilientHintGenerator(gateway, DeterministicHintGenerator())
        talk_map = await DeterministicTalkMapGenerator().generate(InputKind.TOPIC, "AI")
        started = asyncio.get_running_loop().time()
        hint = await generator.generate_hint(talk_map, 0, "AI is", [], [])
        assert asyncio.get_running_loop().time() - started < 3.8
        assert hint.source == "deterministic"
        assert hint.generation_status == "timeout"

    asyncio.run(run())


def test_old_talk_maps_remain_valid_and_context_lists_are_bounded() -> None:
    node = TalkMapNodePayload(
        title="AI",
        intent="Explain AI",
        keywords=["AI"],
        semantic_summary="AI",
        starter="AI is",
        next_prompt="An example",
    )
    assert node.to_domain(0).rescue_candidates == []
    with pytest.raises(ValueError):
        RealtimeHintRequest(active_index=0, previous_hints=["x" * 1201])


def test_generated_map_keeps_distinct_substantive_candidates() -> None:
    candidates = [CONTINUATION, "In practice, " + CONTINUATION, "For instance, " + CONTINUATION]
    node: dict[str, object] = {
        "title": "AI",
        "intent": "Explain AI",
        "keywords": ["AI"],
        "semantic_summary": "AI and its uses",
        "starter": "AI is",
        "next_prompt": "An example",
        "rescue_candidates": candidates,
    }
    result = _parse_talk_map({"title": "AI", "nodes": [node, node, node]})
    assert result.nodes[0].rescue_candidates == candidates
    duplicate_result = _parse_talk_map(
        {"title": "AI", "nodes": [{**node, "rescue_candidates": [CONTINUATION] * 3}] * 3}
    )
    assert duplicate_result.nodes[0].rescue_candidates == [CONTINUATION]


def test_generated_map_keeps_only_valid_rescue_candidates() -> None:
    candidates = [
        "Too short.",
        CONTINUATION,
        "In practice, " + CONTINUATION,
        "For speakers, " + CONTINUATION,
        "A fourth valid candidate that should not be retained because each node only needs three "
        + "different ready-to-say continuations. It explains a useful example in enough detail for "
        "a learner to keep speaking naturally while remaining focused on the original topic.",
    ]
    node: dict[str, object] = {
        "title": "AI",
        "intent": "Explain AI",
        "keywords": ["AI"],
        "semantic_summary": "AI and its uses",
        "starter": "AI is",
        "next_prompt": "An example",
        "rescue_candidates": candidates,
    }
    result = _parse_talk_map({"title": "AI", "nodes": [node, node, node]})
    assert result.nodes[0].rescue_candidates == candidates[1:4]


def test_generated_map_allows_nodes_without_valid_rescue_candidates() -> None:
    node: dict[str, object] = {
        "title": "AI",
        "intent": "Explain AI",
        "keywords": ["AI"],
        "semantic_summary": "AI and its uses",
        "starter": "AI is",
        "next_prompt": "An example",
        "rescue_candidates": ["Too short.", "", "Also too short."],
    }
    result = _parse_talk_map({"title": "AI", "nodes": [node, node, node]})
    assert result.nodes[0].rescue_candidates == []


def test_talk_map_falls_back_when_the_llm_response_has_invalid_structure() -> None:
    class FailingGenerator:
        async def generate(self, input_kind: InputKind, input_text: str) -> TalkMap:
            del input_kind, input_text
            raise LlmGatewayError("Generated Talk Map must contain between 3 and 7 nodes")

    async def run() -> None:
        generator = ResilientTalkMapGenerator(FailingGenerator(), DeterministicTalkMapGenerator())
        result = await generator.generate(InputKind.TOPIC, "Artificial intelligence")
        assert 3 <= len(result.nodes) <= 7

    asyncio.run(run())
