"""Shared identifier syntax; availability and approval require registry resolution."""

from typing import Annotated

from pydantic import StringConstraints


# Existing wire IDs contain underscores. These are external values, not Python
# names. Restrict syntax and length without claiming that an ID is approved.
ModuleId = Annotated[str, StringConstraints(
    strict=True, strip_whitespace=False, min_length=1, max_length=64,
    pattern=r"^[A-Za-z][A-Za-z0-9_-]*$",
)]
