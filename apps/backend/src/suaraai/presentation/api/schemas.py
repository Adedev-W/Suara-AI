from typing import Literal

from pydantic import BaseModel

from suaraai.domain.health import ServiceHealth


class HealthResponse(BaseModel):
    status: Literal["ok"]
    service: str

    @classmethod
    def from_domain(cls, health: ServiceHealth) -> HealthResponse:
        return cls(status=health.status, service=health.service)
