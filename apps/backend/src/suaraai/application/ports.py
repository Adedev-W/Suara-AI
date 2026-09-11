from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol
from uuid import UUID

from suaraai.domain.copilot import (
    DocumentChunk,
    ExtractedDocument,
    Feedback,
    Hint,
    InputKind,
    RetrievedChunk,
    Session,
    TalkMap,
)


class TalkMapGenerator(Protocol):
    async def generate(self, input_kind: InputKind, input_text: str) -> TalkMap: ...


class FeedbackGenerator(Protocol):
    async def generate_feedback(self, transcript: str, talk_map: TalkMap) -> Feedback: ...


class HintGenerator(Protocol):
    async def generate_hint(
        self,
        talk_map: TalkMap,
        active_index: int,
        recent_transcript: str,
        covered_keywords: Sequence[str],
        previous_hints: Sequence[str],
    ) -> Hint: ...


class QuestionAnswerer(Protocol):
    async def answer(self, question: str, context: Sequence[RetrievedChunk]) -> str: ...


class EmbeddingService(Protocol):
    async def embed(self, texts: Sequence[str]) -> list[list[float]]: ...


class DocumentParser(Protocol):
    def parse(
        self, source_name: str, content_type: str | None, data: bytes
    ) -> ExtractedDocument: ...

    def chunk(self, document: ExtractedDocument) -> list[tuple[int | None, str]]: ...


class SessionRepository(Protocol):
    async def save(self, session: Session) -> None: ...

    async def get(self, session_id: UUID, access_token: str) -> Session | None: ...

    async def update(self, session: Session) -> None: ...

    async def save_document_chunks(
        self, session_id: UUID, source_name: str, chunks: Sequence[DocumentChunk]
    ) -> None: ...

    async def search_chunks(
        self, session_id: UUID, embedding: Sequence[float], limit: int
    ) -> list[RetrievedChunk]: ...
