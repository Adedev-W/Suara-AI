<picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/dark_overview.png">
    <source media="(prefers-color-scheme: light)" srcset="assets/light_overview.png">
    <img alt="Suara AI logo" src="assets/light_overview.png" width="180">
</picture>

SuaraAI is a clean-architecture monorepo with a FastAPI backend and a React
frontend. The initial application exposes an API health check and renders its
status in the browser.

## Repository layout

```text
.
├── apps
│   ├── backend      # Python 3.14, FastAPI, and uv
│   └── frontend     # React, TypeScript, Vite, and Tailwind CSS
├── .github/workflows/ci.yml
├── compose.yaml
└── Makefile
```

Both applications follow the dependency rule of clean architecture: outer
layers can depend on inner layers, while domain and application code do not
depend on frameworks or transport details.

## Prerequisites

- Python 3.14 or newer
- [uv](https://docs.astral.sh/uv/)
- Node.js 24 LTS or newer
- npm
- GNU Make
- Docker, only for production-image workflows

Dependencies are intentionally not vendored. Install them from the repository
root when the required tools are available:

```bash
make install
```

The first installation creates `apps/backend/uv.lock` and
`apps/frontend/package-lock.json`. Commit both lockfiles so subsequent installs
and CI runs resolve the same dependency versions.

The frontend uses TypeScript 7 for compilation and the TypeScript 6 compatibility
package for ESLint's compiler API integration.

## Development

Start both development servers:

```bash
make dev
```

The frontend is available at `http://localhost:5173` and proxies `/api` requests
to the backend at `http://localhost:8000`. FastAPI documentation is available at
`http://localhost:8000/docs`.

The servers can also be started independently with `make dev-backend` and
`make dev-frontend`.

## Quality checks

```bash
make lint
make typecheck
make test
make build
```

Run `make format` to format source files. Run `make check` to execute the same
non-mutating checks used by CI.

## API

`GET /api/v1/health` returns:

```json
{
  "status": "ok",
  "service": "suaraai-api"
}
```

Copy `.env.example` to `.env` to override the documented defaults. Vite reads
`VITE_API_BASE_URL` at build time. Backend settings use the `SUARAAI_` prefix.
Never commit a populated `.env` file.

## Production containers

The containers are production-only. Local development uses uv and npm directly
on the host.

```bash
make docker-build
make docker-up
```

The composed frontend is served at `http://localhost:8080`. Nginx serves the
single-page application and forwards `/api` to the backend container. The
backend is also exposed at `http://localhost:8000` for API access and docs.
