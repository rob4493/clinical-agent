"""External candidate annotations; these are never governed source approval records."""

from datetime import date
from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StringConstraints, ValidationInfo, field_validator, model_validator

from backend.app.models.catalog import Digest
from backend.app.models.contracts import ModuleId
from backend.app.models.review import ReviewerId
from backend.app.utils.piiFilter import filterFreeText

ReviewText = Annotated[str, StringConstraints(strict=True, min_length=1, max_length=1500)]
Answer = Literal["yes", "no", "notApplicable"]
FutureUse = Literal["retrievalExplanation", "testInterpretation", "missingInformationPrompt", "clinicalConsideration", "urgentRuleCandidate", "followUpConsideration", "jurisdictionNotice", "notForAgentUse"]


class Annotation(BaseModel):
    """Strict administrative annotations with always-enabled identifier safeguards."""

    model_config = ConfigDict(extra="forbid", strict=True, hide_input_in_errors=True)

    @field_validator("*", mode="after")
    @classmethod
    def checkText(cls, text, info: ValidationInfo):
        # Hashes and controlled identifiers are not free-text reviewer notes.
        if isinstance(text, str) and info.field_name not in {"acepHash", "niceHash", "claimsHash", "catalogHash", "scopeVersion"}:
            if not text.strip():
                raise ValueError("Blank annotation text.")
            filterFreeText(text)
        return text


class ArtifactBinding(BaseModel):
    """Expected byte hashes, separate from unfilled human verification attestations."""

    model_config = ConfigDict(extra="forbid", strict=True, hide_input_in_errors=True)
    acepHash: Digest
    niceHash: Digest
    claimsHash: Digest
    catalogHash: Digest
    scopeHash: Digest


class ReviewHeader(Annotation):
    """Reviewer-entered header; no identity, dates or attestations are inferred."""

    reviewerId: ReviewerId | None = Field(default=None, repr=False)
    qualification: ReviewText | None = Field(default=None, repr=False)
    jurisdiction: ReviewText | None = None
    organization: ReviewText | None = Field(default=None, repr=False)
    reviewDate: date | None = None
    acepHash: Digest | None = None
    niceHash: Digest | None = None
    claimsHash: Digest | None = None
    catalogHash: Digest | None = None
    scopeVersion: Annotated[str, StringConstraints(strict=True, pattern=r"^sha256:[a-f0-9]{64}$")] | None = None
    conflictDeclaration: ReviewText | None = Field(default=None, repr=False)
    overallStatus: Literal["completed"] | None = None
    completedAt: AwareDatetime | None = None


class ClaimQuestions(Annotation):
    """Every question needs an explicit answer, not a default favorable attestation."""

    faithfulParaphrase: Answer | None = None
    recommendationStrength: Answer | None = None
    populationSetting: Answer | None = None
    jurisdiction: Answer | None = None
    testSpecificity: Answer | None = None
    thresholdComplete: Answer | None = None
    limitationAccurate: Answer | None = None
    proposedUse: Answer | None = None
    anotherSource: Answer | None = None
    prohibitedInterpretation: Answer | None = None


class UrgentAnnotation(Annotation):
    """Blank safety review prompts; no new rule criteria or wording are generated."""

    triggerFacts: ReviewText | None = None
    structuredGates: ReviewText | None = None
    exclusions: ReviewText | None = None
    unknownBehavior: ReviewText | None = None
    warningWording: ReviewText | None = None
    urgencyLevel: ReviewText | None = None
    jurisdiction: ReviewText | None = None
    sourceSupport: ReviewText | None = None
    falsePositiveRisk: ReviewText | None = None
    falseNegativeRisk: ReviewText | None = None
    deterministicAppropriate: Answer | None = None
    retrievalOnly: Answer | None = None


class ThresholdAnnotation(Annotation):
    """Human verification of the existing threshold, without completing missing facts."""

    testName: ReviewText | None = None
    specimenModality: ReviewText | None = None
    comparator: ReviewText | None = None
    amount: ReviewText | None = None
    unit: ReviewText | None = None
    population: ReviewText | None = None
    setting: ReviewText | None = None
    timing: ReviewText | None = None
    exceptions: ReviewText | None = None
    repeatRequired: Answer | None = None
    interpretation: Literal["diagnostic", "supportive", "exclusionary", "neither"] | None = None
    sourceDisagreement: ReviewText | None = None


