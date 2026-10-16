"""Read-only public source details with no administrative paths or byte hashes."""

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from backend.app.models.contracts import ModuleId
from backend.competition.generation import claimWording
from backend.competition.package import loadPackage
from backend.competition.registry import CompetitionRegistry

router = APIRouter(tags=["Competition sources"])


class CompetitionSourceDetails(BaseModel):
    """Public provenance allowlist, not an approval record or original-file endpoint."""
    model_config = ConfigDict(extra="forbid", strict=True)
    organization: str
    title: str
    date: str | None
    sourceType: str
    captureStatus: str
    status: str
    statements: list[str] = Field(max_length=32)
    limitations: str
    jurisdiction: str
    sections: list[str] = Field(max_length=32)


@router.get("/v1/competition/sources/{sourceId}", response_model=CompetitionSourceDetails)
def sourceDetails(sourceId: ModuleId, request: Request):
    try:
        registry = request.app.state.registry
        if request.app.state.runtimeMode != "competition" or not isinstance(registry, CompetitionRegistry):
            raise ValueError()
        packages = [loadPackage(*registry.packageBinding(config.moduleId), "competition", config.moduleId) for config in registry.listModules()]
        matched = [(package, source) for package in packages for source in package.sources if source.sourceId == sourceId]
        if len(matched) != 1:
            raise ValueError()
        package, source = matched[0]
        claims = [claim for claim in package.claims if claim.sourceId == sourceId]
        populations = list(dict.fromkeys(claim.intendedPopulation for claim in claims))
        conditions = list(dict.fromkeys(condition for claim in claims for condition in claim.conditions))
        limitations = ["Population: " + "; ".join(populations), "Conditions: " + "; ".join(conditions), *dict.fromkeys(boundary for claim in claims for boundary in claim.limitations)]
        return CompetitionSourceDetails(organization=source.organization, title=source.title,
            date=source.publicationDate or source.reviewDate,
            sourceType="Government public-health warning material" if sourceId.startswith("CDC-MATERNAL-") else "Public educational FAQ" if sourceId.startswith("ACOG-") else "Guideline" if sourceId.startswith(("NICE-", "ACEP-")) or sourceId == "CDC-PID" else "Public information webpage",
            captureStatus=source.provenance, status="Reviewed for evaluation; authentic sources remain pending review." if getattr(registry, "publicEvaluation", False) else "Competition-eligible evidence; production approval unchanged.",
            statements=[claim.supportedStatement if getattr(registry, "publicEvaluation", False) else claimWording(claim) for claim in claims], limitations=" ".join(limitations)[:6000],
            jurisdiction=claims[0].jurisdiction, sections=[claim.sourceLocation for claim in claims])
    except Exception:
        return JSONResponse(status_code=404, content={"detail": "Source details are unavailable."})
