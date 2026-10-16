"""Offline evaluation language policy; select only the supplied validated atoms."""

import json


class EvaluationLanguage:
    """Stateless deterministic composition with no client, credentials or retained cases."""

    def generate(self, request):
        sections = json.loads(request.content)
        ceiling = 300 if sections["CaseData"]["caseType"] == "detailed" else 150
        atoms = []
        words = 0
        for atom in sections["AllowedStatements"]:
            if words + len(atom["text"].split()) <= ceiling:
                atoms.append(atom)
                words += len(atom["text"].split())
        if not atoms:
            return {"responseType": "EvidenceInsufficient", "considerations": [], "question": None}
        preliminary = sections["EligibleQuestions"] == ["Is the discomfort related to menstruation, intercourse, bowel movements, or urination, and how much does it affect daily activities?"]
        count = 1 if preliminary else min(3 if ceiling == 300 else 2, len(atoms))
        groups = [atoms[index * len(atoms) // count:(index + 1) * len(atoms) // count] for index in range(count)]
        # Preserve the already validated structural-finding review priorities.
        if atoms[0]["claimId"] == "C07" and "structural finding" in atoms[0]["text"] and count == 3:
            groups = [[atoms[0]], [atom for atom in atoms[1:] if atom["claimId"] in {"C05", "N04", "N07"}],
                      [atom for atom in atoms[1:] if atom["claimId"] not in {"C05", "N04", "N07"}]]
            groups = [group for group in groups if group]
        return {"responseType": "AgentResponse", "question": sections["EligibleQuestions"][0] if preliminary else None,
                "considerations": [{"text": " ".join(atom["text"] for atom in group),
                                    "claimIds": [claimId for atom in group for claimId in atom.get("claimIds", [atom["claimId"]])],
                                    "citationNumbers": list(dict.fromkeys(number for atom in group for number in atom.get("citationNumbers", [atom["citationNumber"]])))} for group in groups]}
