"""Public evaluation eligibility with the unchanged explicit maternal-condition matcher."""

from backend.app.modules.module02EarlyPregnancy.maternal import MaternalCandidates
from backend.competition.package import PackageError


class MaternalEvaluation(MaternalCandidates):
    """Reuse fact matching without loading a private appraisal or conferring approval."""

    def __init__(self, package):
        expected = {"CDCFaintingCare": "CDC-MATERNAL-WARNINGS-2024", "CDCPersistentDizzinessCare": "CDC-MATERNAL-WARNINGS-2024", "CDCEmergencyAccess": "CDC-MATERNAL-WARNINGS-POSTER"}
        actual = {claim.claimId: claim.sourceId for claim in package.claims if claim.claimId in expected}
        if package.moduleId != "module_02_early_pregnancy" or actual != expected:
            raise PackageError("Evaluation evidence is unavailable.")
        self.claimIds = frozenset(expected)
