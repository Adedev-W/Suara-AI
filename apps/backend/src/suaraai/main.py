from fastapi import FastAPI

from suaraai.application.get_health_status import GetHealthStatus
from suaraai.infrastructure.settings import Settings, load_settings
from suaraai.presentation.api.health import create_health_router


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved_settings = settings or load_settings()
    application = FastAPI(title=resolved_settings.app_name, version="0.1.0")
    application.include_router(
        create_health_router(GetHealthStatus()),
        prefix=resolved_settings.api_prefix,
    )
    return application


app = create_app()
