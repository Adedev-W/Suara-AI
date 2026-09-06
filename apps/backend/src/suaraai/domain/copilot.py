from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from uuid import UUID, uuid4


class NodeStatus(StrEnum):
    UPCOMING = "upcoming"
    ACTIVE = "active"
    COVERED = "covered"


class FlowState(StrEnum):
    FLOWING = "FLOWING"
    HESITATING = "HESITATING"
    STUCK = "STUCK"
    RECOVERED = "RECOVERED"


class InputKind(StrEnum):
    TOPIC = "topic"
    NOTES = "notes"
    KEY_POINTS = "key_points"


@dataclass(slots=True)
class TalkMapNode:
    id: str
    title: str
    intent: str
    keywords: list[str]
    semantic_summary: str
    starter: str
    next_prompt: str
    status: NodeStatus = NodeStatus.UPCOMING


@dataclass(slots=True)
class TalkMap:
    title: str
    nodes: list[TalkMapNode]


@dataclass(slots=True)
class Session:
    id: UUID
    access_token: str
    input_kind: InputKind
    input_text: str
    talk_map: TalkMap
    final_transcript: str | None = None
    state_events: list[dict[str, object]] = field(default_factory=list)
    feedback: dict[str, object] | None = None

    @classmethod
    def create(
        cls,
        input_kind: InputKind,
        input_text: str,
        talk_map: TalkMap,
        access_token: str,
    ) -> Session:
        return cls(
            id=uuid4(),
            access_token=access_token,
            input_kind=input_kind,
            input_text=input_text,
            talk_map=talk_map,
        )


@dataclass(frozen=True, slots=True)
class Hint:
    level: int
    keyword: str | None
    starter: str | None
    next_idea: str | None


@dataclass(frozen=True, slots=True)
class FlowObservation:
    silence_ms: int
    filler_density: float
    repetition_score: float
    semantic_progress: float
    active_node_complete: bool
    meaningful_speech_resumed: bool = False
    manual_hint_requested: bool = False
    recently_completed_section: bool = False


@dataclass(frozen=True, slots=True)
class ExtractedDocument:
    source_name: str
    pages: list[tuple[int | None, str]]


@dataclass(frozen=True, slots=True)
class DocumentChunk:
    document_id: UUID
    text: str
    page_number: int | None
    chunk_index: int
    embedding: list[float]


@dataclass(frozen=True, slots=True)
class RetrievedChunk:
    text: str
    source_name: str
    page_number: int | None
    score: float


@dataclass(frozen=True, slots=True)
class Feedback:
    summary: str
    strengths: list[str]
    improvements: list[str]
    examples: list[str]
    next_practice: str
