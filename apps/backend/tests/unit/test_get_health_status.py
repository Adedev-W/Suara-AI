from suaraai.application.get_health_status import GetHealthStatus
from suaraai.domain.health import ServiceHealth


def test_get_health_status_returns_healthy_service() -> None:
    result = GetHealthStatus().execute()

    assert result == ServiceHealth(status="ok", service="suaraai-api")
