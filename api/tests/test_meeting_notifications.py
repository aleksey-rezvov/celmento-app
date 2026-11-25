from asyncio import gather, get_running_loop, run_coroutine_threadsafe, timeout
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage
from uuid import UUID

import pytest
from sqlalchemy import select
from test_account import ACCOUNT, NOTICES, AccountStand, account_stand
from test_clients_api import bearer, create_card
from test_meetings_api import MEETINGS, meeting_from, post_meeting, service_form
from test_meetings_ledger import client_form

from celmento_api import contour, emails
from celmento_api.models.client_card import ClientCard
from celmento_api.models.enums import ClientLinkMethod, Contour, NoticeKey, NoticeTab
from celmento_api.models.meeting import Meeting
from celmento_api.models.notice import Notice as NoticeRecord
from celmento_api.schemas.auth import SignInSession
from celmento_api.schemas.notices import Notice, NoticeList

__all__: list[str] = [
    "account_stand",
    "mail_outbox",
    "notices_for",
    "set_card_channels",
]


@pytest.fixture
def mail_outbox(monkeypatch: pytest.MonkeyPatch) -> list[EmailMessage]:
    outbox: list[EmailMessage] = []
    monkeypatch.setattr(emails, "_deliver", outbox.append)
    return outbox


async def set_card_channels(
    stand: AccountStand,
    card_id: UUID,
    *,
    recipient: str | None = None,
    linked: SignInSession | None = None,
    guest_language: str | None = None,
    guest_zone: str | None = None,
) -> None:
    async with stand.session() as session:
        card = await session.get(ClientCard, card_id)
        assert card is not None
        card.self_given_email = recipient
        card.guest_language = guest_language
        card.guest_time_zone = guest_zone
        if linked is not None:
            card.linked_account_id = linked.account.id
            card.link_method = ClientLinkMethod.LOGIN.value
        await session.commit()


async def notices_for(stand: AccountStand, signed_in: SignInSession) -> list[Notice]:
    response = await stand.client.get(NOTICES, headers=bearer(signed_in))
    assert response.status_code == 200, response.text
    return NoticeList.model_validate_json(response.content).items


