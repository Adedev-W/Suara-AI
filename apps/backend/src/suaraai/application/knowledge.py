from __future__ import annotations

from uuid import UUID, uuid4

from suaraai.application.ports import (
    DocumentParser,
    EmbeddingService,
    QuestionAnswerer,
    SessionRepository,
)
from suaraai.domain.copilot import DocumentChunk, RetrievedChunk


class KnowledgeInputError(ValueError):
    pass


class KnowledgeSessionNotFoundError(LookupError):
    pass


class KnowledgeService:
    def __init__(
        self,
        repository: SessionRepository,
        embedding_service: EmbeddingService,
        answerer: QuestionAnswerer,
        parser: DocumentParser,
        max_file_size: int,
        retrieval_limit: int,
    ) -> None:
        self._repository = repository
        self._embedding_service = embedding_service
        self._answerer = answerer
        self._parser = parser
        self._max_file_size = max_file_size
        self._retrieval_limit = retrieval_limit

    async def ingest(
        self,
        session_id: UUID,
        access_token: str,
        source_name: str,
        content_type: str | None,
        data: bytes,
    ) -> int:
        if not data or len(data) > self._max_file_size:
            raise KnowledgeInputError("Document is empty or exceeds the configured size limit")
        if await self._repository.get(session_id, access_token) is None:
            raise KnowledgeSessionNotFoundError("Session was not found")
        try:
            document = self._parser.parse(source_name, content_type, data)
            raw_chunks = self._parser.chunk(document)
            embeddings = await self._embedding_service.embed([text for _, text in raw_chunks])
        except KnowledgeInputError:
            raise
        except Exception as exc:
            raise KnowledgeInputError("Document could not be processed") from exc
        if len(raw_chunks) != len(embeddings):
            raise KnowledgeInputError("Embedding service returned an invalid result")
        document_id = uuid4()
        chunks = [
            DocumentChunk(
                document_id=document_id,
                text=text,
                page_number=page_number,
                chunk_index=index,
                embedding=embedding,
            )
            for index, ((page_number, text), embedding) in enumerate(
                zip(raw_chunks, embeddings, strict=True)
            )
        ]
        await self._repository.save_document_chunks(session_id, source_name, chunks)
        return len(chunks)

    async def answer(
        self, session_id: UUID, access_token: str, question: str
    ) -> tuple[str, list[RetrievedChunk]]:
        cleaned_question = question.strip()
        if not cleaned_question:
            raise KnowledgeInputError("Question is required")
        if await self._repository.get(session_id, access_token) is None:
            raise KnowledgeSessionNotFoundError("Session was not found")
        query_embedding = (await self._embedding_service.embed([cleaned_question]))[0]
        context = await self._repository.search_chunks(
            session_id, query_embedding, self._retrieval_limit
        )
        return await self._answerer.answer(cleaned_question, context), context
