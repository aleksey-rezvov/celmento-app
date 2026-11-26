from decimal import Decimal
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from celmento_api.models.enums import RecordsHoursLogType
from celmento_api.models.records import HoursGoal
from celmento_api.schemas.money import format_amount
from celmento_api.schemas.records import RecordsHoursGoal


async def read_hours_goal(
    session: AsyncSession, account_id: UUID, log: RecordsHoursLogType
) -> RecordsHoursGoal | None:
    goal = await session.scalar(
        select(HoursGoal).where(
            HoursGoal.account_id == account_id, HoursGoal.log_type == log.value
        )
    )
    if goal is None:
        return None
    return RecordsHoursGoal(hours=format_amount(goal.hours), label=goal.label)


async def save_hours_goal(
    session: AsyncSession,
    account_id: UUID,
    log: RecordsHoursLogType,
    goal: RecordsHoursGoal,
) -> RecordsHoursGoal:
    hours = Decimal(goal.hours)
    # spec:impl records-hours-goal#leader-goal-per-log
    await session.execute(
        insert(HoursGoal)
        .values(
            account_id=account_id, log_type=log.value, hours=hours, label=goal.label
        )
        .on_conflict_do_update(
            constraint="hours_goal_account_log_unique",
            set_={"hours": hours, "label": goal.label},
        )
    )
    return RecordsHoursGoal(hours=format_amount(hours), label=goal.label)


async def remove_hours_goal(
    session: AsyncSession, account_id: UUID, log: RecordsHoursLogType
) -> None:
    # spec:impl records-hours-goal#validate-change
    await session.execute(
        delete(HoursGoal).where(
            HoursGoal.account_id == account_id, HoursGoal.log_type == log.value
        )
    )
