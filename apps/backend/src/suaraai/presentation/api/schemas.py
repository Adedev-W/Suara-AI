from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from suaraai.domain.copilot import (
    Feedback,
    InputKind,
    NodeStatus,
    Session,
    TalkMap,
    TalkMapNode,
)
from suaraai.domain.health import ServiceHealth


class HealthResponse(BaseModel):
    status: str
    service: str

    @classmethod
    def from_domain(cls, health: ServiceHealth) -> HealthResponse:
        return cls(status=health.status, service=health.service)


class TalkMapNodePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str | None = None
    title: str = Field(min_length=1, max_length=120)
    intent: str = Field(min_length=1, max_length=240)
    keywords: list[str] = Field(min_length=1, max_length=12)
    semantic_summary: str = Field(min_length=1, max_length=500)
    starter: str = Field(min_length=1, max_length=240)
    next_prompt: str = Field(min_length=1, max_length=240)
    status: NodeStatus = NodeStatus.UPCOMING

    def to_domain(self, index: int) -> TalkMapNode:
        return TalkMapNode(
            id=self.id or f"node-{index + 1}",
            title=self.title.strip(),
            intent=self.intent.strip(),
            keywords=[keyword.strip() for keyword in self.keywords if keyword.strip()],
            semantic_summary=self.semantic_summary.strip(),
            starter=self.starter.strip(),
            next_prompt=self.next_prompt.strip(),
            status=self.status,
        )


class TalkMapPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=160)
    nodes: list[TalkMapNodePayload] = Field(min_length=3, max_length=7)

    def to_domain(self) -> TalkMap:
        return TalkMap(
            title=self.title.strip(),
            nodes=[node.to_domain(index) for index, node in enumerate(self.nodes)],
        )


class SessionPrepareRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    input_kind: InputKind = InputKind.TOPIC
    input_text: str = Field(min_length=1, max_length=10_000)

    @field_validator("input_text")
    @classmethod
    def validate_input_text(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Topic or notes are required")
        return cleaned


class SessionResponse(BaseModel):
    session_id: UUID
    access_token: str
    input_kind: InputKind
    talk_map: TalkMapPayload

    @classmethod
    def from_domain(cls, session: Session) -> SessionResponse:
        return cls(
            session_id=session.id,
            access_token=session.access_token,
            input_kind=session.input_kind,
            talk_map=TalkMapPayload.model_validate(_talk_map_dict(session.talk_map)),
        )


class UpdateTalkMapRequest(BaseModel):
    talk_map: TalkMapPayload


class RealtimeHintRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    active_index: int = Field(ge=0, le=6)
    recent_transcript: str = Field(default="", max_length=6_000)
    covered_keywords: list[str] = Field(default_factory=list, max_length=100)
    previous_hints: list[str] = Field(default_factory=list, max_length=5)


class HintResponse(BaseModel):
    level: int = Field(ge=2, le=3)
    keyword: str | None = Field(default=None, max_length=240)
    starter: str | None = Field(default=None, max_length=240)
    next_idea: str | None = Field(default=None, max_length=240)
    source: Literal["ai", "deterministic"]


class SttTokenResponse(BaseModel):
    token: str
    expires_in_seconds: int
    speech_model: str


class CompleteSessionRequest(BaseModel):
    transcript: str = Field(min_length=1, max_length=100_000)
    state_events: list[dict[str, Any]] = Field(default_factory=list, max_length=10_000)

    @field_validator("transcript")
    @classmethod
    def validate_transcript(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("A final transcript is required")
        return cleaned


class FeedbackPayload(BaseModel):
    summary: str
    strengths: list[str]
    improvements: list[str]
    examples: list[str]
    next_practice: str

    @classmethod
    def from_domain(cls, feedback: Feedback) -> FeedbackPayload:
        return cls(
            summary=feedback.summary,
            strengths=feedback.strengths,
            improvements=feedback.improvements,
            examples=feedback.examples,
            next_practice=feedback.next_practice,
        )


class CompleteSessionResponse(BaseModel):
    session_id: UUID
    feedback: FeedbackPayload


class DocumentIngestResponse(BaseModel):
    source_name: str
    chunk_count: int


class KnowledgeQueryRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2_000)

    @field_validator("question")
    @classmethod
    def validate_question(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Question is required")
        return cleaned


class KnowledgeSourcePayload(BaseModel):
    source_name: str
    page_number: int | None
    score: float


class KnowledgeQueryResponse(BaseModel):
    answer: str
    sources: list[KnowledgeSourcePayload]


def _talk_map_dict(talk_map: TalkMap) -> dict[str, object]:
    return {
        "title": talk_map.title,
        "nodes": [
            {
                "id": node.id,
                "title": node.title,
                "intent": node.intent,
                "keywords": node.keywords,
                "semantic_summary": node.semantic_summary,
                "starter": node.starter,
                "next_prompt": node.next_prompt,
                "status": node.status,
            }
            for node in talk_map.nodes
        ],
    }
