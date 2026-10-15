"""Optional reported early-pregnancy context; no inferred results or diagnosis."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, StrictBool


class PregnancyContext(BaseModel):
    """Bounded clinician-reported facts; every omitted field remains Unknown."""

    model_config = ConfigDict(extra="forbid", strict=True, hide_input_in_errors=True)

    gestationalWeeks: Annotated[FiniteFloat | None, Field(ge=0, le=45)] = None
    careSetting: Literal["emergencyDepartment", "earlyPregnancyService", "other"] | None = None
    pregnancyTestType: Literal["urine", "serum"] | None = None
    pregnancyTestResult: Literal["positive", "negative", "indeterminate"] | None = None
    serumHcg: Annotated[FiniteFloat | None, Field(ge=0, le=10000000)] = None
    ultrasoundRoute: Literal["transvaginal", "transabdominal"] | None = None
    ultrasoundFinding: Literal["noPregnancyVisualized", "indeterminate", "intrauterineReported", "other"] | None = None
    previousIntrauterinePregnancyConfirmed: StrictBool | None = None
    assistedReproduction: StrictBool | None = None
    abdominalTrauma: StrictBool | None = None
    clinicallyStable: StrictBool | None = None
    heavyBleeding: StrictBool | None = None
    hemodynamicInstability: StrictBool | None = None
    significantConcernAboutPainOrBleeding: StrictBool | None = None
    worseningPelvicPain: StrictBool | None = None
