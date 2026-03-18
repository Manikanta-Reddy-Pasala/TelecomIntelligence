from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Case
# ---------------------------------------------------------------------------

class CaseCreate(BaseModel):
    case_number: str = Field(max_length=32)
    title: str = Field(max_length=512)
    description: Optional[str] = None
    status: str = "open"
    priority: str = "medium"
    assigned_analyst_id: Optional[int] = None


class CaseUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    assigned_analyst_id: Optional[int] = None


class CaseEntityCreate(BaseModel):
    entity_type: str = Field(pattern=r"^(person|phone|device|tower)$")
    entity_id: str
    notes: Optional[str] = None


class CaseEntityResponse(BaseModel):
    id: int
    case_id: int
    entity_type: str
    entity_id: str
    added_at: datetime
    notes: Optional[str] = None

    model_config = {"from_attributes": True}


class CaseInsightCreate(BaseModel):
    insight_type: str = Field(pattern=r"^(fact|inference|model_summary|analyst_note)$")
    content: str
    confidence_score: Optional[float] = None
    evidence_refs: Optional[dict] = None


class CaseInsightResponse(BaseModel):
    id: int
    case_id: int
    insight_type: str
    content: str
    confidence_score: Optional[float] = None
    evidence_refs: Optional[dict] = None
    created_by: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class CaseResponse(BaseModel):
    id: int
    case_number: str
    title: str
    description: Optional[str] = None
    status: str
    priority: str
    assigned_analyst_id: Optional[int] = None
    created_by_id: Optional[int] = None
    created_at: datetime
    updated_at: datetime
    entities: list[CaseEntityResponse] = []
    insights: list[CaseInsightResponse] = []

    model_config = {"from_attributes": True}


class CaseListResponse(BaseModel):
    id: int
    case_number: str
    title: str
    status: str
    priority: str
    assigned_analyst_id: Optional[int] = None
    created_at: datetime

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Anomaly
# ---------------------------------------------------------------------------

class AnomalyAlertResponse(BaseModel):
    id: int
    msisdn: str
    anomaly_type: str
    description: str
    severity: str
    detected_at: datetime
    resolved: bool
    resolved_by: Optional[int] = None
    resolved_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Audit
# ---------------------------------------------------------------------------

class AuditLogResponse(BaseModel):
    id: int
    user_id: Optional[int] = None
    action: str
    query_text: Optional[str] = None
    llm_prompt: Optional[str] = None
    llm_response: Optional[str] = None
    data_accessed: Optional[dict] = None
    ip_address: Optional[str] = None
    timestamp: datetime

    model_config = {"from_attributes": True}
