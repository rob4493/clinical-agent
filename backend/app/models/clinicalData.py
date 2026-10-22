"""Generated schema representations; do not edit independently."""
from __future__ import annotations
from typing import ClassVar, Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator
from backend.app.models.schemaRules import Schema, validateNode
SchemaHash = "2c3a7c3beaad9a90f922d1f59636c12870374ccbe1b5ed71db145d5b0073e863"
class ClinicalModel(BaseModel):
    """Transient, bounded records; repr excludes every submitted field."""
    model_config = ConfigDict(extra="forbid", strict=True, hide_input_in_errors=True, allow_inf_nan=False, regex_engine="python-re")
    schemaName: ClassVar[str]
    @model_validator(mode="before")
    @classmethod
    def checkSchema(cls, record):
        if isinstance(record, BaseModel):
            record = record.model_dump(mode="json", exclude_unset=True)
        validateNode(record, Schema if cls.schemaName == "CanonicalCase" else Schema["$defs"][cls.schemaName])
        return record
CaseType = Literal['brief', 'detailed']
class PregnancyContext(ClinicalModel):
    schemaName: ClassVar[str] = "PregnancyContext"
    gestationalWeeks: float | None = Field(default=None, repr=False)
    careSetting: Literal['emergencyDepartment', 'earlyPregnancyService', 'other'] | None = Field(default=None, repr=False)
    pregnancyTestType: Literal['urine', 'serum'] | None = Field(default=None, repr=False)
    pregnancyTestResult: Literal['positive', 'negative', 'indeterminate'] | None = Field(default=None, repr=False)
    serumHcg: float | None = Field(default=None, repr=False)
    ultrasoundRoute: Literal['transvaginal', 'transabdominal'] | None = Field(default=None, repr=False)
    ultrasoundFinding: Literal['noPregnancyVisualized', 'indeterminate', 'intrauterineReported', 'other'] | None = Field(default=None, repr=False)
    previousIntrauterinePregnancyConfirmed: bool | None = Field(default=None, repr=False)
    assistedReproduction: bool | None = Field(default=None, repr=False)
    abdominalTrauma: bool | None = Field(default=None, repr=False)
    clinicallyStable: bool | None = Field(default=None, repr=False)
    heavyBleeding: bool | None = Field(default=None, repr=False)
    hemodynamicInstability: bool | None = Field(default=None, repr=False)
    significantConcernAboutPainOrBleeding: bool | None = Field(default=None, repr=False)
    worseningPelvicPain: bool | None = Field(default=None, repr=False)
class UrgentFindings(ClinicalModel):
    schemaName: ClassVar[str] = "UrgentFindings"
    suddenSevereAbdominalOrPelvicPain: bool | None = Field(default=None, repr=False)
    shoulderPain: bool | None = Field(default=None, repr=False)
    weakness: bool | None = Field(default=None, repr=False)
    dizziness: bool | None = Field(default=None, repr=False)
    fainting: bool | None = Field(default=None, repr=False)
    suddenAcutePelvicPain: bool | None = Field(default=None, repr=False)
    severeAcutePelvicPain: bool | None = Field(default=None, repr=False)
    surgicalEmergencyCannotBeExcluded: bool | None = Field(default=None, repr=False)
    tuboOvarianAbscess: bool | None = Field(default=None, repr=False)
    severeIllness: bool | None = Field(default=None, repr=False)
    nauseaAndVomiting: bool | None = Field(default=None, repr=False)
    oralTemperatureCelsius: float | None = Field(default=None, repr=False)
    oralTemperatureFahrenheit: float | None = Field(default=None, repr=False)
    cannotFollowOrTolerateOutpatientOralTherapy: bool | None = Field(default=None, repr=False)
    noClinicalResponseToOralTherapy: bool | None = Field(default=None, repr=False)
class LegacyCase(ClinicalModel):
    schemaName: ClassVar[str] = "LegacyCase"
    moduleHint: str = Field(..., repr=False, min_length=1, max_length=64, pattern='^[A-Za-z][A-Za-z0-9_-]*$')
    earlyPregnancy: PregnancyContext | None = Field(default=None, repr=False)
    caseType: CaseType = Field(default='detailed', repr=False)
    ageRange: str | None = Field(default=None, repr=False)
    painLocation: str | None = Field(default=None, repr=False)
    painQuality: str | None = Field(default=None, repr=False)
    painSeverity: str | None = Field(default=None, repr=False)
    symptomTiming: str | None = Field(default=None, repr=False)
    bowelUrinarySymptoms: str | None = Field(default=None, repr=False)
    sexualPain: str | None = Field(default=None, repr=False)
    menstrualHistory: str | None = Field(default=None, repr=False)
    urgentFindings: UrgentFindings | None = Field(default=None, repr=False)
    pregnancyPossible: bool | None = Field(default=None, repr=False)
    fertilityStatus: str | None = Field(default=None, repr=False)
    pidDiagnosedOrPresumed: bool | None = Field(default=None, repr=False)
    priorTreatments: str | None = Field(default=None, repr=False)
    familyHistory: str | None = Field(default=None, repr=False)
    additionalNotes: str | None = Field(default=None, repr=False)
