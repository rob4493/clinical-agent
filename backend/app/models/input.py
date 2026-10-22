"""
Input models for the clinical decision-support agent.

ClinicalCaseInput preserves the legacy request boundary. CanonicalCase supplies
the versioned shared representation through an explicit compatibility adapter.

Design rules enforced here:
- Unknown fields are rejected (model_config extra="forbid").
- Free text is length-capped to prevent abuse; truncation never happens silently
  (the request is rejected if the limit is exceeded).
- Three-state booleans (StrictBool | None) preserve the distinction between
  True / False / Unknown. None is never silently promoted to False.
  Strings ("true", "yes", "1") and integers (0, 1) are rejected; only JSON
  true, false, and null are accepted.
- No dedicated field requests names, MRNs, dates of birth, addresses, or contact
  details. Free-text filtering is a safeguard, not a de-identification guarantee.
- Field ordering and JSON aliases produce clean external names while keeping
  Python attribute names consistent with Pydantic conventions.
"""

from __future__ import annotations

from enum import Enum
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StrictBool, ValidationInfo, field_validator, model_validator
from backend.app.models.contracts import ModuleId
from backend.app.models.safety import UrgentFindings
from backend.app.models.pregnancy import PregnancyContext

# Constants
# Maximum character lengths for free-text fields.
# If a submitted value exceeds these limits the request is rejected with HTTP 422.
# Values are generous enough for clinical narrative but block unreasonably large payloads.
MaxShort = 200    # age range, location, quality, timing, severity (structured)
MaxMedium = 500   # single symptom descriptions, prior treatments, family history
MaxLong = 2000   # additional notes (the most open-ended free-text field)

# Type alias for the three-state clinical boolean.
# StrictBool rejects strings ("true", "yes", "no") and integers (0, 1).
# Only JSON true, false, and null are accepted; null maps to Python None â†’ Unknown.
ThreeStateBool = StrictBool | None


# Enums

class CaseType(str, Enum):
    """Brief cases receive a condensed response; detailed cases receive a full one."""
    brief = "brief"
    detailed = "detailed"


# Input model

