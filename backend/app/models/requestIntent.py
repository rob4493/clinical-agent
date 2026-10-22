"""Shared existing request-boundary expressions; no clinical inference or storage."""

import json
import re
from pathlib import Path

Patterns = json.loads((Path(__file__).resolve().parents[3] / "shared/requestIntent.json").read_text(encoding="utf-8"))
Prescribing = re.compile(Patterns["prescribing"], re.IGNORECASE)
General = re.compile(Patterns["general"], re.IGNORECASE)
Personal = re.compile(Patterns["personal"], re.IGNORECASE)


def prescribingIntent(notes):
    text = re.sub(Patterns["negative"], "", notes or "", flags=re.IGNORECASE)
    return any(Prescribing.search(sentence) and not (General.search(sentence) and not Personal.search(sentence))
        for sentence in re.split(r"(?<=[.!?;])\s+", text))
