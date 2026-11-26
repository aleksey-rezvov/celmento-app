from sqlalchemy import DateTime, Text, and_, distinct, func, select, type_coerce
from sqlalchemy.ext.asyncio import AsyncSession

from celmento_api.models.account import Account
from celmento_api.models.client_card import ClientCard
from celmento_api.models.enums import (
    Language,
    MeetingStatus,
    NoteTagTargetKind,
    SubscriptionTerm,
)
from celmento_api.models.legal import Acceptance
from celmento_api.models.meeting import Meeting
from celmento_api.models.note import Note, NoteTag
from celmento_api.models.plan import StatsEvent, StatsEventKind, SubscriptionRequest
from celmento_api.schemas.admin import (
    AdminBookingStatistics,
    AdminLanguageUsage,
    AdminMeetingStatistics,
    AdminNoteStatistics,
    AdminPeriod,
    AdminPlanLimitStatistics,
    AdminStatistics,
    AdminSubscriptionRequestStatistics,
    AdminTotalAndNew,
)
from celmento_api.services.admin_period import utc_conditions


def _share(numerator: int, denominator: int) -> float | None:
    return numerator / denominator if denominator else None


async def _account_counts(
    session: AsyncSession, period: AdminPeriod
) -> tuple[AdminTotalAndNew, AdminTotalAndNew, list[AdminLanguageUsage]]:
    activated = Account.activated_at.is_not(None)
    # spec:impl admin-feedback-stats#answer-statistics-question-number
    # spec:impl admin-feedback-stats#answer-interface-language-usage-number
    total, created, leaders, activated_in_period, russian, english = (
        await session.execute(
            select(
                func.count(),
                func.count().filter(*utc_conditions(Account.created_at, period)),
                func.count().filter(activated),
                func.count().filter(
                    activated, *utc_conditions(Account.activated_at, period)
                ),
                func.count().filter(Account.language == Language.RU.value),
                func.count().filter(Account.language == Language.EN.value),
            ).select_from(Account)
        )
    ).one()
    return (
        AdminTotalAndNew(total=total, new=created),
        AdminTotalAndNew(total=leaders, new=activated_in_period),
        [
            AdminLanguageUsage(language=Language.RU, accounts=russian),
            AdminLanguageUsage(language=Language.EN, accounts=english),
        ],
    )


async def _meeting_counts(
    session: AsyncSession, period: AdminPeriod
) -> AdminMeetingStatistics:
    # spec:impl admin-feedback-stats#answer-number-meetings-outcome-share
    count, outcomes, missed = (
        await session.execute(
            select(
                func.count(),
                func.count().filter(Meeting.status != MeetingStatus.SCHEDULED.value),
                func.count().filter(
                    Meeting.status == MeetingStatus.NOT_TAKEN_PLACE.value
                ),
            )
            .select_from(Meeting)
            .where(*utc_conditions(Meeting.starts_at, period))
        )
    ).one()
    return AdminMeetingStatistics(
        count=count,
        with_outcome=outcomes,
        not_taken_place_share=_share(missed, outcomes),
    )


async def _booking_counts(
    session: AsyncSession, period: AdminPeriod
) -> AdminBookingStatistics:
    accepted = utc_conditions(Acceptance.accepted_at, period)
    booking_count = (
        select(func.count(distinct(Acceptance.guest_booking_id)))
        .where(Acceptance.guest_booking_id.is_not(None), *accepted)
        .scalar_subquery()
    )
    # Legacy cancelled or reassigned bookings can lack a verified original card.
    cohort = (
        select(
            ClientCard.self_given_email.label("email"),
            func.min(Acceptance.accepted_at).label("booked_at"),
        )
        .select_from(Acceptance)
        .join(ClientCard, ClientCard.client_card_id == Acceptance.guest_client_card_id)
        .where(
            Acceptance.guest_booking_id.is_not(None),
            ClientCard.self_given_email.is_not(None),
            *accepted,
        )
        .group_by(ClientCard.self_given_email)
        .subquery()
    )
    email = type_coerce(cohort.c.email, Text())
    booked_at = type_coerce(cohort.c.booked_at, DateTime(timezone=True))
    # spec:impl admin-feedback-stats#answer-number-bookings-made-public
    count, guests, registered = (
        await session.execute(
            select(booking_count, func.count(), func.count(Account.account_id))
            .select_from(cohort)
            .outerjoin(
                Account, and_(Account.email == email, Account.created_at > booked_at)
            )
        )
    ).one()
    return AdminBookingStatistics(
        count=count, guests_signed_in_share=_share(registered, guests)
    )


async def _note_counts(
    session: AsyncSession, period: AdminPeriod
) -> AdminNoteStatistics:
    tags = (
        select(func.count())
        .select_from(NoteTag)
        .where(
            NoteTag.target_kind == NoteTagTargetKind.CLIENT_CARD.value,
            *utc_conditions(NoteTag.created_at, period),
        )
        .scalar_subquery()
    )
    # spec:impl admin-feedback-stats#answer-number-notes-number-tags
    count, tag_count = (
        await session.execute(
            select(func.count(), tags)
            .select_from(Note)
            .where(*utc_conditions(Note.created_at, period))
        )
    ).one()
    return AdminNoteStatistics(count=count, tags=tag_count)


async def _limit_counts(
    session: AsyncSession, period: AdminPeriod
) -> AdminPlanLimitStatistics:
    # spec:impl admin-feedback-stats#answer-number-leaders-ran-free
    leaders, openings = (
        await session.execute(
            select(
                func.count(distinct(StatsEvent.account_id)).filter(
                    StatsEvent.kind == StatsEventKind.LIMIT_HIT.value
                ),
                func.count().filter(
                    StatsEvent.kind == StatsEventKind.PLANS_OPENED.value
                ),
            )
            .select_from(StatsEvent)
            .where(*utc_conditions(StatsEvent.created_at, period))
        )
    ).one()
    return AdminPlanLimitStatistics(
        leaders_hit_limit=leaders, plans_screen_openings=openings
    )


async def _request_counts(
    session: AsyncSession, period: AdminPeriod
) -> AdminSubscriptionRequestStatistics:
    # spec:impl admin-feedback-stats#answer-number-subscription-requests
    count, month, year = (
        await session.execute(
            select(
                func.count(),
                func.count().filter(
                    SubscriptionRequest.term == SubscriptionTerm.MONTH.value
                ),
                func.count().filter(
                    SubscriptionRequest.term == SubscriptionTerm.YEAR.value
                ),
            )
            .select_from(SubscriptionRequest)
            .where(*utc_conditions(SubscriptionRequest.created_at, period))
        )
    ).one()
    return AdminSubscriptionRequestStatistics(total=count, month=month, year=year)


async def statistics(session: AsyncSession, period: AdminPeriod) -> AdminStatistics:
    # spec:impl admin-feedback-stats#compute-indicator-period-administrator
    accounts, activations, languages = await _account_counts(session, period)
    # spec:impl admin-feedback-stats#include-names-emails-other-personal
    return AdminStatistics.model_validate(
        {
            "from": period.from_,
            "to": period.to,
            "accounts": accounts,
            "activations": activations,
            "meetings": await _meeting_counts(session, period),
            "bookings": await _booking_counts(session, period),
            "notes": await _note_counts(session, period),
            "plan_limit": await _limit_counts(session, period),
            "languages": languages,
            "subscription_requests": await _request_counts(session, period),
        }
    )
