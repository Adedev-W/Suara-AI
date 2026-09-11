import asyncio

import httpx

from suaraai.main import create_app


def test_health_endpoint_returns_service_status() -> None:
    async def run() -> None:
        application = create_app()
        transport = httpx.ASGITransport(app=application)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/api/v1/health")

            assert response.status_code == 200
            assert response.json() == {"status": "ok", "service": "suaraai-api"}

    asyncio.run(run())
