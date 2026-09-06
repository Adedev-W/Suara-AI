# SuaraAI

SuaraAI is a realtime English speaking copilot for short explanations. A
speaker enters a topic, notes, or key points; the app turns that material into
a small Talk Map, keeps the speaker oriented while they record, and gives an
actionable practice note afterwards.

The implementation follows the PRD through the web scope of Phase 3:

- Phase 0: a working FastAPI and React monorepo with health checks and CI.
- Phase 1: Talk Map preparation, editable ordering, anonymous sessions, camera
  preview, local video recording, and local playback/download.
- Phase 2: AssemblyAI realtime transcription, deterministic flow detection,
  FLOWING/HESITATING/STUCK/RECOVERED states, cooldowns, and manual hints.
- Phase 3: structured post-recording feedback, PDF/PPTX ingestion, local
  embeddings, PostgreSQL plus pgvector retrieval, and session-scoped Q&A.

Native app integrations and server-side video storage are outside the selected
web scope. Video stays in the browser as a local object URL. The final
transcript, flow events, Talk Map, and indexed document chunks are stored for a
session when PostgreSQL is configured.

## Repository layout

```text
.
├── apps/backend
│   ├── src/suaraai/domain          # framework-independent models
│   ├── src/suaraai/application     # use cases, ports, and flow rules
│   ├── src/suaraai/infrastructure  # AssemblyAI, LLM, database, files, embeddings
│   ├── src/suaraai/presentation    # FastAPI routes and schemas
│   ├── migrations                   # PostgreSQL and pgvector bootstrap SQL
│   └── tests
├── apps/frontend
│   └── src
│       ├── domain                  # browser-facing API types
│       └── lib                     # audio, STT, Talk Map, flow, and API adapters
├── docs
├── compose.yaml
└── Makefile
```

Backend dependencies point inward: HTTP and provider adapters depend on
application ports, while domain and application code do not depend on FastAPI
or browser APIs. See [docs/architecture.md](docs/architecture.md) for the
runtime boundaries.

## Prerequisites

- Python 3.14 or newer
- [uv](https://docs.astral.sh/uv/)
- Node.js 24 LTS or newer
- npm
- GNU Make
- Docker and Docker Compose for PostgreSQL and production containers

Install dependencies from the repository root:

```bash
make install
```

The lockfiles are authoritative: `apps/backend/uv.lock` and
`apps/frontend/package-lock.json` should be committed after intentional
dependency changes. This repository does not vendor virtual environments,
`node_modules`, model files, or uploaded documents.

## Configuration

Copy the safe template before local development:

```bash
cp .env.example .env
```

Set `ASSEMBLYAI_API_KEY` for realtime transcription and AssemblyAI LLM Gateway
generation. The backend can prepare sessions and produce deterministic local
feedback without the key, but realtime STT and provider-backed Talk Maps,
feedback, and Q&A require it.

`SUARAAI_DATABASE_URL` enables PostgreSQL persistence. When it is empty, the
backend uses an in-memory repository with a 24-hour session lifetime, which is
useful for a lightweight local UI run. The full knowledge pipeline requires
PostgreSQL with the `vector` extension. The default local embedding model is
`BAAI/bge-small-en-v1.5` and produces 384-dimensional vectors, matching the
database schema.

## Development

For a lightweight run without PostgreSQL:

```bash
make dev
```

The frontend runs at `http://localhost:5173` and sends `/api` requests to the
backend at `http://localhost:8000`. FastAPI documentation is available at
`http://localhost:8000/docs`.

For the complete persisted pipeline, set the AssemblyAI key and start the
compose stack:

```bash
make docker-up
```

The web app is served at `http://localhost:8080`, the API at
`http://localhost:8000`, and PostgreSQL at `localhost:5432`. The database
volume is named `suaraai-postgres`.

## API surface

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/health` | Service health |
| `POST` | `/api/v1/session/prepare` | Create an anonymous session and Talk Map |
| `PATCH` | `/api/v1/session/{id}/talk-map` | Save Talk Map ordering/edits |
| `POST` | `/api/v1/stt/token` | Issue a short-lived AssemblyAI browser token |
| `POST` | `/api/v1/session/{id}/complete` | Persist transcript/events and generate feedback |
| `POST` | `/api/v1/knowledge/documents` | Parse and index one PDF or PPTX |
| `POST` | `/api/v1/knowledge/query` | Answer from the current session's chunks |

Session routes after preparation require the opaque `X-Session-Token` returned
by the prepare route. The server stores only its SHA-256 hash in PostgreSQL.
The frontend uses the temporary STT token to connect directly to AssemblyAI;
the long-lived provider key never reaches the browser. Realtime transport and
audio assumptions are documented in [docs/realtime.md](docs/realtime.md).

## Quality checks

```bash
make lint
make format-check
make typecheck
make test
make build
```

`make check` runs the aggregate workflow. The frontend currently has no runtime
test runner in its dependency set, so its `test` script performs the TypeScript
compilation smoke check; browser behavior is covered by the backend contract
tests and the manual acceptance checklist in
[docs/validation.md](docs/validation.md).

Run `make format` when source formatting needs to be applied. Never commit
`.env`, credentials, raw recordings, generated model files, virtual
environments, or `node_modules`.
