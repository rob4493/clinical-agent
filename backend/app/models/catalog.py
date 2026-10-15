"""Internal provenance records, distinct from approved citation-source entries."""

import ipaddress
import re
from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, StringConstraints, TypeAdapter, field_validator

from backend.app.models.contracts import ModuleId

CatalogText = Annotated[str, StringConstraints(strict=True, min_length=1, max_length=500)]
Digest = Annotated[str, StringConstraints(strict=True, pattern=r"^[a-f0-9]{64}$")]


class SourceRecord(BaseModel):
    """Source provenance only; lifecycle never approves claims or activates modules."""

    model_config = ConfigDict(extra="forbid", strict=True, hide_input_in_errors=True)

    sourceId: ModuleId
    organization: CatalogText
    title: CatalogText
    publicationDate: CatalogText | None = None
    reviewDate: CatalogText | None = None
    jurisdiction: CatalogText | None = None
    verifiedUrl: str | None = Field(default=None, strict=True, max_length=2048)
    knowledgeFile: CatalogText
    status: Literal["pendingReview", "approved", "retired"] = "pendingReview"
    notes: str | None = Field(default=None, strict=True, max_length=1000)

    @field_validator("organization", "title", "publicationDate", "reviewDate", "jurisdiction", "knowledgeFile")
    @classmethod
    def checkText(cls, text: str | None) -> str | None:
        if text is not None and not text.strip():
            raise ValueError("Blank source metadata is not permitted.")
        return text

    @field_validator("verifiedUrl")
    @classmethod
    def checkUrl(cls, sourceUrl: str | None) -> str | None:
        """Preserve supplied URL text; syntax checks establish neither approval nor freshness."""
        if sourceUrl is None:
            return None
        if any(character.isspace() or ord(character) < 32 for character in sourceUrl) or "#" in sourceUrl or "\\" in sourceUrl:
            raise ValueError("Invalid source URL.")
        parsed = urlsplit(sourceUrl)
        if parsed.scheme not in {"http", "https"} or parsed.username is not None or parsed.password is not None or not parsed.hostname:
            raise ValueError("Invalid source URL.")
        host = parsed.hostname
        try:
            ipaddress.ip_address(host)
        except ValueError:
            host = host.encode("idna").decode("ascii").rstrip(".")
            if len(host) > 253 or not all(re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?", label) for label in host.split(".")):
                raise ValueError("Invalid source URL.")
            if all(character in "0123456789." for character in host):
                raise ValueError("Invalid source URL.")
        if parsed.port is not None and not 1 <= parsed.port <= 65535:
            raise ValueError("Invalid source URL.")
        TypeAdapter(HttpUrl).validate_python(sourceUrl)
        return sourceUrl


class SourceCatalog(BaseModel):
    """Bounded catalog document; duplicate identifiers are rejected during loading."""

    model_config = ConfigDict(extra="forbid", strict=True, hide_input_in_errors=True)

    sources: list[SourceRecord] = Field(max_length=200)
