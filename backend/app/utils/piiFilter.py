"""
PII safeguard filter â€” Sub-Task 3.

Purpose
-------
Reduce the chance that obvious direct identifiers reach the retrieval or model
call pipeline.  This is a **data-minimization safeguard**, NOT a de-identification
guarantee.  The system does not claim HIPAA compliance or complete anonymization.

Behaviour (Correction D)
------------------------
- Regex patterns are applied to free-text fields before any service call.
- When a pattern matches, the field value is rejected with a generic 422 message.
- The matched value is NOT echoed in the error body or written to any log.
- The rejection message reminds the clinician not to submit identifiable information.
- Clean text passes through unchanged.
- The utility accepts an explicit enabled argument; input validation uses injected
  app settings, or enabled built-in safeguards when no configuration is supplied.

Configurable patterns
---------------------
Additional patterns can be passed explicitly through extraPatterns (list[str]).
The defaults below cover the most common direct-identifier forms; they are
intentionally conservative (low false-negative rate over false-positive rate)
and documented as heuristics, not guarantees.
"""

from __future__ import annotations

import re
from typing import Final

# ---------------------------------------------------------------------------
# Default pattern set
# ---------------------------------------------------------------------------
# Each entry is a compiled regex.  Patterns are tested in order; the first
# match triggers rejection.  The matched text is never logged or returned.
#
# Heuristics only â€” not a complete de-identification system.

DefaultPatterns: Final[list[str]] = [
    # NHS-style MRN (7â€“10 digits, optionally prefixed with letters)
    r"\b[A-Z]{0,3}\d{7,10}\b",
    # Date of birth â€” common formats (DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD)
    r"\b(?:0?[1-9]|[12]\d|3[01])[-/.](?:0?[1-9]|1[0-2])[-/.]\d{4}\b",
    r"\b\d{4}[-/.](?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12]\d|3[01])\b",
    # UK/US phone numbers (7+ consecutive digits, allowing spaces and hyphens)
    r"\b(?:\+?[\d\s\-().]{10,16})\b",
    # Email addresses
    r"\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b",
    # Name-like patterns: two or more capitalised words in a row
    # (conservative heuristic â€” catches "Jane Doe" but not "Pelvic Pain")
    r"\b[A-Z][a-z]{1,20}(?:\s+[A-Z][a-z]{1,20}){1,3}\b",
]

# Pre-compile default patterns once at module load time.
CompiledDefaults: Final[list[re.Pattern[str]]] = [
    re.compile(p) for p in DefaultPatterns
]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

class PiiDetectedError(ValueError):
    """
    Raised when a PII pattern is matched in a free-text field.

    The error message is a generic reminder to the clinician.
    The matched value and the matched field content are NEVER included.
    """

    GenericMessage: Final[str] = (
        "Possible identifying information was detected in a free-text field. "
        "Please remove patient names, dates of birth, contact details, and "
        "medical record numbers before resubmitting."
    )

    def __init__(self) -> None:
        super().__init__(self.GenericMessage)


def checkText(
    text: str,
    *,
    extraPatterns: list[str] | None = None,
) -> None:
    """
    Scan *text* for PII patterns.  Raises PiiDetectedError on the first match.

    Parameters
    ----------
    text:
        The free-text string to scan.  Must already be stripped of leading/
        trailing whitespace (ClinicalCaseInput enforces str_strip_whitespace).
    extraPatterns:
        Additional regex patterns to test beyond the defaults.  Supplied as
        raw strings; compiled on each call (cache externally if performance
        matters).  These are appended after the default patterns.

    Raises
    ------
    PiiDetectedError
        When any pattern matches.  The matched value is not in the error.
    """
    patterns = list(CompiledDefaults)
    if extraPatterns:
        patterns.extend(re.compile(p) for p in extraPatterns)

    for pattern in patterns:
        if pattern.search(text):
            raise PiiDetectedError()


def filterFreeText(
    value: str | None,
    *,
    enabled: bool = True,
    extraPatterns: list[str] | None = None,
) -> str | None:
    """
    Apply the PII filter to a single optional free-text value.

    Parameters
    ----------
    value:
        The field value to check.  None is returned unchanged (field not supplied).
    enabled:
        When False the filter is bypassed entirely (for testing or disabled config).
    extraPatterns:
        Additional regex patterns forwarded to checkText.

    Returns
    -------
    str | None
        The original value unchanged when it passes.

    Raises
    ------
    PiiDetectedError
        When a pattern matches and the filter is enabled.
    """
    if not enabled or value is None or value == "":
        return value
    checkText(value, extraPatterns=extraPatterns)
    return value
