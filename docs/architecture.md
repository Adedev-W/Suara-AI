# Architecture

The system has one web client and one FastAPI service. The client owns the
camera preview, MediaRecorder lifecycle, local video object URL, audio capture,
and direct realtime AssemblyAI socket. The API owns session preparation,
provider credentials, persistence, document parsing, embeddings, retrieval,
and post-recording generation.

## Backend boundaries

`domain` contains the vocabulary shared by the use cases: sessions, Talk Map
nodes, flow states, feedback, and knowledge chunks. It has no framework or
provider imports.

`application` contains the use cases and ports:

- `PrepareSession` creates a session and validates the 3–7 node Talk Map rule.
- `UpdateTalkMap` saves speaker ordering changes.
- `CompleteSession` persists the final transcript and flow events, then asks a
  feedback generator for structured practice advice.
- `KnowledgeService` parses, chunks, embeds, stores, retrieves, and answers
  questions within one session.
- `flow.py` contains deterministic matching, progress, filler, repetition, and
  stuck-state rules so realtime assistance does not depend on an LLM round trip.

`infrastructure` implements the ports. The default production path uses the
AssemblyAI LLM Gateway, AssemblyAI temporary STT tokens, PostgreSQL/pgvector,
and the local FastEmbed model. A deterministic Talk Map and feedback provider
keeps the setup flow usable when no AssemblyAI key is configured.

`presentation` translates HTTP requests and provider failures into validated
JSON responses. It does not contain matching or persistence rules.

## Persistence

The schema has three relationships:

```text
speaking_sessions
  ├── knowledge_documents
  │     └── knowledge_chunks (embedding vector(384))
  └── JSONB Talk Map, transcript, flow events, feedback
```

Session IDs are UUIDs. Access tokens are returned once to the browser and only
their SHA-256 hashes are stored. Knowledge queries filter by session before
ranking chunks, so one anonymous session cannot retrieve another session's
materials.

The SQL bootstrap file is used by Docker Compose. The application lifespan also
creates the vector extension and tables, which keeps a separately managed local
PostgreSQL instance usable during development. If the embedding model changes,
its vector dimension must continue to match the `vector(384)` column or the
schema must be migrated deliberately.

## Provider failure boundaries

AssemblyAI and LLM Gateway errors are converted into application errors. A
failure to obtain a realtime token does not prevent the browser from keeping a
local recording; the UI reports that live assistance is unavailable and still
allows review. Document parsing and embedding failures stop that upload and do
not create partial chunks.
