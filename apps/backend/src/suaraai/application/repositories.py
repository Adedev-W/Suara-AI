from __future__ import annotations

import math
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from uuid import UUID

from suaraai.domain.copilot import DocumentChunk, RetrievedChunk, Session


class InMemorySessionRepository:
    def __init__(self) -> None:
        self._sessions: dict[UUID, Session] = {}
        self._chunks: dict[UUID, list[tuple[str, DocumentChunk]]] = {}
        self._created_at: dict[UUID, datetime] = {}

    async def save(self, session: Session) -> None:
        self._sessions[session.id] = session
        self._created_at[session.id] = datetime.now(UTC)

    async def get(self, session_id: UUID, access_token: str) -> Session | None:
        session = self._sessions.get(session_id)
        if session is None or session.access_token != access_token:
            return None
        if datetime.now(UTC) - self._created_at[session_id] > timedelta(hours=24):
            return None
        return session

    async def update(self, session: Session) -> None:
        self._sessions[session.id] = session

    async def save_document_chunks(
        self, session_id: UUID, source_name: str, chunks: Sequence[DocumentChunk]
    ) -> None:
        self._chunks.setdefault(session_id, []).extend((source_name, chunk) for chunk in chunks)

    async def search_chunks(
        self, session_id: UUID, embedding: Sequence[float], limit: int
    ) -> list[RetrievedChunk]:
        matches: list[RetrievedChunk] = []
        for source_name, chunk in self._chunks.get(session_id, []):
            score = _cosine_similarity(embedding, chunk.embedding)
            matches.append(
                RetrievedChunk(
                    text=chunk.text,
                    source_name=source_name,
                    page_number=chunk.page_number,
                    score=score,
                )
            )
        return sorted(matches, key=lambda item: item.score, reverse=True)[:limit]


def _cosine_similarity(left: Sequence[float], right: Sequence[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    left_norm = math.sqrt(sum(value * value for value in left))
    right_norm = math.sqrt(sum(value * value for value in right))
    if left_norm == 0 or right_norm == 0:
        return 0.0
    return sum(a * b for a, b in zip(left, right, strict=True)) / (left_norm * right_norm)
