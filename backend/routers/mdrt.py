from fastapi import APIRouter
from models.schemas import MDRTProgressRequest

router = APIRouter(tags=["mdrt"])


@router.post("/mdrt/progress")
def mdrt_progress(request: MDRTProgressRequest):
    """Calculate MDRT progress for a given year."""
    return {
        "client_id": request.client_id,
        "year": request.year,
        "message": "TODO: calculate MDRT progress",
    }
