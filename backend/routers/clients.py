from fastapi import APIRouter
from models.schemas import ClientAnalysisRequest

router = APIRouter(tags=["clients"])


@router.get("/clients")
def list_clients():
    """List all clients."""
    return {"clients": [], "message": "TODO: fetch clients from database"}


@router.post("/clients/analyze")
def analyze_client(request: ClientAnalysisRequest):
    """AI-powered needs analysis for a client."""
    return {
        "client_id": request.client_id,
        "message": "TODO: run OpenAI needs analysis",
    }
