"""Candidate appraisal contracts, separate from runtime evidence and rule contracts."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

from backend.app.models.candidate import Category
from backend.app.models.catalog import Digest
from backend.app.models.contracts import ModuleId

ClaimText = Annotated[str, StringConstraints(strict=True, min_length=1, max_length=1500)]
Amount = Annotated[str, StringConstraints(strict=True, pattern=r"^\d+(?:\.\d+)?$", max_length=30)]


class ClaimThreshold(BaseModel):
    """Source-exact threshold text and context; no arithmetic or unit normalization."""

    model_config = ConfigDict(extra="forbid", strict=True, hide_input_in_errors=True)
    comparator: Literal["<", "<=", "=", ">=", ">"]
    amount: Amount
    unit: ClaimText
    sourceAmount: Amount
    sourceUnit: ClaimText
    population: ClaimText
    context: ClaimText
    sourceCandidateId: ModuleId
    documentSection: ClaimText
    pdfPage: int = Field(ge=1, le=1000)

    @field_validator("unit", "sourceUnit", "population", "context", "documentSection")
    @classmethod
    def checkText(cls, text):
        if not text.strip():
            raise ValueError("Blank threshold context.")
        return text

    @model_validator(mode="after")
    def checkExact(self):
        if self.amount != self.sourceAmount or self.unit != self.sourceUnit:
            raise ValueError("Threshold conversion is prohibited.")
        return self


class CandidateClaim(BaseModel):
    """One located source passage plus a constrained paraphrase, never runtime evidence."""

    model_config = ConfigDict(extra="forbid", strict=True, hide_input_in_errors=True)
    claimId: ModuleId
    moduleId: Literal["module_02_early_pregnancy"]
    category: Category
    statement: ClaimText
    sourceStatement: ClaimText
    sourceCandidateId: ModuleId
    sourceDigest: Digest
    jurisdiction: Literal["US", "UK"]
    documentSection: ClaimText
    pdfPage: int = Field(ge=1, le=1000)
    printedPage: ClaimText | None = None
    evidenceType: Literal["sourceStatement", "agentParaphrase", "limitation", "sourceDifference"]
    population: ClaimText
    conditions: ClaimText
    limitations: ClaimText
    testName: ClaimText | None = None
    threshold: ClaimThreshold | None = None
    conflictsWith: list[ModuleId] = Field(default_factory=list, max_length=30)
    comparedWith: list[ModuleId] = Field(default_factory=list, max_length=30)
    status: Literal["candidate"]
    useAssessment: Literal["deterministicReview", "retrievalExplanation", "neither"]
    recommendationStrength: ClaimText
    reviewerNotes: ClaimText | None = None

    @field_validator("statement", "sourceStatement", "documentSection", "printedPage", "population", "conditions", "limitations", "testName", "recommendationStrength", "reviewerNotes")
    @classmethod
    def checkText(cls, text):
        if text is not None and not text.strip():
            raise ValueError("Blank claim metadata.")
        return text

    @model_validator(mode="after")
    def checkContext(self):
        if self.category in {"pregnancyTest", "hcg", "ultrasound"} and self.testName is None:
            raise ValueError("Test claims require an exact test name.")
        for comparisons in [self.conflictsWith, self.comparedWith]:
            if self.claimId in comparisons or len(set(comparisons)) != len(comparisons):
                raise ValueError("Invalid claim comparison.")
        if set(self.conflictsWith).intersection(self.comparedWith):
            raise ValueError("A comparison cannot also assert a conflict.")
        if self.evidenceType == "sourceDifference" and not (self.conflictsWith or self.comparedWith):
            raise ValueError("Source differences require located comparison claims.")
        if self.threshold is not None:
            threshold = self.threshold
            if self.testName is None or (threshold.sourceCandidateId, threshold.documentSection, threshold.pdfPage, threshold.population) != (self.sourceCandidateId, self.documentSection, self.pdfPage, self.population):
                raise ValueError("Threshold source or population mismatch.")
        return self


class ClaimMatrix(BaseModel):
    """Bounded administrative file with explicit candidate-only lifecycle."""

    model_config = ConfigDict(extra="forbid", strict=True, hide_input_in_errors=True)
    moduleId: Literal["module_02_early_pregnancy"]
    status: Literal["candidate"]
    claims: list[CandidateClaim] = Field(max_length=200)

    @model_validator(mode="after")
    def checkIds(self):
        if len({claim.claimId for claim in self.claims}) != len(self.claims):
            raise ValueError("Duplicate candidate claim identifier.")
        return self
