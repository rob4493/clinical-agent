"""
Output models for the clinical decision-support agent.

These models define response contracts for the planned POST /v1/analyze.
The future pipeline chooses exactly one response type based on what happens at each
evaluation step (module resolution, PID status check, retrieval, citation validation).

Design rules enforced here:
- decisionSupportNotice is a server-controlled Literal constant, not client input.
- urgentWarnings appears first in AgentResponse field definition to signal
  serialization priority; the frontend must also render warnings before other content.
- AuditEvent has no field capable of holding case text, clinical passages,
  generated responses, names, or identifiers. eventType and outcome are
  constrained to approved enum values; no free-text or dict fields are present.
- DataConflict and ClarificationRequired are distinct types with distinct semantics.
- ClarificationRequired.structuredValue serializes as JSON null (not the string "None").
- AgentResponse.caseType is the CaseType enum; arbitrary strings are rejected.
- All models use extra="forbid" so unrecognised fields cause a validation error
  rather than being silently ignored.
"""

from __future__ import annotations

from uuid import UUID
from enum import Enum
from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StrictInt
from backend.app.models.contracts import ModuleId

from backend.app.models.input import CaseType  # re-use existing enum
from backend.app.models.safety import SafetyResult, UrgentWarning  # noqa: F401 (re-export)

# Decision-support notice
# Defined once as a module-level constant so it is identical everywhere it appears.
DecisionSupportNotice: Literal[
    "Decision-support notice: This clinician-facing response is based solely on the "
    "approved knowledge base. It does not establish a diagnosis, replace independent "
    "clinical judgment, or provide patient-specific treatment or prescribing advice."
] = (
    "Decision-support notice: This clinician-facing response is based solely on the "
    "approved knowledge base. It does not establish a diagnosis, replace independent "
    "clinical judgment, or provide patient-specific treatment or prescribing advice."
)

DecisionSupportNoticeLiteral = Literal[
    "Decision-support notice: This clinician-facing response is based solely on the "
    "approved knowledge base. It does not establish a diagnosis, replace independent "
    "clinical judgment, or provide patient-specific treatment or prescribing advice.",
    "Decision-support notice: Evidence support only; not a diagnosis, treatment selection, or substitute for clinical judgment.",
    "Synthetic demonstration only; not a diagnosis, treatment selection, or substitute for clinical judgment."
]

CompetitionNotice = "Decision-support notice: Evidence support only; not a diagnosis, treatment selection, or substitute for clinical judgment."
SyntheticNotice = "Synthetic demonstration only; not a diagnosis, treatment selection, or substitute for clinical judgment."


class ProviderUnavailable(BaseModel):
    """Unavailable generation dependency, distinct from insufficient source evidence."""

    model_config = ConfigDict(extra="forbid", strict=True, hide_input_in_errors=True)
    responseType: Literal["ProviderUnavailable"] = "ProviderUnavailable"
    moduleId: ModuleId | None = None
    message: str = "The language provider is unavailable. Please try again later."
    decisionSupportNotice: DecisionSupportNoticeLiteral = DecisionSupportNotice


class OutsideScope(BaseModel):
    """Request outside the selected module or prohibited decision-support boundary."""

    model_config = ConfigDict(extra="forbid", strict=True, hide_input_in_errors=True)
    responseType: Literal["OutsideScope"] = "OutsideScope"
    moduleId: ModuleId | None = None
    message: str = "This request is outside the selected module's evidence-support scope."
    decisionSupportNotice: DecisionSupportNoticeLiteral = DecisionSupportNotice


# Evidence citation

class EvidenceCitation(BaseModel):
    """An inline source citation attached to a clinical consideration."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    sourceTag: str = Field(
        ...,
        alias="sourceTag",
        description="Source tag from the module's source register (e.g. 'NICE-NG73').",
    )
    jurisdiction: str | None = Field(
        default=None,
        description="Jurisdiction this source applies to (e.g. 'UK', 'US', 'Global').",
    )
    limitation: str | None = Field(
        default=None,
        description="Stated limitation of this source for the current claim, if any.",
    )


# Clinical consideration

class ClinicalConsideration(BaseModel):
    """
    A single evidence-supported clinical consideration.

    isInterpretation distinguishes direct source statements from
    agent interpretations of broader evidence. Required by KB Section 5.
    """

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    text: str = Field(
        ...,
        description=(
            "Consideration text using KB Section 12 preferred vocabulary. "
            "Must not claim a diagnosis or prescribe treatment."
        ),
    )
    citations: list[EvidenceCitation] = Field(
        default_factory=list,
        description="Source citations supporting this consideration.",
    )
    isInterpretation: bool = Field(
        ...,
        alias="isInterpretation",
        description=(
            "True when this is an agent interpretation of broader evidence "
            "rather than a direct statement from a source. "
            "Required by KB Section 5 (direct evidence vs. interpretation)."
        ),
    )


# Missing information

class MissingInformation(BaseModel):
    """One piece of clinically relevant information not supplied in the case."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    fieldName: str = Field(
        ...,
        alias="fieldName",
        description="The case field that was not supplied.",
    )
    clinicalRelevance: str = Field(
        ...,
        alias="clinicalRelevance",
        description="Why this missing information matters for the current evaluation.",
    )