class ClinicalCaseInput(BaseModel):
    """
    De-identified clinical case submitted by a clinician.

    Privacy constraints enforced by the schema:
    - No field for patient name, MRN, address, date of birth, or contact details.
    - All free-text fields have explicit maximum lengths.
    - Unknown fields are rejected (extra="forbid").

    Three-state semantics for boolean fields:
    - True  = clinician explicitly asserts Yes.
    - False = clinician explicitly asserts No.
    - None  = not provided; treated as Unknown throughout the pipeline.
              Never converted to False or Normal.

    Strict type enforcement:
    - Only JSON true, false, and null are accepted for boolean fields.
    - Strings ("true", "yes", "1") are rejected.
    - Integers (0, 1) are rejected.
    """

    model_config = ConfigDict(
        extra="forbid",           # reject unknown fields; silent ignore would hide mistakes
        populate_by_name=True,    # allow both alias and Python name
        str_strip_whitespace=True,
        hide_input_in_errors=True, # suppress submitted content in str/repr of errors
    )

    # Module selection (required)
    moduleHint: ModuleId = Field(
        ...,
        alias="moduleHint",
        description=(
            "Clinician-selected clinical module. Must be set before any analysis "
            "is performed. Syntax only is checked here; the registry must "
            "resolve availability and approval. NotSure requests module selection."
        ),
    )

    earlyPregnancy: PregnancyContext | None = Field(default=None, repr=False, description="Optional reported Module 2 facts; omitted fields remain Unknown.")

    # Case type
    caseType: CaseType = Field(
        default=CaseType.detailed,
        alias="caseType",
        description="Brief returns a condensed response; detailed returns a full one.",
    )

    # Demographics
    ageRange: Annotated[str | None, Field(max_length=MaxShort)] = Field(
        default=None,
        alias="ageRange",
        description=(
            "Age range of the patient (e.g. '25-34'). "
            "Exact age is accepted but a range is preferred for data minimisation."
        ),
    )

    # Pain characteristics
    painLocation: Annotated[str | None, Field(max_length=MaxMedium)] = Field(
        default=None,
        alias="painLocation",
        description="Location of reported pain (e.g. 'lower left pelvis, radiating to back').",
    )
    painQuality: Annotated[str | None, Field(max_length=MaxMedium)] = Field(
        default=None,
        alias="painQuality",
        description="Quality of pain (e.g. 'cramping', 'sharp', 'constant dull ache').",
    )
    painSeverity: Annotated[str | None, Field(max_length=MaxShort)] = Field(
        default=None,
        alias="painSeverity",
        description=(
            "Severity description or numeric rating as free text. "
            "Conflicting values are preserved and flagged; they are never averaged."
        ),
    )
    symptomTiming: Annotated[str | None, Field(max_length=MaxMedium)] = Field(
        default=None,
        alias="symptomTiming",
        description="Timing of symptoms in relation to the menstrual cycle or other events.",
    )

    # Associated symptoms
    bowelUrinarySymptoms: Annotated[str | None, Field(max_length=MaxMedium)] = Field(
        default=None,
        alias="bowelUrinarySymptoms",
        description="Bowel or urinary symptoms (e.g. 'painful bowel movements', 'haematuria').",
    )
    sexualPain: Annotated[str | None, Field(max_length=MaxMedium)] = Field(
        default=None,
        alias="sexualPain",
        description="Pain during or after sexual intercourse.",
    )
    menstrualHistory: Annotated[str | None, Field(max_length=MaxMedium)] = Field(
        default=None,
        alias="menstrualHistory",
        description="Menstrual history including cycle regularity, heaviness, and pain.",
    )

    # Reproductive status
    urgentFindings: UrgentFindings | None = Field(default=None, description="Optional explicit urgent findings; never inferred from missing information.")
    # ThreeStateBool = StrictBool | None: only JSON true/false/null accepted.
    pregnancyPossible: ThreeStateBool = Field(
        default=None,
        alias="pregnancyPossible",
        description=(
            "Three-state: True = pregnancy is possible or known; "
            "False = clinician states pregnancy is not possible; "
            "None = not provided / Unknown. "
            "Only JSON true, false, and null accepted. "
            "Strings and integers are rejected. "
            "Never inferred from other fields. "
            "Drives urgent rule U1 evaluation."
        ),
    )
    fertilityStatus: Annotated[str | None, Field(max_length=MaxMedium)] = Field(
        default=None,
        alias="fertilityStatus",
        description="Current fertility goals, history, or treatment (free text).",
    )

    # PID diagnostic status (three-state, strict gate for U3)
    pidDiagnosedOrPresumed: ThreeStateBool = Field(
        default=None,
        alias="pidDiagnosedOrPresumed",
        description=(
            "Three-state PID diagnostic status supplied by the clinician: "
            "True = PID has been diagnosed or presumptively diagnosed by a clinician; "
            "False = clinician explicitly states PID has not been diagnosed; "
            "None = not provided / Unknown. "
            "Only JSON true, false, and null accepted. "
            "Strings and integers are rejected. "
            "U3 CDC PID disposition criteria are evaluated ONLY when this is True. "
            "Never inferred from symptoms, free text, or retrieved evidence. "
            "If this field conflicts with additionalNotes content, the pipeline "
            "returns DataConflict or ClarificationRequired before any clinical analysis."
        ),
    )

    # History
    priorTreatments: Annotated[str | None, Field(max_length=MaxMedium)] = Field(
        default=None,
        alias="priorTreatments",
        description="Previous treatments, responses, and adverse effects.",
    )
    familyHistory: Annotated[str | None, Field(max_length=MaxMedium)] = Field(
        default=None,
        alias="familyHistory",
        description=(
            "Relevant family history. First-degree relative with endometriosis "
            "is specifically noted in NICE-NG73 as increasing likelihood."
        ),
    )

    # Open free-text field
    additionalNotes: Annotated[str | None, Field(max_length=MaxLong)] = Field(
        default=None,
        alias="additionalNotes",
        description=(
            "Additional clinical context (free text). "
            "Processed by the PII safeguard filter before reaching any service. "
            "May provide contextual detail for urgent rule evaluation but NEVER "
            "overrides the structured pidDiagnosedOrPresumed field. "
            "Do not include patient names, MRNs, addresses, or contact details."
        ),
    )

    # ------------------------------------------------------------------
    # PII safeguard filter validator (Sub-Task 3 / Correction D)
    # ------------------------------------------------------------------
    # Applied to every free-text field after length validation.
    # The filter is imported lazily inside the validator to avoid circular
    # imports during early model registration.
    # HTTP validation uses request-local app settings; direct validation defaults
    # to enabled unless a Settings instance is explicitly passed as context.
    # The validator raises PiiDetectedError (a ValueError) on match;
    # Pydantic converts this to a ValidationError with a generic message.
    # Rendered errors hide input. Pydantic errors()/json() retain input by default;
    # never log them or return them directly. The HTTP handler emits safe text only.

    @model_validator(mode="after")
    def checkModuleContext(self):
        if self.earlyPregnancy is not None and self.moduleHint != "module_02_early_pregnancy":
            raise ValueError("Module-specific context is unavailable for this selection.")
        return self

    @field_validator(
        "ageRange",
        "painLocation",
        "painQuality",
        "painSeverity",
        "symptomTiming",
        "bowelUrinarySymptoms",
        "sexualPain",
        "menstrualHistory",
        "fertilityStatus",
        "priorTreatments",
        "familyHistory",
        "additionalNotes",
        mode="after",
    )
    @classmethod
    def applyPiiFilter(cls, fieldText: str | None, info: ValidationInfo) -> str | None:
        """
        Scan free-text field for common PII patterns.

        The filter runs after length validation (mode='after').
        Raises ValueError (â†’ ValidationError) when a pattern matches.
        The matched value is never echoed in the error message.
        """
        from backend.app.utils.piiFilter import filterFreeText  # lazy import
        from backend.app.config import Settings
        from backend.app.utils.validationConfig import ValidationSettings

        settings = info.context if isinstance(info.context, Settings) else ValidationSettings.get()
        return filterFreeText(
            fieldText,
            enabled=settings.piiFilterEnabled if settings is not None else True,
            extraPatterns=settings.piiFilterPatterns if settings is not None else None,
        )
    @model_validator(mode="after")
    def checkSharedContract(self):
        # Native privacy/hooks stay intact; the canonical legacy definition is
        # also authoritative at every deterministic engine input boundary.
        from backend.app.models.schemaRules import Schema, validateNode
        validateNode(self.model_dump(mode="json", exclude_unset=True), Schema["$defs"]["LegacyCase"])
        if self.moduleHint != "NotSure":
            self.toCanonical()
        return self

    def toCanonical(self):
        from backend.app.models.caseBridge import legacyToCanonical
        return legacyToCanonical(self.model_dump(mode="json", exclude_unset=True))