# spec:test client-meeting-notifications#notify-client-after-leader-saves
# spec:test client-meeting-notifications#notify-client-after-leader-confirms
# spec:test client-meeting-notifications#send-notification-email
# spec:test client-meeting-notifications#show-notification-bar-meetings-tab
# spec:test client-meeting-notifications#use-channels-card-self-given-email
# spec:test client-meeting-notifications#use-rescheduled-previous-new-date
# spec:test client-meeting-notifications#use-cancelled-meeting-date-time
# spec:test client-meeting-notifications#fill-date-time-placeholders-recipient
# spec:test client-meeting-notifications#compose-notification-rescheduled
# spec:test client-meeting-notifications#send-email-linked-attendee-account
# spec:test client-meeting-notifications#send-anything-reference-contacts-leader
# spec:test in-app-notice-bar#produce-bars-rescheduled-cancelled
# spec:test transactional-email#address-reschedule-cancellation-notices
# spec:test transactional-email#show-date-time-email-recipient
async def test_reschedule_and_cancel_dispatch_once_after_commit(
    account_stand: AccountStand, monkeypatch: pytest.MonkeyPatch
) -> None:
    leader = await account_stand.add_account("notice_specialist")
    attendee = await account_stand.add_account("linked_attendee")
    await account_stand.activate(leader)
    client, headers = account_stand.client, bearer(leader)
    assert (
        await client.patch(
            ACCOUNT,
            headers=bearer(attendee),
            json={"language": "ru", "time_zone": "Asia/Tokyo"},
        )
    ).status_code == 200
    assert (
        await client.patch(
            ACCOUNT,
            headers=headers,
            json={
                "first_name": "Ada\n<Lead>",
                "last_name": "Example",
                "time_zone": "America/New_York",
                "leader": {
                    "contact_email": "work@example.com",
                    "main_channel": "email",
                },
            },
        )
    ).status_code == 200

    domain = (
        "celmento.ru"
        if account_stand.settings.contour == Contour.RU
        else "celmento.com"
    )
    settings = account_stand.settings.model_copy(
        update={
            "email_from": f"notices@{domain}",
            "web_url_ru": "https://celmento.ru",
            "web_url_world": "https://celmento.com",
        }
    )
    monkeypatch.setattr(contour, "get_settings", lambda: settings)
    monkeypatch.setattr(emails, "get_settings", lambda: settings)

    given = "guest+prefill@example.com"
    card = await create_card(
        account_stand,
        leader,
        {"name": "Private name", "email": "reference@example.com"},
    )
    await set_card_channels(
        account_stand,
        card.id,
        recipient=given,
        linked=attendee,
        guest_language="en",
        guest_zone="Europe/Belgrade",
    )
    previous = datetime(2025, 5, 20, 22, 45, tzinfo=UTC)
    moved = datetime(2025, 5, 22, 10, 15, tzinfo=UTC)
    outbox: list[EmailMessage] = []
    monkeypatch.setattr(emails, "_deliver", outbox.append)
    meeting = await post_meeting(
        account_stand,
        leader,
        client_form(
            card.id,
            previous,
            meeting_link="https://meeting.example.com/",
            comment="Only the leader can read this comment",
        ),
    )
    assert not outbox and not await notices_for(account_stand, attendee)
    committed: list[tuple[datetime | None, set[str]]] = []
    loop = get_running_loop()

    async def committed_state() -> tuple[datetime | None, set[str]]:
        async with account_stand.session() as session:
            start = await session.scalar(
                select(Meeting.starts_at).where(Meeting.meeting_id == meeting.id)
            )
            keys = await session.scalars(
                select(NoticeRecord.key).where(
                    NoticeRecord.account_id == attendee.account.id
                )
            )
            return start, set(keys)

    def deliver(message: EmailMessage) -> None:
        committed.append(run_coroutine_threadsafe(committed_state(), loop).result(5))
        outbox.append(message)

    monkeypatch.setattr(emails, "_deliver", deliver)
    path = f"{MEETINGS}/{meeting.id}"
    async with timeout(10):
        writes = await gather(
            client.patch(path, headers=headers, json={"starts_at": moved.isoformat()}),
            client.patch(
                path, headers=headers, json={"starts_at": "2025-05-22T12:15:00+02:00"}
            ),
        )
    assert all(meeting_from(response).starts_at == moved for response in writes)
    assert len(outbox) == 1
    async with timeout(10):
        deletes = await gather(
            client.delete(path, headers=headers), client.delete(path, headers=headers)
        )
    assert sorted(response.status_code for response in deletes) == [204, 404]
    assert committed == [
        (moved, {NoticeKey.RESCHEDULED.value}),
        (None, {NoticeKey.RESCHEDULED.value, NoticeKey.CANCELLED.value}),
    ]
    assert len(outbox) == 2

    reschedule, cancellation = outbox
    assert str(reschedule["Subject"]) == (
        "Встреча перенесена: было 21 мая, 00:45 (Белград), стало 22 мая, "
        "12:15 (Белград) — Ada <Lead> Example"
    )
    assert str(cancellation["Subject"]) == (
        "Встреча 22 мая, 12:15 (Белград) отменена и удалена из расписания — "
        "Ada <Lead> Example"
    )
    assert [str(message["To"]) for message in outbox] == [given, given]
    assert [str(message["From"]) for message in outbox] == [
        f"celmēnto <notices@{domain}>",
        f"celmēnto <notices@{domain}>",
    ]
    for message in outbox:
        html = message.get_body(("html",))
        assert html is not None
        rendered: object = html.get_content()
        assert isinstance(rendered, str)
        assert (
            f'href="https://{domain}/login?email=guest%2Bprefill%40example.com"'
            in rendered
        )
        assert "Ada &lt;Lead&gt; Example" in rendered
        assert "work@example.com" in rendered
        assert "reference@example.com" not in rendered
        assert (
            attendee.account.email not in rendered
            and leader.account.email not in rendered
        )
        assert "Private name" not in rendered and "Only the leader" not in rendered

    notices = await notices_for(account_stand, attendee)
    assert [notice.key for notice in notices] == [
        NoticeKey.CANCELLED,
        NoticeKey.RESCHEDULED,
    ]
    assert [notice.tab for notice in notices] == [
        NoticeTab.MEETINGS,
        NoticeTab.MEETINGS,
    ]
    params = {"starts_at": moved.isoformat(), "specialist_name": "Ada <Lead> Example"}
    assert notices[0].params == params
    assert notices[1].params == {
        **params,
        "previous_starts_at": previous.isoformat(),
    }
    assert not await notices_for(account_stand, leader)


