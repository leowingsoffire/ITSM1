from pydantic import BaseModel, EmailStr
from typing import Optional


class Client(BaseModel):
    id: Optional[int] = None
    name: str
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    age: Optional[int] = None
    occupation: Optional[str] = None
    income: Optional[float] = None


class ClientAnalysisRequest(BaseModel):
    client_id: int


class ProposalRequest(BaseModel):
    client_id: int
    proposal_type: str


class MDRTProgressRequest(BaseModel):
    client_id: int
    year: int


class RetirementPlanRequest(BaseModel):
    current_age: int
    retirement_age: int
    monthly_income: float
    current_savings: float


class EducationPlanRequest(BaseModel):
    child_age: int
    target_university_age: int
    estimated_annual_cost: float
    inflation_rate: float = 0.05


class TaxPlanRequest(BaseModel):
    annual_income: float
    current_insurance_premium: float
