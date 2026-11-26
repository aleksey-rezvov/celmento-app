import csv
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from io import StringIO

from httpx import Response
from test_account import ACCOUNT, AccountStand, account_stand
from test_clients_api import CLIENTS, bearer, create_card, problem
from test_meetings_api import post_meeting, service_form
from test_meetings_ledger import client_form
from test_records_api import RECORDS, custom_period
from test_specialists_api import archive_card, link_card, validation_problem

from celmento_api.models.enums import ErrorCode
from celmento_api.schemas.auth import SignInSession

__all__: list[str] = ["account_stand"]
EXPORT: str = f"{RECORDS}/hours/export"


async def _export(
    stand: AccountStand, owner: SignInSession, params: Mapping[str, str]
) -> Response:
    return await stand.client.get(EXPORT, headers=bearer(owner), params=params)


def _table(reply: Response) -> list[list[str]]:
    assert reply.status_code == 200, reply.text
    assert reply.headers["content-type"] == "text/csv; charset=utf-8"
    assert reply.headers["cache-control"] == "private, no-store"
    assert reply.content.startswith(b"\xef\xbb\xbf")
    return list(csv.reader(StringIO(reply.content.decode("utf-8-sig"), newline="")))


# spec:test records-hours-export#leader-only
async def test_hours_export_requires_leader_and_valid_query(
    account_stand: AccountStand,
) -> None:
    owner = await account_stand.add_account("export_owner")
    params = {"type": "practice", "format": "icf"}
    problem(
        await account_stand.client.get(EXPORT, params=params),
        401,
        ErrorCode.UNAUTHORIZED,
    )
    problem(
        await _export(account_stand, owner, params),
        403,
        ErrorCode.ACTIVATION_REQUIRED,
    )
    await account_stand.activate(owner)
    for invalid in (
        {**params, "type": "therapy"},
        {**params, "period": "custom"},
        {**params, **custom_period("2025-06-04", "2025-06-03")},
    ):
        validation_problem(
            await _export(account_stand, owner, invalid),
            "query",
            "value_error",
        )
    reply = await _export(account_stand, owner, {"type": "practice"})
    assert reply.status_code == 422


# spec:test records-hours-export#period-completed-ownership
# spec:test records-hours-export#icf-layout-aggregation
# spec:test records-hours-export#icf-client-contact-and-archive
# spec:test records-hours-export#file-name
async def test_icf_csv_uses_owner_civil_dates_and_exact_minutes_by_card(
    account_stand: AccountStand,
) -> None:
    stand = account_stand
    owner = await stand.add_account("export_icf")
    peer = await stand.add_account("export_peer")
    for person in (owner, peer):
        await stand.activate(person)
    response = await stand.client.patch(
        ACCOUNT,
        headers=bearer(owner),
        json={"language": "ru", "time_zone": "Europe/Belgrade"},
    )
    assert response.status_code == 200
    active = await create_card(
        stand,
        owner,
        {"name": "Repeat", "email": "client@example.com", "phone": "+12025550100"},
    )
    archived = await create_card(
        stand, owner, {"name": "Repeat", "phone": "+12025550101"}
    )
    attendee = await stand.add_account("export_archived_attendee")
    await link_card(stand, owner, archived.id, attendee)
    other = await create_card(stand, peer, {"name": "Foreign provider"})
    await link_card(stand, peer, other.id, owner)
    start = datetime(2025, 6, 2, 23, 30, tzinfo=UTC)
    await post_meeting(
        stand,
        owner,
        client_form(
            active.id, start - timedelta(days=1), outcome={"status": "completed"}
        ),
    )
    await post_meeting(
        stand,
        owner,
        client_form(
            active.id,
            start,
            outcome={"status": "completed", "actual_duration_minutes": 10},
        ),
    )
    await post_meeting(
        stand,
        owner,
        client_form(
            active.id,
            start + timedelta(hours=2),
            payment_type="barter",
            outcome={"status": "completed", "actual_duration_minutes": 10},
        ),
    )
    await post_meeting(
        stand,
        owner,
        client_form(
            active.id,
            start + timedelta(days=1),
            payment_type="pro_bono",
            outcome={"status": "completed", "actual_duration_minutes": 15},
        ),
    )
    await post_meeting(
        stand, owner, client_form(active.id, start + timedelta(days=1, hours=2))
    )
    await post_meeting(
        stand,
        owner,
        client_form(
            active.id,
            start + timedelta(days=1, hours=4),
            outcome={"status": "not_taken_place", "charged": True},
        ),
    )
    await post_meeting(
        stand,
        owner,
        client_form(
            archived.id,
            start + timedelta(hours=4),
            outcome={"status": "completed", "actual_duration_minutes": 30},
        ),
    )
    await archive_card(stand, owner, archived.id)
    await post_meeting(
        stand,
        peer,
        client_form(other.id, start, outcome={"status": "completed"}),
    )
    reply = await _export(
        stand,
        owner,
        {
            "type": "practice",
            "format": "icf",
            **custom_period("2025-06-03", "2025-06-04"),
        },
    )
    assert reply.headers["content-disposition"] == (
        'attachment; filename="celmento_practice_2025-06-03_2025-06-04.csv"'
    )
    columns, *rows = _table(reply)
    assert columns == [
        "Client Name",
        "Contact Information",
        "Individual/Group",
        "Number in Group",
        "Start Date",
        "End Date",
        "Paid Hours",
        "Pro-bono Hours",
    ]
    assert rows == [
        [
            "Repeat",
            "client@example.com",
            "Individual",
            "1",
            "2025-06-03",
            "2025-06-04",
            "0.33",
            "0.25",
        ],
        [
            "Repeat",
            "'+12025550101",
            "Individual",
            "1",
            "2025-06-03",
            "2025-06-03",
            "0.50",
            "0.00",
        ],
    ]