async def test_cancellation_email_uses_guest_linked_and_leader_fallbacks(
    account_stand: AccountStand, mail_outbox: list[EmailMessage]
) -> None:
    leader = await account_stand.add_account("fallback_specialist")
    viewer = await account_stand.add_account("other_person")
    await account_stand.activate(leader)
    client, headers = account_stand.client, bearer(leader)
    assert (
        await client.patch(
            ACCOUNT,
            headers=headers,
            json={"language": "en", "time_zone": "America/New_York"},
        )
    ).status_code == 200
    cases = (
        ("ru", "Europe/Moscow", None, "Встреча 2 февраля, 12:01 (Москва)"),
        (None, None, None, "Session on 2 February, 04:01 (New York)"),
        (None, None, viewer, "Session on 2 February, 10:01 (Belgrade)"),
    )
    for index, (language, zone, linked, subject_start) in enumerate(cases):
        card = await create_card(account_stand, leader, {"name": f"Guest {index}"})
        given = f"guest{index}@example.com"
        await set_card_channels(
            account_stand,
            card.id,
            recipient=given,
            linked=linked,
            guest_language=language,
            guest_zone=zone,
        )
        meeting = await post_meeting(
            account_stand,
            leader,
            client_form(card.id, datetime(2025, 2, 2, 9, 1, tzinfo=UTC)),
        )
        assert (
            await client.delete(f"{MEETINGS}/{meeting.id}", headers=headers)
        ).status_code == 204
        assert len(mail_outbox) == index + 1
        message = mail_outbox[index]
        assert str(message["To"]) == given
        assert str(message["Subject"]).startswith(subject_start)
        plain = message.get_body(("plain",))
        assert plain is not None
        content: object = plain.get_content()
        assert isinstance(content, str)
        assert "Contact the specialist:" not in content
        assert "Связь со специалистом:" not in content

    notices = await notices_for(account_stand, viewer)
    assert len(notices) == 1 and notices[0].key == NoticeKey.CANCELLED
    assert not await notices_for(account_stand, leader)


# spec:test client-meeting-notifications#send-anything-client-card-self-given
# spec:test client-meeting-notifications#notify-meeting-change-other-reschedule
async def test_only_scheduled_changes_for_the_same_client_can_notify(
    account_stand: AccountStand, mail_outbox: list[EmailMessage]
) -> None:
    leader = await account_stand.add_account("quiet_specialist")
    attendee = await account_stand.add_account("quiet_attendee")
    await account_stand.activate(leader)
    client, headers = account_stand.client, bearer(leader)
    linked_only = await create_card(
        account_stand, leader, {"name": "Linked", "email": "reference@example.com"}
    )
    neither = await create_card(
        account_stand, leader, {"name": "Standalone", "email": "standalone@example.com"}
    )
    email_only = await create_card(account_stand, leader, {"name": "Email"})
    await set_card_channels(account_stand, linked_only.id, linked=attendee)
    await set_card_channels(account_stand, email_only.id, recipient="own@example.com")
    start = datetime(2025, 6, 12, 11, tzinfo=UTC)
    moved = start + timedelta(hours=2)
    linked_path = f"{MEETINGS}/" + str(
        (
            await post_meeting(
                account_stand, leader, client_form(linked_only.id, start)
            )
        ).id
    )
    meeting_from(
        await client.patch(linked_path, headers=headers, json={"comment": "Private"})
    )
    assert not await notices_for(account_stand, attendee)
    meeting_from(
        await client.patch(
            linked_path, headers=headers, json={"starts_at": moved.isoformat()}
        )
    )
    assert (await client.delete(linked_path, headers=headers)).status_code == 204
    notices = await notices_for(account_stand, attendee)
    assert [notice.key for notice in notices] == [
        NoticeKey.CANCELLED,
        NoticeKey.RESCHEDULED,
    ]

    quiet = await post_meeting(account_stand, leader, client_form(neither.id, start))
    quiet_path = f"{MEETINGS}/{quiet.id}"
    updated = meeting_from(
        await client.patch(
            quiet_path, headers=headers, json={"starts_at": moved.isoformat()}
        )
    )
    assert updated.starts_at == moved
    assert (await client.delete(quiet_path, headers=headers)).status_code == 204
    assert (await client.get(quiet_path, headers=headers)).status_code == 404

    reassigned = await post_meeting(
        account_stand, leader, client_form(linked_only.id, start)
    )
    updated = meeting_from(
        await client.patch(
            f"{MEETINGS}/{reassigned.id}",
            headers=headers,
            json={"starts_at": moved.isoformat(), "client_id": str(email_only.id)},
        )
    )
    assert updated.client is not None and updated.client.id == email_only.id

    historical = await post_meeting(
        account_stand,
        leader,
        client_form(email_only.id, start, outcome={"status": "completed"}),
    )
    historic_path = f"{MEETINGS}/{historical.id}"
    meeting_from(
        await client.patch(historic_path, headers=headers, json={"comment": "Changed"})
    )
    assert (
        await client.delete(historic_path, headers=headers, params={"refund": "true"})
    ).status_code == 204

    personal = await post_meeting(account_stand, leader, service_form(start))
    personal_path = f"{MEETINGS}/{personal.id}"
    meeting_from(
        await client.patch(
            personal_path,
            headers=headers,
            json={"starts_at": (start - timedelta(days=1)).isoformat()},
        )
    )
    assert (await client.delete(personal_path, headers=headers)).status_code == 204
    assert not mail_outbox
    assert await notices_for(account_stand, attendee) == notices