FindingState = Literal['unknown', 'notReported', 'absent', 'present', 'notApplicable']
Verification = Literal['unknown', 'notReported', 'unverified', 'needsReview', 'clinicianVerified', 'rejected']
ItemId = str
class ClinicalText(ClinicalModel):
    schemaName: ClassVar[str] = "ClinicalText"
    model_config = ConfigDict(json_schema_extra={'x-stateValue': True})
    state: FindingState = Field(..., repr=False)
    value: str = Field(default=None, repr=False, max_length=2000)
class AgeRange(ClinicalModel):
    schemaName: ClassVar[str] = "AgeRange"
    model_config = ConfigDict(json_schema_extra={'x-stateValue': True})
    state: FindingState = Field(..., repr=False)
    value: str = Field(default=None, repr=False, max_length=200)
class ClinicalFlag(ClinicalModel):
    schemaName: ClassVar[str] = "ClinicalFlag"
    state: FindingState = Field(..., repr=False)
class ClinicalMeasure(ClinicalModel):
    schemaName: ClassVar[str] = "ClinicalMeasure"
    model_config = ConfigDict(json_schema_extra={'x-stateValue': True})
    state: FindingState = Field(..., repr=False)
    value: float = Field(default=None, repr=False)
class ClinicalDate(ClinicalModel):
    schemaName: ClassVar[str] = "ClinicalDate"
    model_config = ConfigDict(json_schema_extra={'x-clinicalDate': True})
    kind: Literal['exact', 'approximate', 'range', 'unknown', 'notReported', 'notApplicable'] = Field(..., repr=False)
    precision: Literal['day', 'month', 'year'] = Field(default=None, repr=False)
    value: str = Field(default=None, repr=False, max_length=10)
    start: str = Field(default=None, repr=False, max_length=10)
    end: str = Field(default=None, repr=False, max_length=10)
class SourceSpan(ClinicalModel):
    schemaName: ClassVar[str] = "SourceSpan"
    model_config = ConfigDict(json_schema_extra={'x-sourceSpan': True})
    id: ItemId = Field(..., repr=False, min_length=1, max_length=64, pattern='^[A-Za-z][A-Za-z0-9-]*$')
    documentId: ItemId = Field(..., repr=False, min_length=1, max_length=64, pattern='^[A-Za-z][A-Za-z0-9-]*$')
    page: int = Field(default=None, repr=False, strict=False, ge=1, le=100000)
    start: int = Field(default=None, repr=False, strict=False, ge=0, le=10000000)
    end: int = Field(default=None, repr=False, strict=False, ge=1, le=10000000)
class Symptom(ClinicalModel):
    schemaName: ClassVar[str] = "Symptom"
    id: ItemId = Field(..., repr=False, min_length=1, max_length=64, pattern='^[A-Za-z][A-Za-z0-9-]*$')
    label: str = Field(..., repr=False, min_length=1, max_length=120)
    state: FindingState = Field(..., repr=False)
    onset: ClinicalDate = Field(default=None, repr=False)
    duration: ClinicalText = Field(default=None, repr=False)
    severity: ClinicalText = Field(default=None, repr=False)
    location: ClinicalText = Field(default=None, repr=False)
    temporalPattern: ClinicalText = Field(default=None, repr=False)
    interpretationSource: Literal['clinicianReported', 'patientReported', 'documentExtracted', 'externalInterpretation', 'unknown', 'notReported'] = Field(default=None, repr=False)
    confidence: float = Field(default=None, repr=False, ge=0, le=1)
    verification: Verification = Field(default=None, repr=False)
    sourceSpans: list[SourceSpan] = Field(default=None, repr=False, min_length=0, max_length=8)
class Investigation(ClinicalModel):
    schemaName: ClassVar[str] = "Investigation"
    id: ItemId = Field(..., repr=False, min_length=1, max_length=64, pattern='^[A-Za-z][A-Za-z0-9-]*$')
    name: str = Field(..., repr=False, min_length=1, max_length=120)
    date: ClinicalDate = Field(default=None, repr=False)
    reportedFinding: ClinicalText = Field(..., repr=False)
    interpretationSource: Literal['clinicianReported', 'patientReported', 'documentExtracted', 'externalInterpretation', 'unknown', 'notReported'] = Field(default=None, repr=False)
    confidence: float = Field(default=None, repr=False, ge=0, le=1)
    verification: Verification = Field(default=None, repr=False)
    sourceSpans: list[SourceSpan] = Field(default=None, repr=False, min_length=0, max_length=8)
