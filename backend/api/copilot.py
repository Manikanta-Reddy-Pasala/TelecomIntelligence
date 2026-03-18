from fastapi import APIRouter

from schemas.copilot import CopilotRequest, CopilotResponse, SuggestionResponse
from api.deps import DB, CurrentUser
from services.copilot import CopilotService

router = APIRouter(prefix="/api/copilot", tags=["copilot"])

_copilot = CopilotService()


@router.post("/chat", response_model=CopilotResponse)
async def chat(payload: CopilotRequest, db: DB, user: CurrentUser):
    """Main AI copilot chat endpoint. Classifies intent, queries data, and responds."""
    history = [{"role": m.role, "content": m.content} for m in payload.conversation_history]
    return await _copilot.process_query(
        db=db,
        message=payload.message,
        case_id=payload.case_id,
        user_id=user.id,
        history=history,
        date_from=payload.date_from,
        date_to=payload.date_to,
    )


@router.get("/suggestions/{case_id}", response_model=SuggestionResponse)
async def suggestions(case_id: int, db: DB, user: CurrentUser):
    """Get suggested next queries for a case."""
    s = await _copilot.get_suggestions(db, case_id)
    return SuggestionResponse(suggestions=s, case_id=case_id)