# Reported facts

# Sentinel value used only for display/output rendering (ReportedFacts).
# Must never be used as a substitute for Python None in input validation,
# conflict detection, safety logic, or any business-logic comparison.
UnknownValue: str = "Unknown"


class ReportedFacts(BaseModel):
    """
    Structured summary of what the clinician reported.

    Every field that was not supplied is set to the string 'Unknown'.
    Never converted to 'No', 'Normal', or any clinical assumption.

    UnknownValue ("Unknown") is a display string only. Input and safety
    logic always uses Python None to represent an absent boolean field.
    """

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    ageRange: str = Field(
        default=UnknownValue,
        alias="ageRange",
    )
    painLocation: str = Field(default=UnknownValue, alias="painLocation")
    painQuality: str = Field(default=UnknownValue, alias="painQuality")
    painSeverity: str = Field(default=UnknownValue, alias="painSeverity")
    symptomTiming: str = Field(default=UnknownValue, alias="symptomTiming")
    bowelUrinarySymptoms: str = Field(default=UnknownValue, alias="bowelUrinarySymptoms")
    sexualPain: str = Field(default=UnknownValue, alias="sexualPain")
    menstrualHistory: str = Field(default=UnknownValue, alias="menstrualHistory")
    pregnancyPossible: str = Field(
        default=UnknownValue,
        alias="pregnancyPossible",
        description=(
            "Rendered as 'Yes', 'No', or 'Unknown'. Never inferred. "
            "True becomes 'Yes', False becomes 'No', None becomes 'Unknown'."
        ),
    )
    pidDiagnosedOrPresumed: str = Field(
        default=UnknownValue,
        alias="pidDiagnosedOrPresumed",
        description=(
            "Rendered as 'Yes', 'No', or 'Unknown'. Never inferred. "
            "True becomes 'Yes', False becomes 'No', None becomes 'Unknown'."
        ),
    )
    fertilityStatus: str = Field(default=UnknownValue, alias="fertilityStatus")
    priorTreatments: str = Field(default=UnknownValue, alias="priorTreatments")
    familyHistory: str = Field(default=UnknownValue, alias="familyHistory")


# Pipeline-halt response types

class SelectModuleRequired(BaseModel):
    """
    Returned when moduleHint is NotSure.
    No module resolved; no clinical analysis performed.
    """

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    responseType: Literal["SelectModuleRequired"] = Field(
        default="SelectModuleRequired",
        alias="responseType",
    )
    message: str = Field(
        default=(
            "No clinical module was selected. Please select an approved clinical "
            "module before submitting a case."
        ),
        description="Explanation returned to the clinician.",
    )

    decisionSupportNotice: DecisionSupportNoticeLiteral = Field(
        default=DecisionSupportNotice,
        alias="decisionSupportNotice",
        description="Fixed decision-support notice, rendered last.",
    )



class ModuleUnavailable(BaseModel):
    """
    Returned when the selected module is not active or not approved.
    No clinical analysis performed.
    """

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    responseType: Literal["ModuleUnavailable"] = Field(
        default="ModuleUnavailable",
        alias="responseType",
    )
    moduleHint: ModuleId = Field(
        ...,
        alias="moduleHint",
        description="The module hint value that was submitted.",
    )
    message: str = Field(
        ...,
        description="Explanation stating the module is not available.",
    )

    decisionSupportNotice: DecisionSupportNoticeLiteral = Field(
        default=DecisionSupportNotice,
        alias="decisionSupportNotice",
        description="Fixed decision-support notice, rendered last.",
    )



class DataConflict(BaseModel):
    """
    Returned when pidDiagnosedOrPresumed (structured) explicitly contradicts
    additionalNotes content:
    - False + explicit confirmation statement in notes.
    - True  + explicit denial statement in notes.

    The pipeline halts immediately; no clinical analysis is performed.
    The clinician is asked to resolve the conflict.
    """

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    responseType: Literal["DataConflict"] = Field(
        default="DataConflict",
        alias="responseType",
    )
    fieldName: str = Field(
        ...,
        alias="fieldName",
        description="The structured field that conflicts with free text.",
    )
    structuredValue: str = Field(
        ...,
        alias="structuredValue",
        description="String representation of the structured field value.",
    )
    conflictDescription: str = Field(
        ...,
        alias="conflictDescription",
        description=(
            "Plain-language description of the detected conflict. "
            "Does not echo patient data."
        ),
    )
    clarificationRequest: str = Field(
        ...,
        alias="clarificationRequest",
        description="Question put to the clinician to resolve the conflict.",
    )

    decisionSupportNotice: DecisionSupportNoticeLiteral = Field(
        default=DecisionSupportNotice,
        alias="decisionSupportNotice",
        description="Fixed decision-support notice, rendered last.",
    )



