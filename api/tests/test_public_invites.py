from datetime import UTC, datetime, timedelta
from urllib.parse import urlsplit
from uuid import UUID, uuid7

import pytest
from sqlalchemy import select
from test_account import ACCOUNT, ACTIVATION, NOTICES
from test_auth_registration import ACTIVATION as ACTIVATION_CONSENTS
from test_auth_registration import AuthStand, assert_error, auth_stand, package_from
from test_clients_api import CLIENTS, bearer, card_from, problem
from test_meetings_api import MEETINGS, meeting_from, service_form
from test_meetings_ledger import client_form
from test_public_bookings import BOOKINGS, PUBLIC

from celmento_api.models.account import Account
from celmento_api.models.client_card import ClientCard
from celmento_api.models.enums import (
    Contour,
    ErrorCode,
    MeetingPlace,
    NoticeKey,
    NoticeTab,
)
from celmento_api.schemas.auth import (
    CodeRequestOutcome,
    FinishOutcome,
    FinishRegistrationResult,
    SignInCodeRequestResult,
    SignInCodeVerificationResult,
    SignInSession,
    VerificationOutcome,
)
from celmento_api.schemas.notices import NoticeList
from celmento_api.schemas.public import MeetingInvitePage
from celmento_api.services.sessions import issue_session

__all__: list[str] = ["auth_stand"]


async def _leader(stand: AuthStand) -> SignInSession:
    email = "inviting-leader@example.com"
    await stand.add_account(email, "inviter_page")
    async with stand.session() as session:
        row = await session.scalar(select(Account).where(Account.email == email))
        assert row is not None
        leader = await issue_session(session, row, "http://world.celmento.test")
        await session.commit()
    activation = await stand.client.post(
        ACTIVATION,
        headers=bearer(leader),
        json={
            "age_confirmed": True,
            "acceptances": await stand.consents(ACTIVATION_CONSENTS),
        },
    )
    assert activation.status_code == 200, activation.text
    return leader