class ClaimAnnotation(Annotation):
    """One claim decision, with explicit correction/comment dependencies."""

    claimId: ModuleId
    decision: Literal["approve", "approveWithEdits", "reject", "needsAdditionalEvidence", "outOfScope"] | None = None
    correction: ReviewText | None = Field(default=None, repr=False)
    comments: ReviewText | None = Field(default=None, repr=False)
    futureUses: list[FutureUse] | None = Field(default=None, max_length=8, min_length=1)
    questions: ClaimQuestions
    urgentReview: UrgentAnnotation | None = None
    thresholdReview: ThresholdAnnotation | None = None

    @model_validator(mode="after")
    def checkDecision(self):
        if self.decision == "approveWithEdits" and self.correction is None:
            raise ValueError("Correction required.")
        if self.decision in {"reject", "needsAdditionalEvidence", "outOfScope"} and self.comments is None:
            raise ValueError("Comments required.")
        if self.futureUses is not None:
            if self.decision not in {"approve", "approveWithEdits"} or len(set(self.futureUses)) != len(self.futureUses):
                raise ValueError("Invalid future-use annotation.")
            if "notForAgentUse" in self.futureUses and len(self.futureUses) != 1:
                raise ValueError("Exclusive future-use annotation required.")
        return self


class SourceAnnotation(Annotation):
    """Candidate-source review worksheet, not SourceReview or an approval mutation."""

    candidateId: ModuleId
    identityVerified: Answer | None = None
    authorityVerified: Answer | None = None
    currencyReviewed: Answer | None = None
    versionReviewed: Answer | None = None
    jurisdictionReviewed: Answer | None = None
    scopeReviewed: Answer | None = None
    limitationsReviewed: Answer | None = None
    urlVerified: Answer | None = None
    knowledgeHashVerified: Answer | None = None
    metadataHashVerified: Answer | None = None
    outcome: Literal["approved", "rejected", "changesRequired"] | None = None
    comments: ReviewText | None = Field(default=None, repr=False)


class ReviewTemplate(Annotation):
    """Nonoperational review form; completion validation does not authorize importing."""

    templateVersion: Literal["1"]
    moduleId: Literal["module_02_early_pregnancy"]
    binding: ArtifactBinding
    header: ReviewHeader
    claims: list[ClaimAnnotation] = Field(min_length=1, max_length=200)
    sources: list[SourceAnnotation] = Field(min_length=2, max_length=2)

    @model_validator(mode="after")
    def checkIds(self):
        if len({claim.claimId for claim in self.claims}) != len(self.claims):
            raise ValueError("Duplicate claim annotation.")
        if {source.candidateId for source in self.sources} != {"m2AcepEarly", "m2NiceNg126"}:
            raise ValueError("Invalid source annotation identifiers.")
        if self.header.overallStatus == "completed":
            self.checkComplete()
        return self

    def checkComplete(self) -> None:
        """Require explicit human completion; no signature or qualification authentication."""
        header = self.header
        if any(getattr(header, field) is None for field in type(header).model_fields if field != "organization"):
            raise ValueError("Incomplete review header.")
        for field in ["acepHash", "niceHash", "claimsHash", "catalogHash"]:
            if getattr(header, field) != getattr(self.binding, field):
                raise ValueError("Review verification hash mismatch.")
        if header.scopeVersion != "sha256:" + self.binding.scopeHash:
            raise ValueError("Review scope snapshot mismatch.")
        for claim in self.claims:
            if claim.decision is None or any(answer is None for answer in claim.questions.model_dump().values()):
                raise ValueError("Incomplete claim review.")
            if claim.decision in {"approve", "approveWithEdits"} and claim.futureUses is None:
                raise ValueError("Future-use decision required.")
            for section in [claim.urgentReview, claim.thresholdReview]:
                if section is not None and any(answer is None for answer in section.model_dump().values()):
                    raise ValueError("Incomplete safety review.")
        for source in self.sources:
            if any(answer is None for answer in source.model_dump().values()):
                raise ValueError("Incomplete source review.")
            if source.knowledgeHashVerified != "notApplicable":
                raise ValueError("No authoritative knowledge package exists.")
