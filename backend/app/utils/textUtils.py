"""
Text utilities for the clinical decision-support agent — Sub-Task 3.

Provides three utilities used by the LLM service and response assembly:

1. wrapWithDelimiters — wraps a text block between explicit start/end markers
   to make LLM prompt boundaries unambiguous and reduce injection surface.

2. truncateToLimit — hard-truncates text to a character limit, appending an
   ellipsis to signal truncation.  Used for display, never for clinical content.

3. parseJsonSchema — safely parses a raw LLM output string as JSON, returning
   a validated Python dict.  Returns None on any parse or schema error rather
   than raising, so callers can apply safe-fallback logic.
"""

from __future__ import annotations

import json
import re
from typing import Any


# ---------------------------------------------------------------------------
# Delimiter wrapping
# ---------------------------------------------------------------------------

DelimiterStart = "<<<CLINICAL_CONTEXT_START>>>"
DelimiterEnd = "<<<CLINICAL_CONTEXT_END>>>"


def wrapWithDelimiters(text: str, *, start: str = DelimiterStart, end: str = DelimiterEnd) -> str:
    """
    Wrap *text* between explicit start and end delimiter markers.

    Purpose: make prompt section boundaries unambiguous to the LLM, reducing
    the effectiveness of prompt-injection attempts within free-text fields.

    Parameters
    ----------
    text:
        The text block to wrap.
    start:
        Start delimiter (default: module-level constant).
    end:
        End delimiter (default: module-level constant).

    Returns
    -------
    str
        A string in the form: ``{start}\\n{text}\\n{end}``
    """
    return f"{start}\n{text}\n{end}"


# ---------------------------------------------------------------------------
# Length truncation
# ---------------------------------------------------------------------------

def truncateToLimit(text: str, maxChars: int, *, ellipsis: str = "…") -> str:
    """
    Truncate *text* to at most *maxChars* characters, appending *ellipsis*
    when truncation occurs.

    This utility is for **display output only**.  It must never be applied to
    clinical content going into the model call; those fields are length-capped
    at input validation time.

    Parameters
    ----------
    text:
        The string to truncate.
    maxChars:
        Maximum number of characters in the returned string, including the
        ellipsis if appended.
    ellipsis:
        Appended string when truncation occurs.  Defaults to the single Unicode
        ellipsis character (U+2026, one character wide).

    Returns
    -------
    str
        The original string if ``len(text) <= maxChars``, otherwise the
        truncated string with ellipsis.

    Raises
    ------
    ValueError
        When *maxChars* is less than ``len(ellipsis) + 1``.
    """
    if maxChars < len(ellipsis) + 1:
        raise ValueError(
            f"maxChars ({maxChars}) must be at least len(ellipsis)+1 "
            f"({len(ellipsis) + 1}) to leave room for at least one character."
        )
    if len(text) <= maxChars:
        return text
    return text[: maxChars - len(ellipsis)] + ellipsis


# ---------------------------------------------------------------------------
# JSON schema parsing
# ---------------------------------------------------------------------------

def parseJsonSchema(raw: str) -> dict[str, Any] | None:
    """
    Parse *raw* as a JSON object and return the resulting dict.

    Returns None (instead of raising) on any of the following:
    - *raw* is empty or whitespace-only.
    - The string is not valid JSON.
    - The top-level JSON value is not an object (dict).

    LLM output frequently includes markdown fences (```json ... ```) or
    leading/trailing whitespace; both are stripped before parsing.

    Parameters
    ----------
    raw:
        Raw string output from the LLM, potentially with markdown fences.

    Returns
    -------
    dict[str, Any] | None
        Parsed dict on success, None on any failure.
    """
    if not raw or not raw.strip():
        return None

    # Strip markdown code fences if present
    cleaned = raw.strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    cleaned = cleaned.strip()

    try:
        parsed = json.loads(cleaned)
    except (json.JSONDecodeError, ValueError):
        return None

    if not isinstance(parsed, dict):
        return None

    return parsed
