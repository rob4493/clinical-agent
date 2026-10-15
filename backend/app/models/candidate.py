"""Administrative acquisition metadata, never approved clinical evidence."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from backend.app.models.catalog import CatalogText, Digest, SourceRecord
from backend.app.models.contracts import ModuleId

FileLimit = 16 * 1024 * 1024
Category = Literal["ectopic", "pregnancyLoss", "unknownLocation", "pregnancyTest", "hcg", "ultrasound", "urgent", "followUp", "usPathways", "ukPathways", "rh"]


class CandidateRecord(BaseModel):
    """A source to investigate; acquisition establishes neither currency nor approval."""

    model_config = ConfigDict(extra="forbid", strict=True, hide_input_in_errors=True)

    candidateId: ModuleId
    organization: CatalogText
    title: CatalogText
    documentType: Literal["guideline", "practiceBulletin", "clinicalPolicy", "consensusStatement", "clinicalPracticeUpdate", "webpage"]
    jurisdiction: Literal["US", "UK"]
    publicationDate: CatalogText | None = None
    reviewDate: CatalogText | None = None
    amendmentDate: CatalogText | None = None
    reaffirmationDate: CatalogText | None = None
    version: CatalogText | None = None
    officialUrl: str = Field(strict=True, max_length=2048)
    metadataUrls: list[str] = Field(default_factory=list, max_length=10)
    accessedAt: str = Field(strict=True, pattern=r"^\d{4}-\d{2}-\d{2}$")
    fullContentAccessible: bool | None
    localFile: CatalogText | None = Field(default=None, repr=False)
    sha256: Digest | None = None
    fileSize: int | None = Field(default=None, gt=0, le=FileLimit)
    mimeType: Literal["application/pdf", "text/html"] | None = None
    evidenceCategories: list[Category] = Field(min_length=1, max_length=11)
    accessStatus: Literal["downloaded", "webpageOnly", "restricted", "abstractOnly", "unresolved"]
    currencyStatus: Literal["documentedUpdate", "currentlyListed", "unresolved"]
    status: Literal["candidate"] = "candidate"
    notes: str = Field(strict=True, min_length=1, max_length=2000)

    @field_validator("officialUrl", "metadataUrls")
    @classmethod
    def checkUrls(cls, sourceUrls):
        urls = sourceUrls if isinstance(sourceUrls, list) else [sourceUrls]
        for sourceUrl in urls:
            SourceRecord.checkUrl(sourceUrl)
            # Administrative records exclude signed URL parameters and credentials.
            if "?" in sourceUrl:
                raise ValueError("Invalid candidate URL.")
        return sourceUrls

    @field_validator("accessedAt")
    @classmethod
    def checkDate(cls, accessDate):
        from datetime import date
        date.fromisoformat(accessDate)
        return accessDate

    @model_validator(mode="after")
    def checkArtifact(self):
        if len(set(self.evidenceCategories)) != len(self.evidenceCategories):
            raise ValueError("Duplicate candidate category.")
        if self.localFile is None:
            if self.sha256 is not None or self.fileSize is not None or self.accessStatus == "downloaded":
                raise ValueError("Invalid candidate artifact metadata.")
        elif self.sha256 is None or self.fileSize is None or self.mimeType != "application/pdf" or self.accessStatus != "downloaded" or self.fullContentAccessible is not True:
            raise ValueError("Invalid candidate artifact metadata.")
        return self


class CandidateCatalog(BaseModel):
    """Separate Module 2 collection; no clinical lifecycle or citation identifiers."""

    model_config = ConfigDict(extra="forbid", strict=True, hide_input_in_errors=True)
    moduleId: Literal["module_02_early_pregnancy"]
    candidates: list[CandidateRecord] = Field(max_length=200)

    @model_validator(mode="after")
    def checkIds(self):
        if len({candidate.candidateId for candidate in self.candidates}) != len(self.candidates):
            raise ValueError("Duplicate candidate identifier.")
        return self
