from datetime import datetime
from typing import Optional

from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import AuditLog


class AuditService:

    @staticmethod
    async def log(
        db: AsyncSession,
        user_id: Optional[int],
        action: str,
        query_text: Optional[str] = None,
        llm_prompt: Optional[str] = None,
        llm_response: Optional[str] = None,
        data_accessed: Optional[dict] = None,
        ip_address: Optional[str] = None,
    ) -> AuditLog:
        entry = AuditLog(
            user_id=user_id,
            action=action,
            query_text=query_text,
            llm_prompt=llm_prompt,
            llm_response=llm_response,
            data_accessed=data_accessed,
            ip_address=ip_address,
        )
        db.add(entry)
        await db.flush()
        return entry

    @staticmethod
    async def query_logs(
        db: AsyncSession,
        user_id: Optional[int] = None,
        action: Optional[str] = None,
        from_date: Optional[datetime] = None,
        to_date: Optional[datetime] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[AuditLog]:
        stmt = select(AuditLog).order_by(desc(AuditLog.timestamp))

        if user_id is not None:
            stmt = stmt.where(AuditLog.user_id == user_id)
        if action is not None:
            stmt = stmt.where(AuditLog.action.ilike(f"%{action}%"))
        if from_date is not None:
            stmt = stmt.where(AuditLog.timestamp >= from_date)
        if to_date is not None:
            stmt = stmt.where(AuditLog.timestamp <= to_date)

        stmt = stmt.offset(offset).limit(limit)
        result = await db.execute(stmt)
        return list(result.scalars().all())
