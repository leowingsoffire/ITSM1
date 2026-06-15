from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import os

from routers import clients, proposals, mdrt, planning, whatsapp

load_dotenv()

app = FastAPI(
    title="ThidaAI Platform",
    description="AI-powered insurance agent platform for AIA Myanmar",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("FRONTEND_URL", "http://localhost:5173")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(clients.router, prefix="/api")
app.include_router(proposals.router, prefix="/api")
app.include_router(mdrt.router, prefix="/api")
app.include_router(planning.router, prefix="/api")
app.include_router(whatsapp.router, prefix="/api")


@app.get("/api/health")
def health_check():
    return {"status": "ok", "service": "ThidaAI Platform"}


@app.get("/")
def root():
    return {
        "app": "ThidaAI Platform",
        "version": "1.0.0",
        "docs": "/docs",
    }
