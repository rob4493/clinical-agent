"""Project clinician-verified reported text; never infer clinical facts from uploads."""

from backend.app.models.schemaRules import ClinicalDataError


def confirmedText(record):
    """Equivalent bounded projection to shared/documentBridge.ts; metadata is not evidence approval."""
    documents = record.get("sourceDocuments", [])
    observations = record.get("clinicianInterpretations", [])
    if not documents and not observations:
        return []
    if not documents or not observations or any(document["verification"] != "clinicianVerified" or document.get("label") != document["id"] or document.get("mediaType") not in {None, "application/pdf", "text/plain"} for document in documents):
        raise ClinicalDataError()
    referenced = set()
    for observation in observations:
        if (observation.get("verification") != "clinicianVerified" or observation.get("interpretationSource") != "documentExtracted"
                or observation.get("date") or observation["text"]["state"] != "present" or not observation["text"].get("value", "").strip()
                or not observation.get("sourceSpans")):
            raise ClinicalDataError()
        for span in observation["sourceSpans"]:
            if not any(document["id"] == span["documentId"] for document in documents):
                raise ClinicalDataError()
            referenced.add(span["documentId"])
    if any(document["id"] not in referenced for document in documents):
        raise ClinicalDataError()
    return [observation["text"]["value"] for observation in observations]