class ClarificationRequired(BaseModel):
    """
    Returned when pidDiagnosedOrPresumed is None and additionalNotes
    contains an explicit PID-confirmation or PID-denial statement.

    This is NOT a contradiction (None means the field was not completed).
    The pipeline halts and asks the clinician to complete the structured field.

    structuredValue is always Python None, which serializes as JSON null.
    It must never be the string "None".
    """

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    responseType: Literal["ClarificationRequired"] = Field(
        default="ClarificationRequired",
        alias="responseType",
    )
    fieldName: str = Field(
        ...,
        alias="fieldName",
        description="The structured field that needs to be completed.",
    )
    structuredValue: None = Field(
        default=None,
        alias="structuredValue",
        description=(
            "Always null. The structured field was not provided by the clinician. "
            "Serializes as JSON null, never the string 'None'."
        ),
    )
    clarificationRequest: str = Field(
        ...,
        alias="clarificationRequest",
        description=(
            "Asks the clinician to set the structured PID-status field "
            "before resubmitting."
        ),
    )

    decisionSupportNotice: DecisionSupportNoticeLiteral = Field(
        default=DecisionSupportNotice,
        alias="decisionSupportNotice",
        description="Fixed decision-support notice, rendered last.",
    )



class EvidenceInsufficientResponse(BaseModel):
    """
    Returned when zero KB chunks are retrieved after filtering, or when
    citation validation fails after one regeneration attempt.
    No clinical content is shown.
    """

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    responseType: Literal["EvidenceInsufficient"] = Field(
        default="EvidenceInsufficient",
        alias="responseType",
    )
    moduleId: ModuleId | None = Field(
        default=None,
        alias="moduleId",
        description="Module that was active when this response was generated.",
    )
    message: str = Field(
        default=(
            "The approved knowledge base does not contain sufficient evidence "
            "to support a response to this request."
        ),
        description="Explanation returned to the clinician.",
    )
    decisionSupportNotice: DecisionSupportNoticeLiteral = Field(
        default=DecisionSupportNotice,
        alias="decisionSupportNotice",
        description="Fixed decision-support notice, rendered last.",
    )




# Full clinical response

class AgentResponse(BaseModel):
    """
    Full clinical response returned when all pipeline steps succeed.

    Field ORDER here is deliberate:
    - urgentWarnings is first so serialisation tools and the frontend
      can find it without inspecting other fields.
    - decisionSupportNotice is last and is a server-controlled Literal
      that cannot be overridden by client input.

    The frontend MUST render urgentWarnings before all other content.
    """

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    # Always first
    urgentWarnings: list[UrgentWarning] = Field(
        default_factory=list,
        alias="urgentWarnings",
        description=(
            "Triggered urgent warnings. Must be rendered BEFORE all other content. "
            "Empty list when no rule fires."
        ),
    )

    # Response identity
    responseType: Literal["AgentResponse"] = Field(
        default="AgentResponse",
        alias="responseType",
    )
    moduleId: ModuleId = Field(
        ...,
        alias="moduleId",
        description="Module that generated this response.",
    )
    # Correction 3: CaseType enum â€” arbitrary strings are rejected.
    caseType: CaseType = Field(
        ...,
        alias="caseType",
        description="'brief' or 'detailed' as submitted. Enum-constrained.",
    )

    # Clinical content
    reportedFacts: ReportedFacts = Field(
        ...,
        alias="reportedFacts",
        description="What the clinician reported. Unknown for any unreported field.",
    )
    supportedInterpretations: list[ClinicalConsideration] = Field(
        default_factory=list,
        alias="supportedInterpretations",
        description="Evidence-supported clinical considerations with inline citations.",
    )
    missingInformation: list[MissingInformation] = Field(
        default_factory=list,
        alias="missingInformation",
        description="Clinically relevant information not supplied.",
    )
    overlappingConsiderations: list[ClinicalConsideration] = Field(
        default_factory=list,
        alias="overlappingConsiderations",
        description="Other conditions to consider based on reported facts.",
    )
    testExamReferral: list[ClinicalConsideration] = Field(
        default_factory=list,
        alias="testExamReferral",
        description="Guideline-supported test, examination, or referral considerations.",
    )

    # Safety result
    urgentWarningResult: SafetyResult = Field(
        ...,
        alias="urgentWarningResult",
        description="Safety metadata; render urgency only for triggered warnings.",
    )

    # Metadata
    evidenceSufficient: bool = Field(
        ...,
        alias="evidenceSufficient",
    )

    # Always last; server-controlled
    decisionSupportNotice: DecisionSupportNoticeLiteral = Field(
        default=DecisionSupportNotice,
        alias="decisionSupportNotice",
        description=(
            "Required clinician-facing notice. Server-controlled Literal. "
            "Cannot be overridden by client input."
        ),
    )


