"""Offline bounded JSON Schema subset and explicit clinical metadata invariants."""

import json
import math
import re
from datetime import date
from pathlib import Path

SchemaPath = Path(__file__).resolve().parents[3] / "shared/clinicalData.schema.json"
Schema = json.loads(SchemaPath.read_text(encoding="utf-8"))
SafeMessage = "Invalid clinical data. Check the supported schema version, required fields and permitted values."


class ClinicalDataError(ValueError):
    """Fixed error: never retain a clinical object, path, value or nested exception."""
    def __init__(self):
        super().__init__(SafeMessage)


def checkDate(record):
    kind = record["kind"]
    if kind in {"unknown", "notReported", "notApplicable"}:
        return set(record) == {"kind"}
    if kind == "range":
        if set(record) != {"kind", "start", "end"}:
            return False
        return calendarDate(record["start"], "day") and calendarDate(record["end"], "day") and record["start"] <= record["end"]
    return (set(record) == {"kind", "precision", "value"} and calendarDate(record["value"], record["precision"]))


def calendarDate(text, precision):
    expression = {"day": r"[0-9]{4}-[0-9]{2}-[0-9]{2}", "month": r"[0-9]{4}-[0-9]{2}", "year": r"[0-9]{4}"}[precision]
    if not re.fullmatch(expression, text):
        return False
    try:
        date.fromisoformat(text + ("-01" if precision == "month" else "-01-01" if precision == "year" else ""))
        return True
    except ValueError:
        return False


def validateNode(content, definition, depth=0):
    if depth > 24:
        raise ClinicalDataError()
    if "$ref" in definition:
        return validateNode(content, Schema["$defs"][definition["$ref"].split("/")[-1]], depth + 1)
    if "anyOf" in definition:
        for option in definition["anyOf"]:
            try:
                validateNode(content, option, depth + 1)
                return
            except ClinicalDataError:
                continue
        raise ClinicalDataError()
    if "const" in definition and content != definition["const"] or "enum" in definition and content not in definition["enum"]:
        raise ClinicalDataError()
    kind = definition.get("type")
    if kind == "null" and content is not None or kind == "boolean" and type(content) is not bool:
        raise ClinicalDataError()
    if kind in {"number", "integer"}:
        try:
            finite = type(content) in {int, float} and math.isfinite(content)
        except OverflowError:
            finite = False
        if not finite or kind == "integer" and int(content) != content:
            raise ClinicalDataError()
        if "minimum" in definition and content < definition["minimum"] or "maximum" in definition and content > definition["maximum"]:
            raise ClinicalDataError()
    if kind == "string":
        if not isinstance(content, str) or len(content) < definition.get("minLength", 0) or len(content) > definition.get("maxLength", 65536):
            raise ClinicalDataError()
        if "pattern" in definition and re.fullmatch(definition["pattern"], content) is None:
            raise ClinicalDataError()
    if kind == "array":
        if not isinstance(content, list) or not definition.get("minItems", 0) <= len(content) <= definition.get("maxItems", 64):
            raise ClinicalDataError()
        for entry in content:
            validateNode(entry, definition["items"], depth + 1)
        if definition.get("uniqueItems") and len({json.dumps(entry, sort_keys=True) for entry in content}) != len(content):
            raise ClinicalDataError()
        if definition.get("x-uniqueId") and len({entry[definition["x-uniqueId"]] for entry in content}) != len(content):
            raise ClinicalDataError()
    if kind == "object":
        if not isinstance(content, dict) or len(content) > len(definition["properties"]) or set(content) - set(definition["properties"]) or not set(definition.get("required", ())).issubset(content):
            raise ClinicalDataError()
        for name, entry in content.items():
            validateNode(entry, definition["properties"][name], depth + 1)
        if definition.get("x-stateValue") and ((content["state"] == "present") != ("value" in content)):
            raise ClinicalDataError()
        if definition.get("x-clinicalDate") and not checkDate(content):
            raise ClinicalDataError()
        if definition.get("x-sourceSpan") and (not ("page" in content or "start" in content) or ("start" in content) != ("end" in content) or "start" in content and content["start"] >= content["end"]):
            raise ClinicalDataError()
        if definition.get("x-intent") and ((content["state"] == "reported") != (bool(content.get("requests")) and "origin" in content) or content["state"] != "reported" and set(content) != {"state"}):
            raise ClinicalDataError()
    if definition.get("x-caseIntegrity"):
        checkIntegrity(content)


def checkIntegrity(case):
    """Global identifiers and reference links confer no verification or approval."""
    identifiers = set()
    spans = []
    def visit(record):
        if isinstance(record, dict):
            if "id" in record:
                if record["id"] in identifiers:
                    raise ClinicalDataError()
                identifiers.add(record["id"])
            if "documentId" in record:
                spans.append(record)
            for entry in record.values():
                visit(entry)
        elif isinstance(record, list):
            for entry in record:
                visit(entry)
    visit(case)
    documents = {record["id"] for record in case.get("sourceDocuments", [])}
    interpretations = {record["id"] for record in case.get("clinicianInterpretations", [])}
    if any(span["documentId"] not in documents for span in spans) or any(not set(conflict["interpretationIds"]).issubset(interpretations) for conflict in case.get("conflictingInterpretations", [])):
        raise ClinicalDataError()
    if case.get("earlyPregnancy") is not None and case["moduleId"] != "module_02_early_pregnancy":
        raise ClinicalDataError()
    if len(json.dumps(case, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) > 65536:
        raise ClinicalDataError()
