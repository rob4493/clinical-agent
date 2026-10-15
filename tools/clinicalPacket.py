"""Offline deterministic packet preparation; no importer or runtime evidence writes."""

import hashlib
import json
from pathlib import Path

from backend.app.models.clinicalReview import ArtifactBinding, ClaimAnnotation, ClaimQuestions, ReviewHeader, ReviewTemplate, SourceAnnotation, ThresholdAnnotation, UrgentAnnotation
from backend.app.modules.candidates import CandidateStore
from backend.app.modules.catalog import checkPairs, resolveFile
from backend.app.modules.claims import AppraisalSources, ClaimStore

Questions = {
    "faithfulParaphrase": "Does the paraphrase accurately preserve the source?",
    "recommendationStrength": "Does it preserve recommendation strength?",
    "populationSetting": "Does it preserve population and setting?",
    "jurisdiction": "Is jurisdiction represented correctly?",
    "testSpecificity": "Are test and imaging statements test-specific?",
    "thresholdComplete": "Are threshold value, comparator, units, population and context complete?",
    "limitationAccurate": "Does the limitation accurately explain what the claim does not establish?",
    "proposedUse": "Is the proposed future use appropriate?",
    "anotherSource": "Does the claim require another source?",
    "prohibitedInterpretation": "Could the wording be misread as diagnosis, probability, treatment selection or prescribing?"}


class PacketError(ValueError):
    """Sanitized invalid or stale administrative packet failure."""


def readBytes(root: Path, name: str, limit: int) -> bytes:
    with resolveFile(root, name).open("rb") as stream:
        content = stream.read(limit + 1)
    if len(content) > limit:
        raise ValueError()
    return content


def digestBytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


class PacketSnapshot:
    """Read-only current artifact binding; accepts no reviewer-selected artifact paths."""

    def __init__(self, projectRoot: Path):
        try:
            root = projectRoot.resolve(strict=True)
            self.projectRoot = root
            moduleRoot = root / "backend/app/modules/module02EarlyPregnancy"
            moduleRoot = moduleRoot.resolve(strict=True)
            if not moduleRoot.is_relative_to(root):
                raise ValueError()
            self.claims = ClaimStore(moduleRoot).listClaims()
            self.sources = {source.candidateId: source for source in CandidateStore(moduleRoot).listCandidates() if source.candidateId in AppraisalSources}
            if len(self.claims) != 30 or set(self.sources) != set(AppraisalSources):
                raise ValueError()
            sourceHashes = {sourceId: digestBytes(readBytes(moduleRoot, source.localFile, 16 * 1024 * 1024)) for sourceId, source in self.sources.items()}
            self.binding = ArtifactBinding(acepHash=sourceHashes["m2AcepEarly"], niceHash=sourceHashes["m2NiceNg126"],
                claimsHash=digestBytes(readBytes(moduleRoot, "candidateClaims.json", 262144)),
                catalogHash=digestBytes(readBytes(moduleRoot, "candidates.json", 65536)),
                scopeHash=digestBytes(readBytes(root, "docs/Module02Scope.md", 262144)))
        except (OSError, RuntimeError, ValueError, TypeError):
            raise PacketError("Invalid review packet artifacts.") from None

    def blankTemplate(self) -> ReviewTemplate:
        return ReviewTemplate(templateVersion="1", moduleId="module_02_early_pregnancy", binding=self.binding.model_copy(deep=True),
            header=ReviewHeader(), sources=[SourceAnnotation(candidateId=sourceId) for sourceId in sorted(self.sources)],
            claims=[ClaimAnnotation(claimId=claim.claimId, questions=ClaimQuestions(),
                urgentReview=UrgentAnnotation() if claim.useAssessment == "deterministicReview" else None,
                thresholdReview=ThresholdAnnotation() if claim.threshold is not None else None) for claim in self.claims])

    def validateTemplate(self, content: bytes, *, completed: bool = False) -> ReviewTemplate:
        """Check structure and current hashes only; never import or create SourceReview."""
        try:
            if len(content) > 262144:
                raise ValueError()
            json.loads(content, object_pairs_hook=checkPairs)
            template = ReviewTemplate.model_validate_json(content)
            current = PacketSnapshot(self.projectRoot)
            if template.binding != current.binding:
                raise ValueError()
            expected = {claim.claimId: claim for claim in current.claims}
            if {claim.claimId for claim in template.claims} != set(expected):
                raise ValueError()
            for annotation in template.claims:
                claim = expected[annotation.claimId]
                if (annotation.urgentReview is not None) != (claim.useAssessment == "deterministicReview") or (annotation.thresholdReview is not None) != (claim.threshold is not None):
                    raise ValueError()
                if annotation.futureUses and "urgentRuleCandidate" in annotation.futureUses and annotation.urgentReview is None:
                    # A new proposed safety rule requires a separately scoped packet migration.
                    raise ValueError()
            if completed:
                if template.header.overallStatus != "completed":
                    raise ValueError()
                template.checkComplete()
            return template
        except (ValueError, TypeError):
            raise PacketError("Invalid or stale review template.") from None