# Audit models

class AuditEventType(str, Enum):
    """
    Approved event types for AuditEvent.eventType.

    Every pipeline action that produces an audit record must map to one of
    these values. Arbitrary strings are rejected.
    """
    analyzeRequest = "analyze_request"
    moduleUnavailable = "module_unavailable"
    dataConflict = "data_conflict"
    clarificationRequired = "clarification_required"
    evidenceInsufficient = "evidence_insufficient"
    citationFallback = "citation_fallback"
    ingest = "ingest"
    approve = "approve"


class AuditOutcome(str, Enum):
    """
    Approved outcome codes for AuditEvent.outcome.

    Every audit record must record exactly one of these outcomes.
    Arbitrary strings are rejected.
    """
    success = "success"
    moduleUnavailable = "module_unavailable"
    dataConflict = "data_conflict"
    clarificationRequired = "clarification_required"
    evidenceInsufficient = "evidence_insufficient"
    citationFallback = "citation_fallback"
    error = "error"


class CitationValidationOutcome(str, Enum):
    """Outcome of the citation validation pipeline."""
    passed = "passed"
    failedRegeneratedPassed = "failed_regenerated_passed"
    failedSafeFallback = "failed_safe_fallback"


class AuditEvent(BaseModel):
    """
    Metadata contract for the planned append-only audit service; no persistence exists.

    CRITICAL: This model must never gain a field that can hold:
    - Case text, query text, or retrieved clinical passages
    - Generated clinical responses or validation text
    - Patient names, MRNs, or any direct identifier
    - Embedding vectors
    - Arbitrary metadata dictionaries

    Every field is structurally constrained:
    - eventType: AuditEventType enum (approved short codes only)
    - outcome: AuditOutcome enum (approved short codes only)
    - moduleId: format-validated identifier or None; registry resolution is required
    - citationValidationOutcome: CitationValidationOutcome enum or None
    - evidenceSufficient: bool or None

    No free-text, message, detail, content, input, query, or dict fields.
    """

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    eventId: UUID = Field(
        ...,
        alias="eventId",
        description="UUID for this audit event.",
    )
    eventType: AuditEventType = Field(
        ...,
        alias="eventType",
        description="Type of event. Enum-constrained to approved values only.",
    )
    moduleId: ModuleId | None = Field(
        default=None,
        alias="moduleId",
        description="Format-validated module identifier or null; future service must validate registry resolution.",
    )
    timestamp: AwareDatetime = Field(
        ...,
        description="Timezone-aware event timestamp; future audit service should emit UTC.",
    )
    outcome: AuditOutcome = Field(
        ...,
        description="Outcome of the event. Enum-constrained to approved values only.",
    )
    evidenceSufficient: bool | None = Field(
        default=None,
        alias="evidenceSufficient",
        description="Whether retrieval returned sufficient evidence, if applicable.",
    )
    citationValidationOutcome: CitationValidationOutcome | None = Field(
        default=None,
        alias="citationValidationOutcome",
        description="Citation validation result, if a generation step occurred.",
    )
    # Explicitly absent fields
    # The following MUST NOT be added:
    #   caseText, queryText, retrievedPassages, generatedResponse,
    #   patientName, patientId, mrn, email, phone, address, embedding,
    #   message, detail, content, input, metadata (any dict or free-text field)


class AuditSummary(BaseModel):
    """
    Metadata contract for the planned GET /v1/admin/audit/summary.
    Raw log lines are never exposed through any endpoint.
    """

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    # Aggregation keys are operational codes, never free-text labels. Module
    # syntax remains extensible; the future service must resolve registry IDs.
    totalEvents: Annotated[StrictInt, Field(ge=0)] = Field(..., alias="totalEvents")
    byEventType: dict[AuditEventType, Annotated[StrictInt, Field(ge=0)]] = Field(..., alias="byEventType")
    byModuleId: dict[ModuleId, Annotated[StrictInt, Field(ge=0)]] = Field(..., alias="byModuleId")
    byOutcome: dict[AuditOutcome, Annotated[StrictInt, Field(ge=0)]] = Field(..., alias="byOutcome")
    periodStart: AwareDatetime = Field(..., alias="periodStart")
    periodEnd: AwareDatetime = Field(..., alias="periodEnd")
