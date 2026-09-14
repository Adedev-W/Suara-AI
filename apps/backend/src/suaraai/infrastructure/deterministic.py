from __future__ import annotations

import re
from collections.abc import Sequence
from math import ceil

from suaraai.domain.copilot import Feedback, Hint, InputKind, TalkMap, TalkMapNode


class DeterministicTalkMapGenerator:
    async def generate(self, input_kind: InputKind, input_text: str) -> TalkMap:
        del input_kind
        cleaned = input_text.strip()[:10_000]
        title_source = next(
            (line.strip() for line in cleaned.splitlines() if line.strip()), cleaned
        )
        title = _shorten(title_source.rstrip("."), 160) or "Speaking practice"
        concepts = _extract_concepts(cleaned)
        labels = [
            "Context",
            "Main idea",
            "How it works",
            "Why it matters",
            "Example",
            "Supporting idea",
            "Conclusion",
        ]
        starters = [
            "To begin with...",
            "The main idea is...",
            "This works by...",
            "This matters because...",
            "For example...",
            "Another useful point is...",
            "To sum up...",
        ]
        nodes = [
            TalkMapNode(
                id=f"node-{index + 1}",
                title=labels[index],
                intent=f"Explain {_shorten(concept, 200)}",
                keywords=_keywords_for(concept, labels[index]),
                semantic_summary=f"Cover {_shorten(concept, 460)}.",
                starter=starters[index],
                next_prompt=f"What is the most useful point about {labels[index].lower()}?",
            )
            for index, concept in enumerate(concepts)
        ]
        return TalkMap(title=title, nodes=nodes)


class DeterministicHintGenerator:
    async def generate_hint(
        self,
        talk_map: TalkMap,
        active_index: int,
        recent_transcript: str,
        covered_keywords: Sequence[str],
        previous_hints: Sequence[str],
    ) -> Hint:
        del recent_transcript, previous_hints
        node = talk_map.nodes[active_index]
        covered = {keyword.casefold().strip() for keyword in covered_keywords}
        keyword = next(
            (value for value in node.keywords if value.casefold().strip() not in covered),
            node.keywords[-1],
        )
        return Hint(
            level=2,
            keyword=keyword,
            starter=node.starter,
            next_idea=node.next_prompt,
        )


class DeterministicFeedbackGenerator:
    async def generate_feedback(self, transcript: str, talk_map: TalkMap) -> Feedback:
        covered_topics = ", ".join(node.title for node in talk_map.nodes[:3])
        return Feedback(
            summary=f"You explained your topic through {covered_topics}.",
            strengths=[
                "You completed a spoken explanation without relying on a full script.",
                "Your recording created a clear starting point for practice.",
            ],
            improvements=[
                "Add one concrete example to make the explanation easier to follow.",
                "Use a short pause between ideas instead of filling every gap.",
                "Practice the next transition until it feels natural.",
            ],
            examples=[
                "Try: The main idea is...",
                "Try: The reason this matters is...",
            ],
            next_practice=(
                "Record the same explanation once more and focus on smoother transitions."
            ),
        )


_SECTION_SPLIT_RE = re.compile(r"(?:\n+|(?<=[.!?])\s+|;\s+)")
_WORD_RE = re.compile(r"[a-z0-9']+", re.IGNORECASE)
_STOP_WORDS = frozenset(
    {
        "about",
        "after",
        "also",
        "and",
        "because",
        "before",
        "but",
        "from",
        "have",
        "into",
        "that",
        "their",
        "there",
        "these",
        "this",
        "those",
        "with",
    }
)


def _shorten(value: str, max_length: int) -> str:
    normalized = " ".join(value.split())
    if len(normalized) <= max_length:
        return normalized
    shortened = normalized[: max_length - 1].rsplit(" ", 1)[0]
    return f"{shortened or normalized[: max_length - 1]}…"


def _extract_concepts(input_text: str) -> list[str]:
    concepts = [part.strip(" -,:") for part in _SECTION_SPLIT_RE.split(input_text) if part.strip()]
    if len(concepts) == 1:
        words = concepts[0].split()
        if len(words) > 36:
            chunk_size = ceil(len(words) / 4)
            concepts = [
                " ".join(words[index : index + chunk_size])
                for index in range(0, len(words), chunk_size)
            ]
    if len(concepts) > 7:
        bucket_size = ceil(len(concepts) / 7)
        concepts = [
            " ".join(concepts[index : index + bucket_size])
            for index in range(0, len(concepts), bucket_size)
        ][:7]
    defaults = ["the context", "the main idea", "the practical result"]
    while len(concepts) < 3:
        concepts.append(defaults[len(concepts)])
    return concepts[:7]


def _keywords_for(concept: str, fallback: str) -> list[str]:
    keywords: list[str] = []
    for word in _WORD_RE.findall(concept.casefold()):
        if len(word) < 3 or word in _STOP_WORDS or word in keywords:
            continue
        keywords.append(word[:48])
        if len(keywords) == 5:
            break
    return keywords or [fallback.casefold()]