def renderTable(rows: list[tuple[str, object]]) -> str:
    def cell(content):
        return str(content).replace("|", "\\|").replace("\n", "<br>") if content is not None else ""
    return "| Field | Content / reviewer response |\n|---|---|\n" + "".join("| " + cell(label) + " | " + cell(content) + " |\n" for label, content in rows)


def renderBlank(section) -> str:
    return renderTable([(field, None) for field in type(section).model_fields])


def renderClaim(claim, snapshot: PacketSnapshot) -> str:
    comparisons = {record.claimId: record for record in snapshot.claims}
    differences = []
    for relation in ["comparedWith", "conflictsWith"]:
        for claimId in getattr(claim, relation):
            comparison = comparisons[claimId]
            differences.append(relation + ": " + comparison.sourceCandidateId + ", " + comparison.documentSection + ", PDF " + str(comparison.pdfPage) + ". " + comparison.statement)
    rows = [("category", claim.category), ("Candidate statement (unchanged)", claim.statement),
        ("Source meaning (existing paraphrase, not quotation)", claim.sourceStatement),
        ("Source", claim.sourceCandidateId), ("Jurisdiction", claim.jurisdiction), ("Section", claim.documentSection),
        ("PDF page (one-based)", claim.pdfPage), ("Printed page", claim.printedPage), ("Population", claim.population),
        ("Conditions", claim.conditions), ("Limitations", claim.limitations), ("Exact test", claim.testName),
        ("Classification", claim.evidenceType), ("Recommendation strength", claim.recommendationStrength),
        ("Threshold structure", json.dumps(claim.threshold.model_dump(), ensure_ascii=False) if claim.threshold else "None recorded; do not invent one."),
        ("Identified source differences", " ".join(differences) if differences else "None recorded for this claim; absence is not proof of agreement."),
        ("Proposed future use (appraisal only)", claim.useAssessment), ("Reviewer decision", None),
        ("Reviewer correction", None), ("Reviewer comments", None), ("Reviewer future uses", None)]
    return "### Claim: " + claim.claimId + "\n\n" + renderTable(rows) + "\n" + renderTable([(question, None) for question in Questions.values()]) + "\n"


