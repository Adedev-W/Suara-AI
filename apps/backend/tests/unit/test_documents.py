from suaraai.domain.copilot import ExtractedDocument
from suaraai.infrastructure.documents import chunk_document


def test_chunk_document_keeps_page_metadata_and_overlap() -> None:
    document = ExtractedDocument(
        source_name="notes.pdf",
        pages=[(3, "one two three four five six seven eight nine ten")],
    )

    chunks = chunk_document(document, max_chars=24)

    assert len(chunks) > 1
    assert all(page_number == 3 for page_number, _ in chunks)
    assert chunks[0][1].startswith("one two")
    assert chunks[1][1].split()[0] in chunks[0][1].split()
