"""Deterministic injected provider for offline tests only; never a runtime fallback."""

import json


class CompetitionLanguage:
    """Choose bounded evidence atoms; retain counts only, never case/prompt content."""
    def __init__(self):
        self.calls = 0

    def generate(self, request):
        self.calls += 1
        sections = json.loads(request.content)
        atoms = []
        ceiling = 300 if sections["CaseData"]["caseType"] == "detailed" else 150
        wordCount = 0
        for atom in sections["AllowedStatements"]:
            if wordCount + len(atom["text"].split()) <= ceiling:
                atoms.append(atom)
                wordCount += len(atom["text"].split())
        if not atoms:
            return {"responseType":"EvidenceInsufficient", "considerations":[], "question":None}
        preliminary = sections["EligibleQuestions"] == ["Is the discomfort related to menstruation, intercourse, bowel movements, or urination, and how much does it affect daily activities?"]
        count = 1 if preliminary else min(3 if sections["CaseData"]["caseType"] == "detailed" else 2, len(atoms))
        groups = [atoms[index * len(atoms) // count:(index + 1) * len(atoms) // count] for index in range(count)]
        if atoms[0]["claimId"] == "C07" and "structural finding" in atoms[0]["text"] and count == 3:
            # Match the production policy's three review priorities without adding
            # clinical facts: structural finding, symptom context, test/review limits.
            groups = [[atoms[0]], [atom for atom in atoms[1:] if atom["claimId"] in {"C05", "N04", "N07"}],
                [atom for atom in atoms[1:] if atom["claimId"] not in {"C05", "N04", "N07"}]]
            groups = [group for group in groups if group]
        return {"responseType":"AgentResponse", "question":sections["EligibleQuestions"][0] if preliminary else None, "considerations":[{
            "text":" ".join(atom["text"] for atom in group), "claimIds":[claimId for atom in group for claimId in atom.get("claimIds", [atom["claimId"]])],
            "citationNumbers":list(dict.fromkeys(number for atom in group for number in atom.get("citationNumbers", [atom["citationNumber"]])))} for group in groups]}
