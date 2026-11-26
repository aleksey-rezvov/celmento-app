from datetime import UTC, date, datetime, time, timedelta
from typing import Annotated

from fastapi import Depends, Query
from sqlalchemy import ColumnElement, SQLColumnExpression

from celmento_api.errors import invalid_request_value
from celmento_api.schemas.admin import AdminPeriod


def read_period(
    from_: Annotated[date | None, Query(alias="from")] = None,
    to: Annotated[date | None, Query()] = None,
) -> AdminPeriod:
    if from_ is not None and to is not None and from_ > to:
        raise invalid_request_value("query", "to")
    return AdminPeriod.model_validate({"from": from_, "to": to})


Period = Annotated[AdminPeriod, Depends(read_period)]


def utc_conditions(
    column: SQLColumnExpression[datetime | None], period: AdminPeriod
) -> list[ColumnElement[bool]]:
    conditions: list[ColumnElement[bool]] = []
    if period.from_ is not None:
        conditions.append(column >= datetime.combine(period.from_, time.min, UTC))
    if period.to is not None:
        if period.to == date.max:
            conditions.append(column <= datetime.max.replace(tzinfo=UTC))
        else:
            upper = datetime.combine(period.to + timedelta(days=1), time.min, UTC)
            conditions.append(column < upper)
    return conditions