class Procedure(ClinicalModel):
    schemaName: ClassVar[str] = "Procedure"
    id: ItemId = Field(..., repr=False, min_length=1, max_length=64, pattern='^[A-Za-z][A-Za-z0-9-]*$')
    name: str = Field(..., repr=False, min_length=1, max_length=120)
    date: ClinicalDate = Field(default=None, repr=False)
    reportedFinding: ClinicalText = Field(default=None, repr=False)
    interpretationSource: Literal['clinicianReported', 'patientReported', 'documentExtracted', 'externalInterpretation', 'unknown', 'notReported'] = Field(default=None, repr=False)
    confidence: float = Field(default=None, repr=False, ge=0, le=1)
    verification: Verification = Field(default=None, repr=False)
    sourceSpans: list[SourceSpan] = Field(default=None, repr=False, min_length=0, max_length=8)
class Treatment(ClinicalModel):
    schemaName: ClassVar[str] = "Treatment"
    id: ItemId = Field(..., repr=False, min_length=1, max_length=64, pattern='^[A-Za-z][A-Za-z0-9-]*$')
    name: str = Field(..., repr=False, min_length=1, max_length=120)
    date: ClinicalDate = Field(default=None, repr=False)
    reportedResponse: ClinicalText = Field(default=None, repr=False)
    interpretationSource: Literal['clinicianReported', 'patientReported', 'documentExtracted', 'externalInterpretation', 'unknown', 'notReported'] = Field(default=None, repr=False)
    confidence: float = Field(default=None, repr=False, ge=0, le=1)
    verification: Verification = Field(default=None, repr=False)
    sourceSpans: list[SourceSpan] = Field(default=None, repr=False, min_length=0, max_length=8)
class Interpretation(ClinicalModel):
    schemaName: ClassVar[str] = "Interpretation"
    id: ItemId = Field(..., repr=False, min_length=1, max_length=64, pattern='^[A-Za-z][A-Za-z0-9-]*$')
    text: ClinicalText = Field(..., repr=False)
    date: ClinicalDate = Field(default=None, repr=False)
    interpretationSource: Literal['clinicianReported', 'patientReported', 'documentExtracted', 'externalInterpretation', 'unknown', 'notReported'] = Field(default=None, repr=False)
    confidence: float = Field(default=None, repr=False, ge=0, le=1)
    verification: Verification = Field(default=None, repr=False)
    sourceSpans: list[SourceSpan] = Field(default=None, repr=False, min_length=0, max_length=8)
class InterpretationConflict(ClinicalModel):
    schemaName: ClassVar[str] = "InterpretationConflict"
    id: ItemId = Field(..., repr=False, min_length=1, max_length=64, pattern='^[A-Za-z][A-Za-z0-9-]*$')
    interpretationIds: list[ItemId] = Field(..., repr=False, min_length=2, max_length=8)
    description: ClinicalText = Field(..., repr=False)
    verification: Verification = Field(default=None, repr=False)
class MissingInformation(ClinicalModel):
    schemaName: ClassVar[str] = "MissingInformation"
    id: ItemId = Field(..., repr=False, min_length=1, max_length=64, pattern='^[A-Za-z][A-Za-z0-9-]*$')
    topic: str = Field(..., repr=False, min_length=1, max_length=120)
    state: Literal['unknown', 'notReported', 'notApplicable'] = Field(..., repr=False)
class SourceDocument(ClinicalModel):
    schemaName: ClassVar[str] = "SourceDocument"
    id: ItemId = Field(..., repr=False, min_length=1, max_length=64, pattern='^[A-Za-z][A-Za-z0-9-]*$')
    label: str = Field(default=None, repr=False, max_length=120)
    mediaType: Literal['application/pdf', 'text/plain', 'image/png', 'image/jpeg'] = Field(default=None, repr=False)
    verification: Verification = Field(..., repr=False)
class UserIntent(ClinicalModel):
    schemaName: ClassVar[str] = "UserIntent"
    model_config = ConfigDict(json_schema_extra={'x-intent': True})
    state: Literal['unknown', 'notReported', 'reported'] = Field(..., repr=False)
    requests: list[Literal['evidenceReview', 'testInterpretation', 'prescribingOrDosing', 'medicationSelection', 'dosing', 'treatmentDuration', 'prescriptionPlan', 'treatmentChange', 'other']] = Field(default=None, repr=False, max_length=9)
    origin: Literal['explicit', 'legacyBoundaryDetection'] = Field(default=None, repr=False)
