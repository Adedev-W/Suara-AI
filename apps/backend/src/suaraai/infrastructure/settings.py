import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv


@dataclass(frozen=True, slots=True)
class Settings:
    app_name: str = "SuaraAI API"
    api_prefix: str = "/api/v1"
    database_url: str | None = None
    assemblyai_api_key: str | None = field(default=None, repr=False)
    assemblyai_token_ttl_seconds: int = 60
    assemblyai_speech_model: str = "universal-3-5-pro"
    llm_gateway_base_url: str = "https://llm-gateway.assemblyai.com/v1"
    llm_model: str = "qwen3-32B"
    llm_fallback_model: str | None = "gemini-2.5-flash-lite"
    embedding_model: str = "BAAI/bge-small-en-v1.5"
    max_document_size_bytes: int = 10 * 1024 * 1024
    retrieval_limit: int = 5


def load_settings() -> Settings:
    # Load the repository-level file for local development without overriding
    # values injected by Docker, CI, or the process environment.
    repository_root = Path(__file__).resolve().parents[5]
    load_dotenv(repository_root / ".env", override=False)
    defaults = Settings()
    return Settings(
        app_name=os.getenv("SUARAAI_APP_NAME", defaults.app_name),
        api_prefix=os.getenv("SUARAAI_API_PREFIX", defaults.api_prefix),
        database_url=os.getenv("SUARAAI_DATABASE_URL"),
        assemblyai_api_key=os.getenv("ASSEMBLYAI_API_KEY"),
        assemblyai_token_ttl_seconds=int(os.getenv("SUARAAI_ASSEMBLYAI_TOKEN_TTL_SECONDS", "60")),
        assemblyai_speech_model=os.getenv(
            "SUARAAI_ASSEMBLYAI_SPEECH_MODEL", defaults.assemblyai_speech_model
        ),
        llm_gateway_base_url=os.getenv(
            "SUARAAI_LLM_GATEWAY_BASE_URL", defaults.llm_gateway_base_url
        ),
        llm_model=os.getenv("SUARAAI_LLM_MODEL", defaults.llm_model),
        llm_fallback_model=os.getenv(
            "SUARAAI_LLM_FALLBACK_MODEL", defaults.llm_fallback_model or ""
        )
        or None,
        embedding_model=os.getenv("SUARAAI_EMBEDDING_MODEL", defaults.embedding_model),
        max_document_size_bytes=int(
            os.getenv("SUARAAI_MAX_DOCUMENT_SIZE_BYTES", str(defaults.max_document_size_bytes))
        ),
        retrieval_limit=int(os.getenv("SUARAAI_RETRIEVAL_LIMIT", str(defaults.retrieval_limit))),
    )
