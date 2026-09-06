from __future__ import annotations

import re
from dataclasses import dataclass

from suaraai.domain.copilot import (
    FlowObservation,
    FlowState,
    Hint,
    NodeStatus,
    TalkMap,
)

WORD_RE = re.compile(r"[a-z0-9']+")
FILLERS = frozenset({"um", "uh", "er", "so", "basically", "like"})


def normalize_words(text: str) -> list[str]:
    return WORD_RE.findall(text.lower())


@dataclass(frozen=True, slots=True)
class MatchResult:
    active_index: int
    scores: list[float]
    progress: float


class TalkMapMatcher:
    def __init__(self, transition_margin: float = 1.0) -> None:
        self._transition_margin = transition_margin

    def match(
        self,
        talk_map: TalkMap,
        recent_transcript: str,
        active_index: int,
        covered_indices: set[int],
    ) -> MatchResult:
        words = set(normalize_words(recent_transcript))
        scores: list[float] = []
        for index, node in enumerate(talk_map.nodes):
            keywords = {word for keyword in node.keywords for word in normalize_words(keyword)}
            score = float(len(words & keywords))
            if index == active_index:
                score += 0.75
            elif index == active_index + 1:
                score += 0.35
            if index in covered_indices:
                score -= 0.5
            scores.append(score)

        next_index = active_index
        if (
            scores
            and active_index < len(scores) - 1
            and scores[active_index + 1] > scores[active_index] + self._transition_margin
        ):
            next_index = active_index + 1
        active_node = talk_map.nodes[active_index] if talk_map.nodes else None
        progress = 0.0
        if active_node is not None:
            concepts = {
                word for keyword in active_node.keywords for word in normalize_words(keyword)
            }
            progress = len(words & concepts) / max(1, len(concepts))
        return MatchResult(active_index=next_index, scores=scores, progress=progress)


class StuckDetector:
    """Conservative deterministic detector for the realtime assistance ladder."""

    def __init__(
        self,
        hesitation_silence_ms: int = 1800,
        stuck_silence_ms: int = 3000,
        cooldown_ms: int = 6000,
    ) -> None:
        self.state = FlowState.FLOWING
        self._hesitation_silence_ms = hesitation_silence_ms
        self._stuck_silence_ms = stuck_silence_ms
        self._cooldown_ms = cooldown_ms
        self._cooldown_until_ms = 0

    def observe(self, observation: FlowObservation, now_ms: int) -> FlowState:
        if observation.meaningful_speech_resumed:
            if self.state in {FlowState.HESITATING, FlowState.STUCK}:
                self.state = FlowState.RECOVERED
                self._cooldown_until_ms = now_ms + self._cooldown_ms
            elif self.state == FlowState.RECOVERED:
                self.state = FlowState.FLOWING
            return self.state

        if observation.manual_hint_requested:
            self.state = FlowState.STUCK
            return self.state

        if observation.recently_completed_section or now_ms < self._cooldown_until_ms:
            self.state = FlowState.FLOWING
            return self.state

        low_progress = observation.semantic_progress < 0.35
        if (
            observation.silence_ms > self._stuck_silence_ms
            and observation.active_node_complete is False
            and low_progress
        ):
            self.state = FlowState.STUCK
        elif low_progress and (
            observation.silence_ms >= self._hesitation_silence_ms
            or observation.filler_density >= 0.2
            or observation.repetition_score >= 0.5
        ):
            self.state = FlowState.HESITATING
        else:
            self.state = FlowState.FLOWING
        return self.state


def select_hint(talk_map: TalkMap, active_index: int, state: FlowState) -> Hint | None:
    if not talk_map.nodes or state == FlowState.FLOWING:
        return None
    node = talk_map.nodes[min(active_index, len(talk_map.nodes) - 1)]
    next_idea = next((keyword for keyword in node.keywords if keyword), None)
    if state == FlowState.HESITATING:
        return Hint(level=1, keyword=next_idea, starter=None, next_idea=None)
    return Hint(
        level=2,
        keyword=next_idea,
        starter=node.starter,
        next_idea=node.next_prompt or next_idea,
    )


def mark_active_node(talk_map: TalkMap, active_index: int) -> None:
    for index, node in enumerate(talk_map.nodes):
        if node.status == NodeStatus.COVERED and index != active_index:
            continue
        node.status = NodeStatus.ACTIVE if index == active_index else NodeStatus.UPCOMING