def renderPacket(snapshot: PacketSnapshot) -> str:
    """Render each existing claim exactly once, grouping special safety review cards."""
    template = snapshot.blankTemplate()
    packet = "# Module 2 external clinical-review packet\n\nCandidate review only. Module 2 is inactive and unapproved. No decision or proposed use here becomes operational. AGENTS.md governs safety boundaries. This is not patient-specific advice.\n\n"
    packet += "## Blank reviewer header\n\nUse an administrative ID, not a legal name or license number. No patient information or clinical case text in any annotation. Optional organization; no personal contact details. Review date uses YYYY-MM-DD; completion time requires an explicit timezone.\n\n" + renderBlank(template.header)
    packet += "\n## Expected artifact binding (not reviewer attestation)\n\nThese SHA-256 values identify the exact supplied artifacts. Header verification fields above remain blank. Scope version is the content-addressed snapshot `sha256:` followed by scopeHash; no semantic version is invented.\n\n" + renderTable(list(snapshot.binding.model_dump().items()))
    packet += "\n## Source summaries\n\nPossession and integrity verification do not establish clinical approval. Both sources remain candidate.\n\n"
    for sourceId, source in sorted(snapshot.sources.items()):
        packet += "### " + source.organization + "\n\n" + renderTable([("Candidate ID", sourceId), ("Organization", source.organization), ("Exact title", source.title),
            ("Jurisdiction", source.jurisdiction), ("Version", source.version), ("Publication date", source.publicationDate),
            ("Amendment date", source.amendmentDate or "Not recorded"), ("Review date", source.reviewDate or "Not recorded"), ("Access date", source.accessedAt),
            ("Official URL", source.officialUrl), ("Local-document SHA-256", source.sha256), ("PDF pages", AppraisalSources[sourceId][1]),
            ("Currency status", source.currencyStatus), ("Access status", source.accessStatus), ("Full document accessible", source.fullContentAccessible), ("Known limitations", source.notes),
            ("Access restrictions", "The supplied PDF was acquired officially without bypassing controls. Possession does not grant unrestricted redistribution; the team must confirm permitted reviewer sharing.")])
    packet += "\nACOG full documents, RCOG full guideline and SRU full-document gaps remain unresolved where applicable. Current US Rh evidence remains incomplete. ACEP is currently listed but old; its 2017 correction concerned indexing rather than clinical recommendations. NICE is UK guidance; UK pathways must not silently become US pathways. Document update dates do not establish that every recommendation was recently reviewed.\n\n"
    packet += "## Annotation instructions\n\nDecisions: approve, approveWithEdits, reject, needsAdditionalEvidence, outOfScope. Every decision is blank. approveWithEdits needs correction text; reject, needsAdditionalEvidence and outOfScope need comments.\n\nAnswer each of the ten questions yes, no or notApplicable; explain adverse answers and nonapplicability in comments. Approved claims require one or more future-use decisions: retrievalExplanation, testInterpretation, missingInformationPrompt, clinicalConsideration, urgentRuleCandidate, followUpConsideration, jurisdictionNotice, notForAgentUse. notForAgentUse is exclusive. Existing useAssessment is an appraisal proposal, not a reviewer decision.\n\nMissing facts remain Unknown. Clinical prohibitions remain binding even where a source discusses diagnosis or treatment. Do not fill evidence gaps from memory. Three-state pregnancy/PID semantics and explicit selection remain unchanged. New warning criteria, numerical logic and missing facts are not supplied by this packet.\n\n"
    for heading, records in [("General claim review", [claim for claim in snapshot.claims if claim.useAssessment != "deterministicReview" and claim.threshold is None]),
            ("Urgent-rule candidate review", [claim for claim in snapshot.claims if claim.useAssessment == "deterministicReview"]),
            ("Threshold-bearing claim review", [claim for claim in snapshot.claims if claim.threshold is not None])]:
        packet += "## " + heading + "\n\n"
        if heading != "General claim review":
            packet += "Complete every safety verification below; document unavailable elements rather than inventing them. No new warning wording or criteria have been drafted.\n\n"
        for claim in records:
            packet += renderClaim(claim, snapshot)
            if claim.useAssessment == "deterministicReview":
                packet += "#### Explicit urgent-rule verification\n\n" + renderBlank(UrgentAnnotation()) + "\n"
            if claim.threshold is not None:
                packet += "#### Explicit threshold verification\n\n" + renderBlank(ThresholdAnnotation()) + "\n"
    packet += "## Separate overall source-review worksheets\n\nOutcome choices: approved, rejected, changesRequired. All responses are blank. These candidate annotations are not authentic SourceReview records. knowledgeHashVerified concerns the future authoritative knowledge package: none exists, so review it explicitly as notApplicable with comments. Do not substitute a PDF hash for a knowledge hash. metadataHashVerified here concerns the supplied candidate catalogHash; a future approved SourceRecord metadataHash must be computed and reviewed separately.\n\n"
    for source in template.sources:
        packet += "### " + snapshot.sources[source.candidateId].organization + " source decision\n\n" + renderBlank(source) + "\n"
    packet += "## Handoff boundary\n\nSupply both exact PDFs, this packet, instructions and the blank JSON template together. Review every applicable claim and both sources; the team checks completeness and signatures/attestations, then returns the annotated copy through controlled intake. Validate structure and current hashes before considering it. Edits, authentic source approval and activation each require separate authorization. No importer or approval mutation exists. Hashes detect changed bytes, not reviewer identity, qualifications or clinical accuracy.\n"
    return packet
