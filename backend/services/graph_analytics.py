from datetime import datetime
from typing import Optional

from sqlalchemy import select, func, or_, and_, text, literal_column
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import CallRecord, Message


class GraphAnalyticsService:
    """Contact network analysis using SQL queries."""

    @staticmethod
    async def get_contact_network(
        db: AsyncSession,
        msisdn: str,
        from_date: Optional[datetime] = None,
        to_date: Optional[datetime] = None,
    ) -> list[dict]:
        """Build the contact network for a given MSISDN: who they called/messaged, frequency, total duration."""

        # Outgoing calls
        out_call_stmt = (
            select(
                CallRecord.callee_msisdn.label("contact"),
                func.count().label("call_count"),
                func.coalesce(func.sum(CallRecord.duration_seconds), 0).label("total_duration"),
                literal_column("'outgoing_call'").label("direction"),
            )
            .where(CallRecord.caller_msisdn == msisdn)
        )
        if from_date:
            out_call_stmt = out_call_stmt.where(CallRecord.start_time >= from_date)
        if to_date:
            out_call_stmt = out_call_stmt.where(CallRecord.start_time <= to_date)
        out_call_stmt = out_call_stmt.group_by(CallRecord.callee_msisdn)

        # Incoming calls
        in_call_stmt = (
            select(
                CallRecord.caller_msisdn.label("contact"),
                func.count().label("call_count"),
                func.coalesce(func.sum(CallRecord.duration_seconds), 0).label("total_duration"),
                literal_column("'incoming_call'").label("direction"),
            )
            .where(CallRecord.callee_msisdn == msisdn)
        )
        if from_date:
            in_call_stmt = in_call_stmt.where(CallRecord.start_time >= from_date)
        if to_date:
            in_call_stmt = in_call_stmt.where(CallRecord.start_time <= to_date)
        in_call_stmt = in_call_stmt.group_by(CallRecord.caller_msisdn)

        # Outgoing messages
        out_msg_stmt = (
            select(
                Message.receiver_msisdn.label("contact"),
                func.count().label("msg_count"),
                literal_column("0").label("total_duration"),
                literal_column("'outgoing_msg'").label("direction"),
            )
            .where(Message.sender_msisdn == msisdn)
        )
        if from_date:
            out_msg_stmt = out_msg_stmt.where(Message.timestamp >= from_date)
        if to_date:
            out_msg_stmt = out_msg_stmt.where(Message.timestamp <= to_date)
        out_msg_stmt = out_msg_stmt.group_by(Message.receiver_msisdn)

        # Incoming messages
        in_msg_stmt = (
            select(
                Message.sender_msisdn.label("contact"),
                func.count().label("msg_count"),
                literal_column("0").label("total_duration"),
                literal_column("'incoming_msg'").label("direction"),
            )
            .where(Message.receiver_msisdn == msisdn)
        )
        if from_date:
            in_msg_stmt = in_msg_stmt.where(Message.timestamp >= from_date)
        if to_date:
            in_msg_stmt = in_msg_stmt.where(Message.timestamp <= to_date)
        in_msg_stmt = in_msg_stmt.group_by(Message.sender_msisdn)

        # Execute all
        out_calls = (await db.execute(out_call_stmt)).all()
        in_calls = (await db.execute(in_call_stmt)).all()
        out_msgs = (await db.execute(out_msg_stmt)).all()
        in_msgs = (await db.execute(in_msg_stmt)).all()

        # Aggregate by contact
        contacts: dict[str, dict] = {}
        for row in out_calls:
            c = contacts.setdefault(row.contact, {"msisdn": row.contact, "outgoing_calls": 0, "incoming_calls": 0, "outgoing_messages": 0, "incoming_messages": 0, "total_call_duration": 0})
            c["outgoing_calls"] += row.call_count
            c["total_call_duration"] += row.total_duration
        for row in in_calls:
            c = contacts.setdefault(row.contact, {"msisdn": row.contact, "outgoing_calls": 0, "incoming_calls": 0, "outgoing_messages": 0, "incoming_messages": 0, "total_call_duration": 0})
            c["incoming_calls"] += row.call_count
            c["total_call_duration"] += row.total_duration
        for row in out_msgs:
            c = contacts.setdefault(row.contact, {"msisdn": row.contact, "outgoing_calls": 0, "incoming_calls": 0, "outgoing_messages": 0, "incoming_messages": 0, "total_call_duration": 0})
            c["outgoing_messages"] += row.msg_count
        for row in in_msgs:
            c = contacts.setdefault(row.contact, {"msisdn": row.contact, "outgoing_calls": 0, "incoming_calls": 0, "outgoing_messages": 0, "incoming_messages": 0, "total_call_duration": 0})
            c["incoming_messages"] += row.msg_count

        # Sort by total interactions
        result = sorted(
            contacts.values(),
            key=lambda x: x["outgoing_calls"] + x["incoming_calls"] + x["outgoing_messages"] + x["incoming_messages"],
            reverse=True,
        )
        return result

    @staticmethod
    async def find_common_contacts(
        db: AsyncSession,
        msisdn1: str,
        msisdn2: str,
        from_date: Optional[datetime] = None,
        to_date: Optional[datetime] = None,
    ) -> list[dict]:
        """Find MSISDNs that both msisdn1 and msisdn2 have communicated with."""

        async def _get_contacts(msisdn: str) -> set[str]:
            filters = []
            if from_date:
                filters.append(CallRecord.start_time >= from_date)
            if to_date:
                filters.append(CallRecord.start_time <= to_date)

            out_stmt = select(CallRecord.callee_msisdn).where(CallRecord.caller_msisdn == msisdn, *filters)
            in_stmt = select(CallRecord.caller_msisdn).where(CallRecord.callee_msisdn == msisdn, *filters)

            msg_filters = []
            if from_date:
                msg_filters.append(Message.timestamp >= from_date)
            if to_date:
                msg_filters.append(Message.timestamp <= to_date)

            out_msg = select(Message.receiver_msisdn).where(Message.sender_msisdn == msisdn, *msg_filters)
            in_msg = select(Message.sender_msisdn).where(Message.receiver_msisdn == msisdn, *msg_filters)

            contacts_set: set[str] = set()
            for stmt in [out_stmt, in_stmt, out_msg, in_msg]:
                res = await db.execute(stmt)
                contacts_set.update(row[0] for row in res.all())
            contacts_set.discard(msisdn)
            return contacts_set

        contacts1 = await _get_contacts(msisdn1)
        contacts2 = await _get_contacts(msisdn2)
        common = contacts1 & contacts2
        common.discard(msisdn1)
        common.discard(msisdn2)

        return [{"msisdn": c} for c in sorted(common)]

    @staticmethod
    async def find_shortest_path(
        db: AsyncSession,
        source_msisdn: str,
        target_msisdn: str,
        max_hops: int = 4,
    ) -> Optional[list[str]]:
        """BFS-based shortest path between two MSISDNs via contact chains."""

        async def _get_direct_contacts(msisdn: str) -> set[str]:
            out_stmt = select(CallRecord.callee_msisdn).where(CallRecord.caller_msisdn == msisdn).distinct()
            in_stmt = select(CallRecord.caller_msisdn).where(CallRecord.callee_msisdn == msisdn).distinct()
            contacts_set: set[str] = set()
            for stmt in [out_stmt, in_stmt]:
                res = await db.execute(stmt)
                contacts_set.update(row[0] for row in res.all())
            contacts_set.discard(msisdn)
            return contacts_set

        visited: set[str] = {source_msisdn}
        queue: list[list[str]] = [[source_msisdn]]

        for _ in range(max_hops):
            next_queue: list[list[str]] = []
            for path in queue:
                current = path[-1]
                neighbors = await _get_direct_contacts(current)
                for n in neighbors:
                    if n == target_msisdn:
                        return path + [n]
                    if n not in visited:
                        visited.add(n)
                        next_queue.append(path + [n])
            queue = next_queue
            if not queue:
                break

        return None
