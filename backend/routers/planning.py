from fastapi import APIRouter
from models.schemas import RetirementPlanRequest, EducationPlanRequest, TaxPlanRequest

router = APIRouter(tags=["planning"])


@router.post("/planning/retirement")
def retirement_plan(request: RetirementPlanRequest):
    """Calculate retirement gap and funding needs."""
    return {"message": "TODO: run retirement gap calculator", "input": request.model_dump()}


@router.post("/planning/education")
def education_plan(request: EducationPlanRequest):
    """Project education costs for a child."""
    return {"message": "TODO: run education cost projector", "input": request.model_dump()}


@router.post("/planning/tax")
def tax_plan(request: TaxPlanRequest):
    """Calculate potential tax savings through insurance."""
    return {"message": "TODO: run tax savings calculator", "input": request.model_dump()}
