"""Lossless legacy bridge; rich unimplemented inputs are never silently analyzed."""

from backend.app.models.clinicalData import CanonicalCase
from backend.app.models.schemaRules import ClinicalDataError, Schema, validateNode
from backend.app.models.requestIntent import prescribingIntent
from backend.app.models.documentBridge import confirmedText

LegacyNames = ("painLocation", "painQuality", "painSeverity", "symptomTiming", "bowelUrinarySymptoms", "sexualPain", "menstrualHistory", "fertilityStatus", "priorTreatments", "familyHistory")
FutureCollections = ("symptoms", "investigations", "previousProcedures", "previousTreatments", "conflictingInterpretations", "importantMissingInformation")


def reportState(payload, name, boolean=False):
    if name not in payload:
        return {"state": "notReported"}
    finding = payload[name]
    if finding is None:
        return {"state": "unknown"}
    if boolean:
        return {"state": "present" if finding else "absent"}
    return {"state": "present", "value": finding}


def legacyToCanonical(payload):
    """Convert supplied fields only; do not extract symptoms or select a module."""
    validateNode(payload, Schema["$defs"]["LegacyCase"])
    result = dict(schemaVersion="1.0.0", moduleId=payload["moduleHint"], caseType=payload.get("caseType", "detailed"),
        ageRange=reportState(payload, "ageRange"), pregnancyStatus=reportState(payload, "pregnancyPossible", True),
        pidStatus=reportState(payload, "pidDiagnosedOrPresumed", True), originalNarrative=reportState(payload, "additionalNotes"),
        userIntent={"state": "reported", "requests": ["prescribingOrDosing"], "origin": "legacyBoundaryDetection"} if prescribingIntent(payload.get("additionalNotes")) else {"state": "notReported"})
    if "earlyPregnancy" in payload:
        result["earlyPregnancy"] = payload["earlyPregnancy"]
    context = {name: payload[name] for name in LegacyNames if name in payload}
    if context:
        result["reportedContext"] = context
    if payload.get("urgentFindings") is not None:
        result["urgentIndicators"] = {name: reportState(payload["urgentFindings"], name, not name.startswith("oralTemperature")) for name in payload["urgentFindings"]}
    return CanonicalCase.model_validate(result)


def restoreState(record, boolean=False):
    state = record["state"]
    if state == "unknown":
        return None
    if state == "present":
        return True if boolean else record["value"]
    if state == "absent" and boolean:
        return False
    raise ClinicalDataError()


def canonicalToLegacy(case):
    """Only the implemented compatibility profile may enter existing reasoning."""
    canonical = case if isinstance(case, CanonicalCase) else CanonicalCase.model_validate(case)
    record = canonical.model_dump(mode="json", exclude_unset=True)
    if any(record.get(name) for name in FutureCollections):
        raise ClinicalDataError()
    payload = {"moduleHint": record["moduleId"], "caseType": record["caseType"]}
    for name, field, boolean in [("ageRange", "ageRange", False), ("pregnancyStatus", "pregnancyPossible", True), ("pidStatus", "pidDiagnosedOrPresumed", True), ("originalNarrative", "additionalNotes", False)]:
        if name in record and record[name]["state"] != "notReported":
            payload[field] = restoreState(record[name], boolean)
    if "earlyPregnancy" in record:
        payload["earlyPregnancy"] = record["earlyPregnancy"]
    question = record.get("primaryQuestion", {"state": "notReported"})
    if question["state"] == "present" and question["value"]:
        payload["additionalNotes"] = " ".join(part for part in [payload.get("additionalNotes"), question["value"]] if part)
    elif question["state"] not in {"unknown", "notReported", "present"}:
        raise ClinicalDataError()
    observations = confirmedText(record)
    if observations:
        payload["additionalNotes"] = "\n".join(part for part in [payload.get("additionalNotes"), *observations] if part)
    payload.update(record.get("reportedContext", {}))
    if "urgentIndicators" in record:
        payload["urgentFindings"] = {name: restoreState(finding, not name.startswith("oralTemperature")) for name, finding in record["urgentIndicators"].items() if finding["state"] != "notReported"}
    expected = legacyToCanonical(payload).model_dump(mode="json", exclude_unset=True)["userIntent"]
    intent = record.get("userIntent", {"state": "notReported"})
    if intent["state"] == "reported" and not (expected["state"] == "reported" and intent["requests"] == expected["requests"]):
        raise ClinicalDataError()
    validateNode(payload, Schema["$defs"]["LegacyCase"])
    return payload
