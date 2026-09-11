from suaraai.application.flow import StuckDetector, TalkMapMatcher, select_hint
from suaraai.domain.copilot import (
    FlowObservation,
    FlowState,
    Hint,
    NodeStatus,
    TalkMap,
    TalkMapNode,
)


def _observation(**overrides: object) -> FlowObservation:
    values: dict[str, object] = {
        "silence_ms": 0,
        "filler_density": 0.0,
        "repetition_score": 0.0,
        "semantic_progress": 0.8,
        "active_node_complete": False,
    }
    values.update(overrides)
    return FlowObservation(**values)  # type: ignore[arg-type]


def test_stuck_detector_uses_hesitation_then_stuck_then_recovery() -> None:
    detector = StuckDetector()

    assert detector.observe(_observation(), now_ms=0) == FlowState.FLOWING
    assert (
        detector.observe(_observation(silence_ms=1800, semantic_progress=0.1), now_ms=1800)
        == FlowState.HESITATING
    )
    assert (
        detector.observe(_observation(silence_ms=3001, semantic_progress=0.1), now_ms=3001)
        == FlowState.STUCK
    )
    assert (
        detector.observe(_observation(meaningful_speech_resumed=True), now_ms=3100)
        == FlowState.RECOVERED
    )
    assert detector.observe(_observation(), now_ms=4000) == FlowState.FLOWING


def test_stuck_detector_does_not_flicker_during_continued_silence() -> None:
    detector = StuckDetector()

    assert (
        detector.observe(_observation(silence_ms=1800, semantic_progress=0.1), now_ms=1800)
        == FlowState.HESITATING
    )
    assert (
        detector.observe(_observation(silence_ms=3001, semantic_progress=0.1), now_ms=3001)
        == FlowState.STUCK
    )
    assert (
        detector.observe(_observation(silence_ms=3251, semantic_progress=0.1), now_ms=3251)
        == FlowState.STUCK
    )


def test_talk_map_matcher_advances_only_when_next_node_is_clearer() -> None:
    talk_map = TalkMap(
        title="Explain APIs",
        nodes=[
            TalkMapNode(
                id="one",
                title="What it is",
                intent="Define the idea",
                keywords=["definition"],
                semantic_summary="The definition.",
                starter="It is...",
                next_prompt="Explain the definition.",
            ),
            TalkMapNode(
                id="two",
                title="How it works",
                intent="Describe the mechanism",
                keywords=["mechanism", "request"],
                semantic_summary="The mechanism.",
                starter="It works by...",
                next_prompt="Describe the request.",
            ),
        ],
    )

    result = TalkMapMatcher().match(talk_map, "The request reaches the mechanism", 0, set())

    assert result.active_index == 1
    assert result.progress == 0.0


def test_select_hint_returns_a_small_nudge_for_hesitation() -> None:
    node = TalkMapNode(
        id="one",
        title="What it is",
        intent="Define the idea",
        keywords=["definition"],
        semantic_summary="The definition.",
        starter="It is...",
        next_prompt="Explain the definition.",
        status=NodeStatus.ACTIVE,
    )

    hint = select_hint(TalkMap(title="Practice", nodes=[node]), 0, FlowState.HESITATING)

    assert hint == Hint(level=1, keyword="definition", starter=None, next_idea=None)
