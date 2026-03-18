from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class ChatMessage(BaseModel):
    role: str  # user / assistant
    content: str


class CopilotRequest(BaseModel):
    message: str
    case_id: Optional[int] = None
    conversation_history: list[ChatMessage] = []
    date_from: Optional[str] = None
    date_to: Optional[str] = None


class Evidence(BaseModel):
    source: str
    data: dict
    relevance: float = 1.0


class QueryPlan(BaseModel):
    intent: str
    parameters: dict
    description: str


class CopilotResponse(BaseModel):
    response: str
    evidence: list[Evidence] = []
    query_plan: Optional[QueryPlan] = None
    confidence: float = 0.0
    suggestions: list[str] = []
    # Rich data for frontend tabs
    timeline: list[dict] = []
    locations: list[dict] = []
    graph: Optional[dict] = None
    entity: Optional[dict] = None


class SuggestionResponse(BaseModel):
    suggestions: list[str]
    case_id: int