# spec:test meeting-invite-page#show-page-only-individual-client
# spec:test meeting-invite-page#show-page-client-name-card
# spec:test meeting-invite-page#show-in-person-meeting-address
# spec:test meeting-invite-page#write-anything-database-page-opened
# spec:test meeting-invite-page#notify-leader-bar-invite-registered
# spec:test meeting-invite-page#notify-leader-notify-specialist
# spec:test meeting-invite-page#link-card-new-account-add
@pytest.mark.parametrize("opted_in", [False, True])
async def test_invite_uses_valid_public_details_and_signed_opt_in_recipient(
    auth_stand: AuthStand, opted_in: bool
) -> None:
    auth_stand.switch(Contour.WORLD)
    client = auth_stand.client
    leader = await _leader(auth_stand)
    headers = bearer(leader)
    card = card_from(
        await client.post(CLIENTS, headers=headers, json={"name": "Private card name"}),
        201,
    )
    start = datetime.now(UTC).replace(microsecond=0) + timedelta(days=2)
    appointment = meeting_from(
        await client.post(
            MEETINGS,
            headers=headers,
            json=client_form(
                card.id,
                start,
                place="in_person",
                address="Studio,\nSecond floor; bell",
                comment="Private leader comment",
            ),
        ),
        201,
    )
    assert appointment.invite_url is not None
    public_id = UUID(urlsplit(appointment.invite_url).path.rsplit("/", 1)[-1])
    assert public_id.version == 4 and public_id != appointment.id
    path = f"{PUBLIC}/specialists/{leader.account.login}/meet/{public_id}"
    alternate_case = (
        f"{PUBLIC}/specialists/{leader.account.login.upper()}/meet/{public_id}"
    )
    before_read = await auth_stand.counts()
    page_response = await client.get(alternate_case)
    assert page_response.status_code == 200, page_response.text
    page = MeetingInvitePage.model_validate_json(page_response.content)
    assert (
        page.place == MeetingPlace.IN_PERSON
        and page.address == "Studio,\nSecond floor; bell"
    )
    assert page.meeting_link is None and page.starts_at == start
    assert (
        page.specialist_first_name == "Known" and page.specialist_last_name == "Tester"
    )
    for hidden in (
        "Private card name",
        "Private leader comment",
        "100.25",
        str(card.id),
        str(appointment.id),
    ):
        assert hidden not in page_response.text
    calendar = await client.get(f"{path}/calendar.ics", params={"language": "en"})
    assert (
        calendar.status_code == 200
        and "SUMMARY:Session with Known Tester" in calendar.text
    )
    assert "LOCATION:Studio\\,\\nSecond floor\\; bell\r\n" in calendar.text
    assert "Private leader comment" not in calendar.text
    assert (await client.get(f"{BOOKINGS}/{public_id}/calendar.ics")).status_code == 404
    assert await auth_stand.counts() == before_read and not auth_stand.outbox

    non_client = meeting_from(
        await client.post(
            MEETINGS, headers=headers, json=service_form(start + timedelta(hours=2))
        ),
        201,
    )
    assert non_client.invite_url is None
    problem(
        await client.get(f"{PUBLIC}/specialists/{leader.account.login}/meet/{uuid7()}"),
        404,
        ErrorCode.NOT_FOUND,
    )
    problem(
        await client.get(
            f"{PUBLIC}/specialists/{leader.account.login}/meet/{appointment.id}"
        ),
        404,
        ErrorCode.NOT_FOUND,
    )
    problem(
        await client.get(f"{PUBLIC}/specialists/mismatch/meet/{public_id}"),
        404,
        ErrorCode.NOT_FOUND,
    )
    auth_stand.switch(Contour.RU)
    problem(await client.get(path), 404, ErrorCode.NOT_FOUND)
    auth_stand.switch(Contour.WORLD)

    await auth_stand.add_account("already-member@example.com", "already_member")
    existing = await client.post(
        f"{path}/join", json={"email": "already-member@example.com", "language": "en"}
    )
    assert existing.status_code == 200 and len(auth_stand.outbox) == 1
    assert (
        SignInCodeRequestResult.model_validate_json(existing.content).outcome
        == CodeRequestOutcome.CODE_SENT
    )
    verified = await auth_stand.post(
        "code/verify",
        {"email": "already-member@example.com", "code": auth_stand.code()},
    )
    assert verified.status_code == 200
    assert (
        SignInCodeVerificationResult.model_validate_json(verified.content).outcome
        == VerificationOutcome.SIGNED_IN
    )
    email = "first-time-invitee@example.com"
    before = await auth_stand.counts()
    unknown = await client.post(f"{path}/join", json={"email": email, "language": "en"})
    assert unknown.status_code == 200 and len(auth_stand.outbox) == 1
    assert (
        SignInCodeRequestResult.model_validate_json(unknown.content).outcome
        == CodeRequestOutcome.REGISTRATION_REQUIRED
    )
    assert await auth_stand.counts() == before
    response = await client.get(NOTICES, headers=headers)
    assert (
        response.status_code == 200
        and NoticeList.model_validate_json(response.content).items == []
    )

    registration = await auth_stand.registration(email, intent="lead")
    registration["origin"] = {
        "page": "meeting_invite",
        "login": leader.account.login.upper(),
        "meeting_id": str(public_id),
        "specialist_first_name": "Forged name",
    }
    assert (await auth_stand.post("register", registration)).status_code == 200
    package = package_from(
        await auth_stand.post(
            "code/verify", auth_stand.verification(email, registration)
        )
    )
    assert package.claims.origin is not None and package.claims.intent is None
    assert package.claims.origin.specialist_first_name == leader.account.first_name
    assert (
        package.claims.origin.login == leader.account.login
        and package.claims.origin.meeting_id == public_id
    )
    assert await auth_stand.counts() == before
    auth_stand.switch(Contour.RU)
    assert_error(
        await auth_stand.post(
            "registration/finish", auth_stand.finish_form(package, "invite_member")
        ),
        400,
        ErrorCode.REGION_LOCKED,
    )
    auth_stand.switch(Contour.WORLD)

    assert (
        await client.delete(f"{MEETINGS}/{appointment.id}", headers=headers)
    ).status_code == 204
    assert (
        await client.patch(ACCOUNT, headers=headers, json={"login": "renamed_inviter"})
    ).status_code == 200
    await auth_stand.add_account("successor@example.com", leader.account.login)
    problem(await client.get(path), 404, ErrorCode.NOT_FOUND)
    finished = await auth_stand.post(
        "registration/finish",
        {
            **auth_stand.finish_form(package, "invite_member"),
            "notify_specialist": opted_in,
        },
    )
    assert finished.status_code == 201, finished.text
    result = FinishRegistrationResult.model_validate_json(finished.content)
    assert result.outcome == FinishOutcome.SESSION and result.session is not None
    # spec:test meeting-invite-page#create-new-account-leader-contour
    assert (
        not result.session.account.activated
        and result.session.account.contour == Contour.WORLD
    )
    note_response = await client.get(NOTICES, headers=headers)
    assert note_response.status_code == 200
    notices = NoticeList.model_validate_json(note_response.content).items
    if opted_in:
        assert len(notices) == 1 and notices[0].key == NoticeKey.INVITE_REGISTERED
        assert notices[0].tab == NoticeTab.PEOPLE
        assert notices[0].params == {"name": "Sample Tester", "login": "invite_member"}
    else:
        assert notices == []
    async with auth_stand.session() as session:
        stored = await session.get(ClientCard, card.id)
        assert stored is not None and stored.linked_account_id is None
