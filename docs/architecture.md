# Architecture

This document describes how the current web application is organized. For the
user-facing product explanation, see [product.md](product.md). For running it,
see [setup.md](setup.md) and [deployment-ec2.md](deployment-ec2.md).

## Runtime shape

```text
Browser
  ├── React UI, camera, local recording, pause detection
  ├── REST requests ────────────────┐
  └── AssemblyAI realtime WebSocket  │
                                     ▼
                              FastAPI backend
                              ├── session and Talk Map use cases
                              ├── temporary AssemblyAI token issuance
                              ├── DeepSeek gateway
                              ├── document parsing and embeddings
                              └── PostgreSQL/pgvector repository
```

The browser connects directly to AssemblyAI for streaming speech. The backend
never sends the long-lived AssemblyAI key to the browser; it issues a
short-lived token first.

## Backend layers

The backend follows a clean-architecture dependency direction:

- `domain` contains the core vocabulary: sessions, Talk Map nodes, hints,
  feedback, and knowledge chunks. It does not import FastAPI or provider SDKs.
- `application` contains use cases and ports. It owns session preparation,
  Talk Map updates, hint generation, completion feedback, and material Q&A.
- `infrastructure` implements provider, database, document, embedding, and
  configuration adapters.
- `presentation` converts HTTP requests into validated application inputs and
  converts application/provider failures into HTTP responses.

Provider and framework details should stay at the infrastructure or
presentation boundary. Domain and application code should remain usable without
the web server or a live provider.

## Main data flow

### Session preparation

The user submits a topic, notes, or key points. The backend validates the input
and creates a Talk Map with three to seven nodes. DeepSeek can generate the map;
the deterministic generator is used when DeepSeek is not configured.

### Realtime practice

The browser captures microphone samples, sends audio to AssemblyAI, reduces
partial and final transcript turns, and runs local pause detection. The backend
receives bounded context only when it needs to generate a rescue hint.

### Session completion

The browser sends the final transcript and compact state events. The backend
stores them with the Talk Map and asks the feedback generator for strengths,
improvements, useful phrases, and a next practice.

### Material questions

The backend parses PDF or PPTX text, splits it into chunks, creates local
384-dimensional embeddings, stores them in pgvector, and ranks chunks within the
current session before asking the language model for an answer.

## Persistence

```text
speaking_sessions
  ├── knowledge_documents
  │     └── knowledge_chunks (vector(384))
  └── JSONB Talk Map, transcript, state events, feedback
```

Session IDs are UUIDs. The browser receives an opaque session token once; only
its SHA-256 hash is stored. Knowledge searches always filter by session before
ranking chunks, preventing one anonymous session from reading another session's
materials.

The application creates the `vector` extension and tables during startup when a
database URL is configured. Docker Compose also mounts the initial SQL
bootstrap. If the embedding model changes, its vector dimension must remain
compatible with `vector(384)` or the schema must be migrated deliberately.

## Failure boundaries

- AssemblyAI token failures do not stop local recording or local pause guidance.
- DeepSeek failures fall back to deterministic Talk Maps, hints, or feedback
  where those adapters exist.
- Document parsing or embedding failures stop the upload without saving partial
  chunks.
- Delayed or stale hint responses are rejected by the browser when their
  context is no longer current.