# spec:test records-hours-export#sessions-layout
# spec:test records-hours-export#private-fields-excluded
# spec:test records-hours-export#spreadsheet-safe
async def test_all_practice_sessions_export_only_approved_formula_safe_cells(
    account_stand: AccountStand,
) -> None:
    stand = account_stand
    owner = await stand.add_account("export_sessions")
    await stand.activate(owner)
    card = await create_card(
        stand,
        owner,
        {"name": "=1+1", "phone": "+12025550102", "currency": "EUR"},
    )
    reply = await stand.client.patch(
        f"{CLIENTS}/{card.id}",
        headers=bearer(owner),
        json={
            "request": "Private request",
            "goals": "Private goals",
            "info": "Private information",
            "hypotheses": "Private hypotheses",
        },
    )
    assert reply.status_code == 200, reply.text
    start = datetime(2025, 6, 3, 9, tzinfo=UTC)
    await post_meeting(
        stand,
        owner,
        client_form(
            card.id,
            start,
            payment_type="barter",
            comment="Private client meeting comment",
            outcome={"status": "completed", "actual_duration_minutes": 45},
        ),
    )
    peer_name = "\u200b \t@other"
    await post_meeting(
        stand,
        owner,
        {
            "type": "mutual_practice",
            "with_whom": peer_name,
            "starts_at": (start + timedelta(hours=2)).isoformat(),
            "duration_minutes": 90,
            "my_duration_minutes": 30,
            "place": "online",
            "outcome": {"status": "completed", "actual_duration_minutes": 35},
        },
    )
    reply = await _export(stand, owner, {"type": "practice", "format": "sessions"})
    assert reply.headers["content-disposition"] == (
        'attachment; filename="celmento_practice_all.csv"'
    )
    assert b"Private" not in reply.content
    columns, mutual, client = _table(reply)
    assert columns == [
        "Date",
        "Client",
        "Contact",
        "Individual/Group",
        "Number of participants",
        "Duration (h)",
        "Payment type",
        "Price",
        "Currency",
    ]
    assert mutual == [
        "2025-06-03",
        f"'{peer_name}",
        "",
        "Individual",
        "1",
        "0.58",
        "Pro bono",
        "",
        "",
    ]
    assert client == [
        "2025-06-03",
        "'=1+1",
        "'+12025550102",
        "Individual",
        "1",
        "0.75",
        "Barter",
        "100.25",
        "EUR",
    ]
    _, *grouped = _table(
        await _export(stand, owner, {"type": "practice", "format": "icf"})
    )
    assert len(grouped) == 1 and grouped[0][0] == "'=1+1"


# spec:test records-hours-export#other-logs-layout
async def test_service_csv_localizes_own_log_without_meeting_comments(
    account_stand: AccountStand,
) -> None:
    stand = account_stand
    owner = await stand.add_account("export_other_logs")
    await stand.activate(owner)
    reply = await stand.client.patch(
        ACCOUNT, headers=bearer(owner), json={"language": "ru"}
    )
    assert reply.status_code == 200
    start = datetime(2025, 6, 3, 9, tzinfo=UTC)
    for index, kind in enumerate(("supervision", "personal_therapy", "training")):
        await post_meeting(
            stand,
            owner,
            service_form(
                start + timedelta(days=index),
                type=kind,
                with_whom="Training provider",
                topic=f"Topic {index}",
                meeting_link="https://example.com/session",
                comment="Private service comment",
                outcome={"status": "completed", "actual_duration_minutes": 75},
            ),
        )
    for index, log in enumerate(("supervision", "therapy", "training")):
        reply = await _export(stand, owner, {"type": log, "format": "sessions"})
        assert b"Private service comment" not in reply.content
        columns, row = _table(reply)
        assert len(columns) == 8 and not all(column.isascii() for column in columns)
        assert row == [
            "1",
            f"2025-06-0{index + 3}",
            f"Topic {index}",
            "1.25",
            "https://example.com/session",
            "50",
            "RUB",
            "Training provider",
        ]
