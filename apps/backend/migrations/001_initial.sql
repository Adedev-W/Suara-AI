CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS speaking_sessions (
    id VARCHAR(36) PRIMARY KEY,
    access_token_hash VARCHAR(64) NOT NULL,
    input_kind VARCHAR(32) NOT NULL,
    input_text TEXT NOT NULL,
    talk_map JSONB NOT NULL,
    final_transcript TEXT,
    state_events JSONB NOT NULL DEFAULT '[]'::jsonb,
    feedback JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS speaking_sessions_access_token_hash_idx
    ON speaking_sessions (access_token_hash);

CREATE TABLE IF NOT EXISTS knowledge_documents (
    id VARCHAR(36) PRIMARY KEY,
    session_id VARCHAR(36) NOT NULL REFERENCES speaking_sessions (id) ON DELETE CASCADE,
    source_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS knowledge_documents_session_id_idx
    ON knowledge_documents (session_id);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
    id BIGSERIAL PRIMARY KEY,
    document_id VARCHAR(36) NOT NULL REFERENCES knowledge_documents (id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    page_number INTEGER,
    chunk_index INTEGER NOT NULL,
    embedding VECTOR(384) NOT NULL
);

CREATE INDEX IF NOT EXISTS knowledge_chunks_document_id_idx
    ON knowledge_chunks (document_id);

CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_hnsw_idx
    ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);