class UrgentIndicators(ClinicalModel):
    schemaName: ClassVar[str] = "UrgentIndicators"
    suddenSevereAbdominalOrPelvicPain: ClinicalFlag = Field(default=None, repr=False)
    shoulderPain: ClinicalFlag = Field(default=None, repr=False)
    weakness: ClinicalFlag = Field(default=None, repr=False)
    dizziness: ClinicalFlag = Field(default=None, repr=False)
    fainting: ClinicalFlag = Field(default=None, repr=False)
    suddenAcutePelvicPain: ClinicalFlag = Field(default=None, repr=False)
    severeAcutePelvicPain: ClinicalFlag = Field(default=None, repr=False)
    surgicalEmergencyCannotBeExcluded: ClinicalFlag = Field(default=None, repr=False)
    tuboOvarianAbscess: ClinicalFlag = Field(default=None, repr=False)
    severeIllness: ClinicalFlag = Field(default=None, repr=False)
    nauseaAndVomiting: ClinicalFlag = Field(default=None, repr=False)
    oralTemperatureCelsius: ClinicalMeasure = Field(default=None, repr=False)
    oralTemperatureFahrenheit: ClinicalMeasure = Field(default=None, repr=False)
    cannotFollowOrTolerateOutpatientOralTherapy: ClinicalFlag = Field(default=None, repr=False)
    noClinicalResponseToOralTherapy: ClinicalFlag = Field(default=None, repr=False)
class ReportedContext(ClinicalModel):
    schemaName: ClassVar[str] = "ReportedContext"
    painLocation: str | None = Field(default=None, repr=False)
    painQuality: str | None = Field(default=None, repr=False)
    painSeverity: str | None = Field(default=None, repr=False)
    symptomTiming: str | None = Field(default=None, repr=False)
    bowelUrinarySymptoms: str | None = Field(default=None, repr=False)
    sexualPain: str | None = Field(default=None, repr=False)
    menstrualHistory: str | None = Field(default=None, repr=False)
    fertilityStatus: str | None = Field(default=None, repr=False)
    priorTreatments: str | None = Field(default=None, repr=False)
    familyHistory: str | None = Field(default=None, repr=False)
class CanonicalCase(ClinicalModel):
    schemaName: ClassVar[str] = "CanonicalCase"
    model_config = ConfigDict(json_schema_extra={'x-caseIntegrity': True})
    schemaVersion: Literal['1.0.0'] = Field(..., repr=False)
    moduleId: str = Field(..., repr=False, min_length=1, max_length=64, pattern='^(?!NotSure$)[A-Za-z][A-Za-z0-9_-]*$')
    caseType: CaseType = Field(..., repr=False)
    ageRange: AgeRange = Field(default=None, repr=False)
    pregnancyStatus: ClinicalFlag = Field(..., repr=False)
    pidStatus: ClinicalFlag = Field(..., repr=False)
    primaryQuestion: ClinicalText = Field(default=None, repr=False)
    originalNarrative: ClinicalText = Field(..., repr=False)
    symptoms: list[Symptom] = Field(default=None, repr=False, min_length=0, max_length=32)
    urgentIndicators: UrgentIndicators = Field(default=None, repr=False)
    investigations: list[Investigation] = Field(default=None, repr=False, min_length=0, max_length=32)
    previousProcedures: list[Procedure] = Field(default=None, repr=False, min_length=0, max_length=16)
    previousTreatments: list[Treatment] = Field(default=None, repr=False, min_length=0, max_length=16)
    clinicianInterpretations: list[Interpretation] = Field(default=None, repr=False, min_length=0, max_length=16)
    conflictingInterpretations: list[InterpretationConflict] = Field(default=None, repr=False, min_length=0, max_length=16)
    importantMissingInformation: list[MissingInformation] = Field(default=None, repr=False, min_length=0, max_length=16)
    sourceDocuments: list[SourceDocument] = Field(default=None, repr=False, min_length=0, max_length=16)
    userIntent: UserIntent = Field(default=None, repr=False)
    earlyPregnancy: PregnancyContext | None = Field(default=None, repr=False)
    reportedContext: ReportedContext = Field(default=None, repr=False)
PregnancyContext.model_rebuild()
UrgentFindings.model_rebuild()
LegacyCase.model_rebuild()
ClinicalText.model_rebuild()
AgeRange.model_rebuild()
ClinicalFlag.model_rebuild()
ClinicalMeasure.model_rebuild()
ClinicalDate.model_rebuild()
SourceSpan.model_rebuild()
Symptom.model_rebuild()
Investigation.model_rebuild()
Procedure.model_rebuild()
Treatment.model_rebuild()
Interpretation.model_rebuild()
InterpretationConflict.model_rebuild()
MissingInformation.model_rebuild()
SourceDocument.model_rebuild()
UserIntent.model_rebuild()
UrgentIndicators.model_rebuild()
ReportedContext.model_rebuild()
CanonicalCase.model_rebuild()
