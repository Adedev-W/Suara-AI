from suaraai.domain.health import ServiceHealth


class GetHealthStatus:
    """Return the process health without depending on the HTTP layer."""

    def execute(self) -> ServiceHealth:
        return ServiceHealth(status="ok", service="suaraai-api")
