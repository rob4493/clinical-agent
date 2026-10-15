"""
Safety models.

SafetyResult and UrgentWarning carry the output of the urgent rule evaluation.

Design rules:
- UrgentWarning.ruleId is a literal enum with values fixed by the KB.
- Empty warning lists carry no urgency presentation or reassurance of nonurgency.
- No clinical diagnosis is made here; warnings describe potential emergencies and
  recommend assessment, nothing more.
"""

from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, FiniteFloat
from backend.app.models.contracts import ModuleId


class UrgentRuleId(str, Enum):
    """
    Identifiers for the urgent warning rules defined in KB Section 11.

    U1: Possible ruptured ectopic pregnancy.
    U2: Acute pelvic pain may need immediate assessment.
    U3: Severe PID related presentation (disposition only after clinician dx).
    """
    U1 = "U1"
    U2 = "U2"
    U3 = "U3"


class UrgentFindings(BaseModel):
    """Explicit submitted findings only; omitted criteria remain Unknown."""

    model_config = ConfigDict(extra="forbid", strict=True, hide_input_in_errors=True)

    suddenSevereAbdominalOrPelvicPain: StrictBool | None = None
    shoulderPain: StrictBool | None = None
    weakness: StrictBool | None = None
    dizziness: StrictBool | None = None
    fainting: StrictBool | None = None
    suddenAcutePelvicPain: StrictBool | None = None
    severeAcutePelvicPain: StrictBool | None = None
    surgicalEmergencyCannotBeExcluded: StrictBool | None = None
    tuboOvarianAbscess: StrictBool | None = None
    severeIllness: StrictBool | None = None
    nauseaAndVomiting: StrictBool | None = None
    oralTemperatureCelsius: FiniteFloat | None = None
    oralTemperatureFahrenheit: FiniteFloat | None = None
    cannotFollowOrTolerateOutpatientOralTherapy: StrictBool | None = None
    noClinicalResponseToOralTherapy: StrictBool | None = None


class UrgentWarning(BaseModel):
    """
    A single triggered urgent warning.

    Placed first in the serialized AgentResponse before any clinical content.
    Text must not claim a diagnosis; it recommends emergency assessment.
    """

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    ruleId: UrgentRuleId = Field(
        ...,
        alias="ruleId",
        description="Identifier of the triggered urgent rule.",
    )
    text: str = Field(
        ...,
        description=(
            "Warning text derived from the KB. Must not state or imply a diagnosis. "
            "Recommends emergency or independent assessment."
        ),
    )
    sourceTags: list[str] = Field(
        ...,
        alias="sourceTags",
        description="Source tags supporting this warning (e.g. ['ACOG-ECTOPIC']).",
    )


class SafetyResult(BaseModel):
    """
    Output of the urgent rule evaluation step.

    Included in AgentResponse.urgentWarningResult.
    When no rule fires, warningsTriggered is empty. A future renderer must omit
    the urgency section; this does not establish that the case is nonurgent.
    """

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    moduleId: ModuleId = Field(
        ...,
        alias="moduleId",
        description="Module whose urgent rules were evaluated.",
    )
    rulesEvaluated: list[str] = Field(
        ...,
        alias="rulesEvaluated",
        description="List of rule IDs that were evaluated (not necessarily triggered).",
    )
    warningsTriggered: list[UrgentWarning] = Field(
        default_factory=list,
        alias="warningsTriggered",
        description="Warnings that were triggered. Empty when none fire.",
    )
    criterionStates: dict[str, StrictBool | None] = Field(default_factory=dict, max_length=32, exclude=True, description="Internal criterion truth states; null is Unknown, never false by default. Excluded from existing serialized result contracts.")
