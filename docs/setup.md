# Local setup

This guide is for running SuaraAI on a development machine. For the existing
EC2 server, use [deployment-ec2.md](deployment-ec2.md).

## Prerequisites

Install these tools:

- Python 3.14 or newer;
- [uv](https://docs.astral.sh/uv/);
- Node.js 24 LTS or newer;
- npm;
- GNU Make;
- Docker and Docker Compose for the full local stack.

The resolved versions in `apps/backend/uv.lock` and
`apps/frontend/package-lock.json` are authoritative for project dependencies.

## Configure the environment

Create a local environment file:

```bash
cp .env.example .env
```

The most important values are:

| Variable | Required for | Notes |
| --- | --- | --- |
| `ASSEMBLYAI_API_KEY` | live transcription | Keep this only in `.env` and the backend environment. |
| `DEEPSEEK_API_KEY` | AI Talk Maps, hints, feedback, and material Q&A | Without it, deterministic guidance remains available. |
| `SUARAAI_DATABASE_URL` | PostgreSQL persistence and document Q&A | The Compose template points at the `database` service. |
| `CADDY_DOMAIN` | local Compose routing or HTTPS deployment | Use `:80` locally; use a real domain on EC2. |

For the Compose stack, keep the PostgreSQL settings consistent:

```env
POSTGRES_DB=suaraai
POSTGRES_USER=suaraai
POSTGRES_PASSWORD=change-me-before-production
SUARAAI_DATABASE_URL=postgresql+asyncpg://suaraai:change-me-before-production@database:5432/suaraai
```

Use a unique password on any shared or public machine. Do not commit `.env`.

## Install dependencies

From the repository root:

```bash
make install
```

This runs `uv sync` for the backend and `npm install` for the frontend.

## Lightweight development mode

Use this when you want to work on the browser flow without PostgreSQL:

```bash
make dev
```

The frontend runs at `http://localhost:5173` and the API runs at
`http://localhost:8000`. With an empty `SUARAAI_DATABASE_URL`, the backend uses
an in-memory repository. Sessions are temporary and the document knowledge
flow requires PostgreSQL.

## Full local stack

Use Docker Compose when you need persistence, document indexing, or to test the
same container layout used on EC2:

```bash
make docker-up
```

Open `http://localhost`. The stack also binds these diagnostic ports to the
local machine only:

- frontend: `http://localhost:8080`;
- backend: `http://localhost:8000`;
- PostgreSQL: `localhost:5432`.

Stop the stack with:

```bash
make docker-down
```

The PostgreSQL data remains in the `suaraai-postgres` Docker volume.

## Verify the API

The health endpoint is:

```text
http://localhost:8000/api/v1/health
```

When using the full Compose stack, the same endpoint is available through the
frontend at:

```text
http://localhost/api/v1/health
```

## Browser requirements

The recording experience needs camera and microphone permission,
`MediaRecorder`, `AudioWorklet`, and a secure browser context. `localhost` is
treated as a secure context by modern browsers. A deployed EC2 instance must
use HTTPS; see [deployment-ec2.md](deployment-ec2.md).

If AssemblyAI is unavailable, local recording and deterministic pause guidance
can still work, but live transcription will not be available. If DeepSeek is
unavailable, the core flow falls back to deterministic Talk Maps, hints, and
feedback; material Q&A requires the provider.

## Common problems

### The microphone is blocked

Open the app over `localhost` or HTTPS, grant browser permission, and check
that no other application is using the microphone.

### The API is unavailable

Check that the backend is running and inspect its logs:

```bash
docker compose logs --tail=100 backend
```

### PostgreSQL does not start

Check the database health status:

```bash
docker compose ps
docker compose logs --tail=100 database
```

If this is a disposable local environment and the volume contains an old
incompatible initialization, recreate it only after confirming that its data
can be discarded.

### The first document upload is slow

The local embedding model is loaded lazily on the first document operation.
Allow extra time for the initial model download and warm-up.

## Quality checks

Run the complete repository checks from the root:

```bash
make check
```

The live LLM conversation test is opt-in because it consumes provider quota:

```bash
SUARAAI_RUN_LIVE_LLM_TESTS=1 make test-backend
```
