"""
Health check endpoint.

GET /health returns a minimal liveness response.
No credentials, patient data, or clinical content are included.
"""

from __future__ import annotations

from fastapi import APIRouter, Request
from pydantic import BaseModel

router = APIRouter(tags=["Health"])


class HealthResponse(BaseModel):
    """Response body for the liveness check."""

    status: str
    version: str


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Liveness check",
    description="Returns HTTP 200 when the application is running.",
)
async def health(request: Request) -> HealthResponse:
    """Return application liveness status."""
    return HealthResponse(
        status="ok",
        version=request.app.version,
    )
