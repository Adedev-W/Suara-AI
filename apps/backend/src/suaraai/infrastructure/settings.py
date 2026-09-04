import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv


@dataclass(frozen=True, slots=True)
class Settings:
    app_name: str = "SuaraAI API"
    api_prefix: str = "/api/v1"
    assemblyai_api_key: str | None = field(default=None, repr=False)
    tavily_api_key: str | None = field(default=None, repr=False)
    tavily_max_results: int = 5


def load_settings() -> Settings:
    # Load the repository-level file for local development without overriding
    # values injected by Docker, CI, or the process environment.
    repository_root = Path(__file__).resolve().parents[5]
    load_dotenv(repository_root / ".env", override=False)
    defaults = Settings()
    return Settings(
        app_name=os.getenv("SUARAAI_APP_NAME", defaults.app_name),
        api_prefix=os.getenv("SUARAAI_API_PREFIX", defaults.api_prefix),
        assemblyai_api_key=os.getenv("ASSEMBLYAI_API_KEY"),
        tavily_api_key=os.getenv("TAVILY_API_KEY"),
        tavily_max_results=int(os.getenv("SUARAAI_TAVILY_MAX_RESULTS", "5")),
    )
