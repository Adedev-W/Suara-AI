from dataclasses import dataclass

from tavily import AsyncTavilyClient  # type: ignore[import-untyped]


@dataclass(frozen=True, slots=True)
class SearchResult:
    title: str
    url: str
    domain: str
    snippet: str
    favicon_url: str | None
    image_url: str | None
    published_date: str | None
    score: float | None


class SearchConfigurationError(RuntimeError):
    """Raised when search credentials are not configured on the server."""


class SearchVoice:
    def __init__(self, tavily_api_key: str | None, max_results: int = 5) -> None:
        if not tavily_api_key:
            raise SearchConfigurationError("Search service is not configured")
        self._client = AsyncTavilyClient(api_key=tavily_api_key)
        self._max_results = max_results

    async def close(self) -> None:
        await self._client.close()

    async def execute(self, query: str) -> list[SearchResult]:
        cleaned_query = query.strip()
        if not cleaned_query:
            return []

        response = await self._client.search(
            cleaned_query,
            max_results=self._max_results,
            include_images=True,
            include_favicon=True,
        )
        return [self._normalize_result(result) for result in response.get("results", [])]

    @staticmethod
    def _normalize_result(result: dict[str, object]) -> SearchResult:
        images = result.get("images")
        image_url = None
        if isinstance(images, list) and images:
            first_image = images[0]
            image_url = first_image.get("url") if isinstance(first_image, dict) else first_image

        url = str(result.get("url", ""))
        domain = url.split("//", 1)[-1].split("/", 1)[0]
        score = result.get("score")
        score_value = float(score) if isinstance(score, (int, float, str)) else None
        return SearchResult(
            title=str(result.get("title", "")),
            url=url,
            domain=domain,
            snippet=str(result.get("content", "")),
            favicon_url=str(result["favicon"]) if result.get("favicon") else None,
            image_url=str(image_url) if image_url else None,
            published_date=str(result["published_date"]) if result.get("published_date") else None,
            score=score_value,
        )
