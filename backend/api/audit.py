from datetime import datetime
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Query

from models.database import User
from schemas.investigation import AuditLogResponse
from api.deps import DB, require_roles
from services.audit_service import AuditService

router = APIRouter(prefix="/api/audit", tags=["audit"])


@router.get("/logs", response_model=list[AuditLogResponse])
async def get_audit_logs(
    db: DB,
    admin_user: Annotated[User, Depends(require_roles("admin", "auditor"))],
    user_id: Optional[int] = None,
    action: Optional[str] = None,
    from_date: Optional[datetime] = Query(None, alias="from"),
    to_date: Optional[datetime] = Query(None, alias="to"),
    limit: int = Query(100, le=500),
    offset: int = 0,
):
    """Query audit logs. Only accessible by admin and auditor roles."""
    return await AuditService.query_logs(
        db=db,
        user_id=user_id,
        action=action,
        from_date=from_date,
        to_date=to_date,
        limit=limit,
        offset=offset,
    )
