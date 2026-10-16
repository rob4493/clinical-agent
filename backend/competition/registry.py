"""Competition availability is independent of authentic approval and activation."""

from types import MappingProxyType

from backend.app.models.catalog import SourceRecord
from backend.app.modules.registry import ModuleRegistry, ModuleSelectionError, ModuleUnavailableError
from backend.competition.integrity import PackageHash
from backend.competition.package import loadPackage
from backend.competition.retrieval import EvidenceRoot


class CompetitionRegistry(ModuleRegistry):
    """Resolve one explicitly selected competition module without promoting its config."""

    def __init__(self, authenticRegistry: ModuleRegistry, root=EvidenceRoot, expectedHash=PackageHash, includeModule2=None, publicPackages=False):
        self.publicEvaluation = publicPackages
        if publicPackages:
            from backend.competition.evaluation import EvaluationRoot, verifyReview
            review = verifyReview()
            root = EvaluationRoot / "modules/module1"
            expectedHash = review["files"]["evaluation/modules/module1/claims.json"]
        self.root = root
        self.expectedHash = expectedHash
        package = loadPackage(root, expectedHash, "competition")
        config = authenticRegistry.getModule(package.moduleId)
        config = config.model_copy(update={"moduleName": "Endometriosis & Chronic Pelvic Pain — competition evaluation",
            "description": "Separate source-verified competition evidence; not production clinical approval.",
            "urgentRuleIds": ["U1", "U2", "U3"]})
        if publicPackages:
            config = config.model_copy(update={"moduleName": "Endometriosis & Chronic Pelvic Pain",
                "description": "Project-authored summaries reviewedForEvaluation and competitionReady; not approved for patient care."})
        # Preserve inactive/pending authentic configuration even in this isolated
        # registry. Availability is the separately verified competition policy.
        self.moduleConfigs = MappingProxyType({package.moduleId: config})
        self.moduleRoots = MappingProxyType({package.moduleId: root})
        self.selections = MappingProxyType({package.moduleId: package.moduleId, package.moduleHint: package.moduleId})

        from backend.competition.integrity import Module2CompetitionEnabled
        if includeModule2 is None:
            includeModule2 = Module2CompetitionEnabled
        self.bindings = {"module_01_endo": (root, expectedHash)}
        if includeModule2 is True:
            from backend.competition.earlyPregnancy import EvidenceRoot as pregnancyRoot
            from backend.competition.integrity import Module2PackageHash
            if publicPackages:
                pregnancyRoot = EvaluationRoot / "modules/module2"
                Module2PackageHash = review["files"]["evaluation/modules/module2/claims.json"]
            second = loadPackage(pregnancyRoot, Module2PackageHash, "competition", "module_02_early_pregnancy")
            secondConfig = authenticRegistry.getModule(second.moduleId).model_copy(update={
                "moduleName": "Early Pregnancy Pain and Bleeding",
                "description": "Controlled competition evidence from verified NICE, ACEP, FAQ155 and CDC sources. Not production clinical approval.",
                "urgentRuleIds": ["U1", "U2", "U3"]})
            if publicPackages:
                secondConfig = secondConfig.model_copy(update={"description": "Project-authored summaries reviewedForEvaluation and competitionReady; not approved for patient care."})
            self.moduleConfigs = MappingProxyType({**self.moduleConfigs, second.moduleId: secondConfig})
            self.moduleRoots = MappingProxyType({**self.moduleRoots, second.moduleId: pregnancyRoot})
            self.selections = MappingProxyType({**self.selections, second.moduleHint: second.moduleId})
            self.bindings[second.moduleId] = (pregnancyRoot, Module2PackageHash)

    def packageBinding(self, moduleId):
        if moduleId not in self.bindings:
            raise ModuleUnavailableError("Selected module is unavailable.")
        return self.bindings[moduleId]

    def resolveModule(self, moduleId):
        if moduleId == "NotSure":
            raise ModuleSelectionError("Select a clinical module.")
        if moduleId not in self.selections:
            raise ModuleUnavailableError("Selected module is unavailable.")
        selectedId = self.selections[moduleId]
        selectedRoot, selectedHash = self.packageBinding(selectedId)
        loadPackage(selectedRoot, selectedHash, "competition", selectedId)
        return self.moduleConfigs[selectedId].model_copy(deep=True)

    def getModule(self, moduleId):
        if moduleId not in self.moduleConfigs:
            raise ModuleUnavailableError("Selected module is unavailable.")
        return self.moduleConfigs[moduleId].model_copy(deep=True)

    def listModules(self):
        return [self.resolveModule(moduleId) for moduleId in sorted(self.moduleConfigs)]

    def listSources(self, moduleId):
        self.resolveModule(moduleId)
        selectedRoot, selectedHash = self.packageBinding(moduleId)
        package = loadPackage(selectedRoot, selectedHash, "competition", moduleId)
        return [SourceRecord(sourceId=source.sourceId, organization=source.organization, title=source.title,
            publicationDate=source.publicationDate, reviewDate=source.reviewDate,
            jurisdiction=next(claim.jurisdiction for claim in package.claims if claim.sourceId == source.sourceId),
            verifiedUrl=source.officialUrl if source.urlVerificationStatus == "verifiedOfficialRetrieval" else None,
            knowledgeFile="Project-authored evaluation summary" if self.publicEvaluation else source.fileName,
            status="pendingReview") for source in package.sources]

    def getSource(self, moduleId, sourceId):
        for source in self.listSources(moduleId):
            if source.sourceId == sourceId:
                return source
        raise ModuleUnavailableError("Selected source is unavailable.")
