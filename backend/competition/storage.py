"""Explicit private evidence location; no discovery, download or fallback search."""

import os
from pathlib import Path


def evidenceRoot(directory: str) -> Path:
    """Use one operator-selected mount; an invalid mount never falls back locally."""
    configured = os.environ.get("CLINICAL_EVIDENCE_ROOT")
    if configured is None:
        return Path(__file__).parent / directory
    if not configured or not Path(configured).is_absolute():
        raise ValueError("Private evidence is unavailable.")
    return Path(configured) / "backend" / "competition" / directory
