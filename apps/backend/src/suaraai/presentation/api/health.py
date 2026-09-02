from fastapi import APIRouter

from suaraai.application.get_health_status import GetHealthStatus
from suaraai.presentation.api.schemas import HealthResponse


def create_health_router(get_health_status: GetHealthStatus) -> APIRouter:
    router = APIRouter(prefix="/health", tags=["health"])

    @router.get("", response_model=HealthResponse)
    async def health() -> HealthResponse:
        return HealthResponse.from_domain(get_health_status.execute())

    return router
