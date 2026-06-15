from fastapi import APIRouter
from models.schemas import ProposalRequest

router = APIRouter(tags=["proposals"])


@router.post("/proposals/generate")
def generate_proposal(request: ProposalRequest):
    """Generate an insurance proposal and export as PDF."""
    return {
        "client_id": request.client_id,
        "message": "TODO: generate proposal and PDF",
    }
