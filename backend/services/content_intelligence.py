from datetime import datetime
from typing import Optional

from sqlalchemy import select, or_, func
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import Message


class ContentIntelligenceService:
    """Message content analysis and summarization."""

    @staticmethod
    async def get_conversation_timeline(
        db: AsyncSession,
        msisdn1: str,
        msisdn2: str,
        from_date: Optional[datetime] = None,
        to_date: Optional[datetime] = None,
    ) -> list[dict]:
        """Get chronological messages between two MSISDNs."""
        stmt = (
            select(Message)
            .where(
                or_(
                    (Message.sender_msisdn == msisdn1) & (Message.receiver_msisdn == msisdn2),
                    (Message.sender_msisdn == msisdn2) & (Message.receiver_msisdn == msisdn1),
                )
            )
            .order_by(Message.timestamp)
        )
        if from_date:
            stmt = stmt.where(Message.timestamp >= from_date)
        if to_date:
            stmt = stmt.where(Message.timestamp <= to_date)

        result = await db.execute(stmt)
        return [
            {
                "id": m.id,
                "sender": m.sender_msisdn,
                "receiver": m.receiver_msisdn,
                "timestamp": m.timestamp.isoformat(),
                "type": m.message_type,
                "preview": m.content_preview,
                "summary": m.content_summary,
            }
            for m in result.scalars().all()
        ]

    @staticmethod
    async def summarize_messages(
        db: AsyncSession,
        msisdn: str,
        from_date: Optional[datetime] = None,
        to_date: Optional[datetime] = None,
    ) -> dict:
        """Produce a summary of all messages for a target MSISDN."""
        stmt = select(Message).where(
            or_(Message.sender_msisdn == msisdn, Message.receiver_msisdn == msisdn)
        ).order_by(Message.timestamp)

        if from_date:
            stmt = stmt.where(Message.timestamp >= from_date)
        if to_date:
            stmt = stmt.where(Message.timestamp <= to_date)

        result = await db.execute(stmt)
        messages = result.scalars().all()

        contacts: dict[str, int] = {}
        types: dict[str, int] = {}
        total = len(messages)

        for m in messages:
            other = m.receiver_msisdn if m.sender_msisdn == msisdn else m.sender_msisdn
            contacts[other] = contacts.get(other, 0) + 1
            types[m.message_type] = types.get(m.message_type, 0) + 1

        top_contacts = sorted(contacts.items(), key=lambda x: x[1], reverse=True)[:10]

        return {
            "msisdn": msisdn,
            "total_messages": total,
            "sent": sum(1 for m in messages if m.sender_msisdn == msisdn),
            "received": sum(1 for m in messages if m.receiver_msisdn == msisdn),
            "message_types": types,
            "top_contacts": [{"msisdn": c, "count": n} for c, n in top_contacts],
            "first_message": messages[0].timestamp.isoformat() if messages else None,
            "last_message": messages[-1].timestamp.isoformat() if messages else None,
        }

    @staticmethod
    async def extract_topics(
        db: AsyncSession,
        msisdn: str,
        from_date: Optional[datetime] = None,
        to_date: Optional[datetime] = None,
    ) -> list[dict]:
        """Extract topics from message content previews (keyword-based)."""
        stmt = select(Message.content_preview).where(
            or_(Message.sender_msisdn == msisdn, Message.receiver_msisdn == msisdn),
            Message.content_preview.isnot(None),
        )
        if from_date:
            stmt = stmt.where(Message.timestamp >= from_date)
        if to_date:
            stmt = stmt.where(Message.timestamp <= to_date)

        result = await db.execute(stmt)
        previews = [r[0] for r in result.all() if r[0]]

        # Simple keyword frequency analysis
        word_freq: dict[str, int] = {}
        stop_words = {"the", "a", "an", "is", "are", "was", "were", "be", "been", "to", "of",
                      "and", "in", "on", "at", "for", "with", "it", "this", "that", "i", "you",
                      "he", "she", "we", "they", "me", "my", "your", "his", "her", "our", "their",
                      "do", "did", "have", "has", "had", "will", "would", "can", "could", "not",
                      "but", "or", "so", "if", "from", "by", "as", "no", "yes", "ok", "hi", "hello"}

        for preview in previews:
            words = preview.lower().split()
            for w in words:
                w = w.strip(".,!?;:'\"()[]")
                if len(w) > 2 and w not in stop_words:
                    word_freq[w] = word_freq.get(w, 0) + 1

        sorted_topics = sorted(word_freq.items(), key=lambda x: x[1], reverse=True)[:20]
        return [{"topic": word, "frequency": freq} for word, freq in sorted_topics]
