from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from suaraai.application.get_health_status import GetHealthStatus
from suaraai.infrastructure.container import create_services
from suaraai.infrastructure.database import create_engine, initialize_database
from suaraai.infrastructure.settings import Settings, load_settings
from suaraai.presentation.api.health import create_health_router
from suaraai.presentation.api.knowledge import create_knowledge_router
from suaraai.presentation.api.session import create_session_router
from suaraai.presentation.api.stt import create_stt_router


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved_settings = settings or load_settings()
    engine = (
        create_engine(resolved_settings.database_url) if resolved_settings.database_url else None
    )
    session_factory = None
    if engine is not None:
        from sqlalchemy.ext.asyncio import async_sessionmaker

        session_factory = async_sessionmaker(engine, expire_on_commit=False)
    services = create_services(resolved_settings, session_factory)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        if engine is not None:
            await initialize_database(engine)
        yield
        if engine is not None:
            await engine.dispose()

    application = FastAPI(title=resolved_settings.app_name, version="0.2.0", lifespan=lifespan)
    application.state.services = services
    application.include_router(
        create_health_router(GetHealthStatus()),
        prefix=resolved_settings.api_prefix,
    )
    application.include_router(
        create_session_router(
            services.prepare_session,
            services.update_talk_map,
            services.complete_session,
            services.generate_hint,
        ),
        prefix=resolved_settings.api_prefix,
    )
    application.include_router(
        create_stt_router(services.speech_tokens), prefix=resolved_settings.api_prefix
    )
    application.include_router(
        create_knowledge_router(services.knowledge), prefix=resolved_settings.api_prefix
    )
    return application


app = create_app()
