import os
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Settings:
    app_name: str = "SuaraAI API"
    api_prefix: str = "/api/v1"


def load_settings() -> Settings:
    defaults = Settings()
    return Settings(
        app_name=os.getenv("SUARAAI_APP_NAME", defaults.app_name),
        api_prefix=os.getenv("SUARAAI_API_PREFIX", defaults.api_prefix),
    )
