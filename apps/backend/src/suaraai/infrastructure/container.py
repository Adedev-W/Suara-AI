from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from suaraai.application.knowledge import KnowledgeService
from suaraai.application.ports import FeedbackGenerator, QuestionAnswerer, SessionRepository
from suaraai.application.repositories import InMemorySessionRepository
from suaraai.application.session import (
    CompleteSession,
    DeterministicFeedbackGenerator,
    DeterministicHintGenerator,
    DeterministicTalkMapGenerator,
    GenerateHint,
    PrepareSession,
    UpdateTalkMap,
)
from suaraai.infrastructure.assemblyai import AssemblyAISpeechTokenService
from suaraai.infrastructure.database import PostgresSessionRepository
from suaraai.infrastructure.documents import LocalDocumentParser
from suaraai.infrastructure.embeddings import LocalEmbeddingService
from suaraai.infrastructure.hint_generator import ResilientHintGenerator
from suaraai.infrastructure.llm_gateway import AssemblyAILlmGateway
from suaraai.infrastructure.settings import Settings


@dataclass(slots=True)
class ApplicationServices:
    repository: SessionRepository
    prepare_session: PrepareSession
    update_talk_map: UpdateTalkMap
    complete_session: CompleteSession
    generate_hint: GenerateHint
    speech_tokens: AssemblyAISpeechTokenService
    knowledge: KnowledgeService


def create_services(
    settings: Settings,
    session_factory: async_sessionmaker[AsyncSession] | None = None,
) -> ApplicationServices:
    repository: SessionRepository
    if session_factory is not None:
        repository = PostgresSessionRepository(session_factory)
    else:
        repository = InMemorySessionRepository()

    gateway = AssemblyAILlmGateway(
        api_key=settings.assemblyai_api_key,
        model=settings.llm_model,
        base_url=settings.llm_gateway_base_url,
        fallback_model=settings.llm_fallback_model,
    )
    generator = gateway if settings.assemblyai_api_key else DeterministicTalkMapGenerator()
    feedback_generator: FeedbackGenerator = (
        gateway if settings.assemblyai_api_key else DeterministicFeedbackGenerator()
    )
    hint_generator = (
        ResilientHintGenerator(gateway, DeterministicHintGenerator())
        if settings.assemblyai_api_key
        else DeterministicHintGenerator()
    )
    answerer: QuestionAnswerer = gateway
    embedding_service = LocalEmbeddingService(settings.embedding_model)
    return ApplicationServices(
        repository=repository,
        prepare_session=PrepareSession(repository, generator),
        update_talk_map=UpdateTalkMap(repository),
        complete_session=CompleteSession(repository, feedback_generator),
        generate_hint=GenerateHint(repository, hint_generator),
        speech_tokens=AssemblyAISpeechTokenService(
            settings.assemblyai_api_key,
            settings.assemblyai_token_ttl_seconds,
            settings.assemblyai_speech_model,
        ),
        knowledge=KnowledgeService(
            repository,
            embedding_service,
            answerer,
            LocalDocumentParser(),
            settings.max_document_size_bytes,
            settings.retrieval_limit,
        ),
    )
