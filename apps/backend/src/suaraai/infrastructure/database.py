from __future__ import annotations

import hashlib
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from pgvector.sqlalchemy import Vector
from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, select, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from suaraai.domain.copilot import (
    DocumentChunk,
    InputKind,
    NodeStatus,
    RetrievedChunk,
    Session,
    TalkMap,
    TalkMapNode,
)


class Base(DeclarativeBase):
    pass


class SessionRow(Base):
    __tablename__ = "speaking_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    access_token_hash: Mapped[str] = mapped_column(String(64), index=True)
    input_kind: Mapped[str] = mapped_column(String(32))
    input_text: Mapped[str] = mapped_column(Text)
    talk_map: Mapped[dict[str, Any]] = mapped_column(JSONB)
    final_transcript: Mapped[str | None] = mapped_column(Text, nullable=True)
    state_events: Mapped[list[dict[str, object]]] = mapped_column(JSONB, default=list)
    feedback: Mapped[dict[str, object] | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )


class DocumentRow(Base):
    __tablename__ = "knowledge_documents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("speaking_sessions.id"), index=True)
    source_name: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )


class ChunkRow(Base):
    __tablename__ = "knowledge_chunks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("knowledge_documents.id"), index=True)
    text: Mapped[str] = mapped_column(Text)
    page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    chunk_index: Mapped[int] = mapped_column(Integer)
    embedding: Mapped[list[float]] = mapped_column(Vector(384))


def create_engine(database_url: str) -> AsyncEngine:
    return create_async_engine(database_url, pool_pre_ping=True)


async def initialize_database(engine: AsyncEngine) -> None:
    async with engine.begin() as connection:
        await connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await connection.run_sync(Base.metadata.create_all)
        await connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_hnsw_idx "
                "ON knowledge_chunks USING hnsw (embedding vector_cosine_ops)"
            )
        )


class PostgresSessionRepository:
    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self._session_factory = session_factory

    async def save(self, session: Session) -> None:
        async with self._session_factory() as database_session:
            database_session.add(_to_row(session))
            await database_session.commit()

    async def get(self, session_id: UUID, access_token: str) -> Session | None:
        async with self._session_factory() as database_session:
            row = await database_session.get(SessionRow, str(session_id))
            if row is None or row.access_token_hash != _hash_token(access_token):
                return None
            if datetime.now(UTC) - row.created_at > timedelta(hours=24):
                return None
            return _from_row(row, access_token)

    async def update(self, session: Session) -> None:
        async with self._session_factory() as database_session:
            row = await database_session.get(SessionRow, str(session.id))
            if row is None or row.access_token_hash != _hash_token(session.access_token):
                return
            row.input_kind = session.input_kind.value
            row.input_text = session.input_text
            row.talk_map = _talk_map_to_dict(session.talk_map)
            row.final_transcript = session.final_transcript
            row.state_events = session.state_events
            row.feedback = session.feedback
            await database_session.commit()

    async def save_document_chunks(
        self, session_id: UUID, source_name: str, chunks: Sequence[DocumentChunk]
    ) -> None:
        async with self._session_factory() as database_session:
            document_id = str(chunks[0].document_id) if chunks else ""
            database_session.add(
                DocumentRow(id=document_id, session_id=str(session_id), source_name=source_name)
            )
            database_session.add_all(
                ChunkRow(
                    document_id=document_id,
                    text=chunk.text,
                    page_number=chunk.page_number,
                    chunk_index=chunk.chunk_index,
                    embedding=chunk.embedding,
                )
                for chunk in chunks
            )
            await database_session.commit()

    async def search_chunks(
        self, session_id: UUID, embedding: Sequence[float], limit: int
    ) -> list[RetrievedChunk]:
        distance = ChunkRow.embedding.cosine_distance(embedding)
        statement = (
            select(ChunkRow, DocumentRow)
            .join(DocumentRow, ChunkRow.document_id == DocumentRow.id)
            .where(DocumentRow.session_id == str(session_id))
            .order_by(distance)
            .limit(limit)
        )
        async with self._session_factory() as database_session:
            rows = (await database_session.execute(statement)).all()
        return [
            RetrievedChunk(
                text=chunk.text,
                source_name=document.source_name,
                page_number=chunk.page_number,
                score=max(0.0, 1.0 - float(distance_value))
                if (distance_value := _distance_from_row(chunk, embedding)) is not None
                else 0.0,
            )
            for chunk, document in rows
        ]


def _distance_from_row(chunk: ChunkRow, embedding: Sequence[float]) -> float | None:
    if not chunk.embedding or len(chunk.embedding) != len(embedding):
        return None
    dot = sum(a * b for a, b in zip(chunk.embedding, embedding, strict=True))
    left = sum(value * value for value in chunk.embedding) ** 0.5
    right = sum(value * value for value in embedding) ** 0.5
    if left == 0 or right == 0:
        return None
    return float(1 - dot / (left * right))


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode(), usedforsecurity=True).hexdigest()


def _to_row(session: Session) -> SessionRow:
    return SessionRow(
        id=str(session.id),
        access_token_hash=_hash_token(session.access_token),
        input_kind=session.input_kind.value,
        input_text=session.input_text,
        talk_map=_talk_map_to_dict(session.talk_map),
        final_transcript=session.final_transcript,
        state_events=session.state_events,
        feedback=session.feedback,
    )


def _from_row(row: SessionRow, access_token: str) -> Session:
    return Session(
        id=UUID(row.id),
        access_token=access_token,
        input_kind=InputKind(row.input_kind),
        input_text=row.input_text,
        talk_map=_talk_map_from_dict(row.talk_map),
        final_transcript=row.final_transcript,
        state_events=row.state_events or [],
        feedback=row.feedback,
    )


def _talk_map_to_dict(talk_map: TalkMap) -> dict[str, object]:
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
                "status": node.status.value,
            }
            for node in talk_map.nodes
        ],
    }


def _talk_map_from_dict(data: dict[str, Any]) -> TalkMap:
    raw_nodes = data.get("nodes")
    if not isinstance(raw_nodes, list):
        raise ValueError("Stored Talk Map has no nodes")
    return TalkMap(
        title=str(data.get("title", "Speaking practice")),
        nodes=[
            TalkMapNode(
                id=str(node["id"]),
                title=str(node["title"]),
                intent=str(node["intent"]),
                keywords=[str(value) for value in node["keywords"]],
                semantic_summary=str(node["semantic_summary"]),
                starter=str(node["starter"]),
                next_prompt=str(node["next_prompt"]),
                status=NodeStatus(str(node.get("status", NodeStatus.UPCOMING.value))),
            )
            for node in raw_nodes
            if isinstance(node, dict)
        ],
    )
