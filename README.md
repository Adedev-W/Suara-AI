# SuaraAI

SuaraAI is a realtime English speaking copilot for short explanations. A
speaker enters a topic, notes, or key points; the app turns that material into
a small Talk Map, keeps the speaker oriented while they record, and gives an
actionable practice note afterwards.

The implementation follows the PRD through the web scope of Phase 3:

- Phase 0: a working FastAPI and React monorepo with health checks and CI.
- Phase 1: Talk Map preparation, editable ordering, anonymous sessions, camera
  preview, local video recording, and local playback/download.
- Phase 2: AssemblyAI realtime transcription, browser-local voice activity,
  1.5-second pause detection, readable continuations, and manual hints.
- Phase 3: structured post-recording feedback, PDF/PPTX ingestion, local
  embeddings, PostgreSQL plus pgvector retrieval, and session-scoped Q&A.
- Realtime rescue hints: deterministic progress tracking with an optional,
  event-driven LLM cue prepared from finalized speech and shown when the speaker
  is stuck.
- Conversation log: finalized speech, automatic blank episodes, and every
  visible fallback/AI hint transition are available in a copyable Preview
  timeline. The log stays in the browser for the current recording.

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

Set `ASSEMBLYAI_API_KEY` for realtime transcription. Set `DEEPSEEK_API_KEY` for
provider-backed Talk Maps, real-time hints, speaking feedback, and Q&A. Without
the DeepSeek key, the backend uses deterministic Talk Maps, hints, and feedback;
material Q&A is unavailable.

The default model is `deepseek-flash`. Talk Maps, real-time hints, and speaking
feedback use the DeepSeek Responses API with JSON Schema output. Hint streaming
is buffered by the backend and shown only after the complete JSON object passes
local validation, so a partial model response never reaches the learner. Set
`SUARAAI_DEEPSEEK_MODEL` or `SUARAAI_DEEPSEEK_BASE_URL` only when your DeepSeek
account requires a different supported model or endpoint.

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
| `POST` | `/api/v1/session/{id}/hint` | Generate a contextual rescue hint with a deterministic fallback |
| `POST` | `/api/v1/session/{id}/complete` | Persist transcript/events and generate feedback |
| `POST` | `/api/v1/knowledge/documents` | Parse and index one PDF or PPTX |
| `POST` | `/api/v1/knowledge/query` | Answer from the current session's chunks |

Session routes after preparation require the opaque `X-Session-Token` returned
by the prepare route. The server stores only its SHA-256 hash in PostgreSQL.
The frontend uses the temporary STT token to connect directly to AssemblyAI;
the long-lived provider key never reaches the browser. Realtime transport and
audio assumptions are documented in [docs/realtime.md](docs/realtime.md).
The hint route receives bounded final and partial transcript context. The server
also supplies the original session material and the full Talk Map to the model.
AI-generated maps include three ready-to-say 40–70-word rescue candidates per
node. Live continuations target 30–70 words, but word count is a soft constraint
and never causes a provider retry by itself. The browser prepares candidates
300 ms after finalized transcript context changes, at most once every three
seconds with one request in flight. This can consume provider quota even when no
hint is displayed.

After confirmed speech, a 1.5-second pause shows a matching cached AI suggestion
or local candidate. Noise shorter than 200 ms does not restart the pause timer;
sustained speech does. A fallback can be replaced once within two seconds, only
before speech resumes. The card
remains readable while speaking and can be dismissed. Responses for obsolete
contexts cannot replace it. Legacy maps without candidates retain their short
fallbacks. Provider failures include a diagnostic status in the hint response.

The Preview conversation log distinguishes speech timestamps from transcript
arrival times, records displayed hints and blanks, and includes collapsible
diagnostics for request latency, timeouts, fallback responses and stale results.
The vertical timeline can be copied and closed. Video remains browser-local.

## Quality checks

```bash
make lint
make format-check
make typecheck
make test
make build
```

`make check` runs the aggregate workflow. Focused backend tests cover long Talk
Map input, hint context validation, and deterministic provider fallback. The
realtime conversation test is opt-in because it starts a real server, calls the
configured LLM provider, and consumes provider quota:

```bash
SUARAAI_RUN_LIVE_LLM_TESTS=1 make test-backend
```

The frontend uses Node 24 or newer's built-in test runner and TypeScript
stripping for behavioral tests, without a test dependency. Type checking remains
a separate command. Browser behavior and the text-based backend scenario are documented in
[docs/validation.md](docs/validation.md).

