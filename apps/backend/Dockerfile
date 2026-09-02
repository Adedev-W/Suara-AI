FROM ghcr.io/astral-sh/uv:0.8.15 AS uv

FROM python:3.13-slim AS builder

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

COPY --from=uv /uv /uvx /bin/
WORKDIR /app

COPY . .
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --no-dev --no-editable

FROM python:3.13-slim AS runtime

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN addgroup --system suaraai && adduser --system --ingroup suaraai suaraai

WORKDIR /app
COPY --from=builder --chown=suaraai:suaraai /app/.venv ./.venv

USER suaraai
EXPOSE 8000

CMD ["uvicorn", "suaraai.main:app", "--host", "0.0.0.0", "--port", "8000"]
