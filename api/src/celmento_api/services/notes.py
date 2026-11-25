from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

from pydantic import BaseModel
from sqlalchemy import delete, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from celmento_api.errors import AppError
from celmento_api.models.account import Account
from celmento_api.models.client_card import ClientCard
from celmento_api.models.enums import ClientCardStatus, ErrorCode, NoteTagTargetKind
from celmento_api.models.note import (
    Note,
    NoteChecklistTick,
    NoteRequestReceipt,
    NoteTag,
    NoteWriteOperation,
    TagHistory,
)
from celmento_api.schemas.notes import (
    NoteChecklistTicks,
    NoteCreate,
    NoteReplyCreate,
    NoteTaggableList,
    NoteTaggablePerson,
    NoteUpdateFields,
)
from celmento_api.services.account_access import lock_account
from celmento_api.services.clients import owned_client
from celmento_api.services.folders import owned_folder
from celmento_api.services.idempotency import request_fingerprint
from celmento_api.services.note_access import editable_note, readable_note
from celmento_api.services.note_checklists import (
    remap_recipient_ticks,
    replace_recipient_ticks,
)
from celmento_api.storage import client_photo_url


@dataclass(frozen=True, slots=True)
class NoteRequest:
    operation: NoteWriteOperation
    key: UUID
    digest: str


def _note_request(
    operation: NoteWriteOperation,
    key: UUID | None,
    body: BaseModel,
    target_id: UUID | None = None,
) -> NoteRequest | None:
    if key is None:
        return None
    return NoteRequest(operation, key, request_fingerprint(body, target_id))


async def _previous_note(
    session: AsyncSession, account_id: UUID, request: NoteRequest | None
) -> Note | None:
    if request is None:
        return None
    receipt = await session.scalar(
        select(NoteRequestReceipt).where(
            NoteRequestReceipt.account_id == account_id,
            NoteRequestReceipt.operation == request.operation.value,
            NoteRequestReceipt.idempotency_key == request.key,
        )
    )
    if receipt is None:
        return None
    if receipt.note_id is None or receipt.request_digest != request.digest:
        raise AppError(409, ErrorCode.CONFLICT)
    return await editable_note(session, account_id, receipt.note_id)


async def _save_note(
    session: AsyncSession, note: Note, request: NoteRequest | None
) -> None:
    session.add(note)
    await session.flush()
    if request is not None:
        session.add(
            NoteRequestReceipt(
                account_id=note.author_account_id,
                operation=request.operation.value,
                idempotency_key=request.key,
                request_digest=request.digest,
                note_id=note.note_id,
            )
        )


def _new_note(
    author_id: UUID,
    *,
    title: str,
    text: str,
    folder_id: UUID | None = None,
    reply_to: UUID | None = None,
) -> Note:
    # spec:impl note-editor#record-author-creation-date-modified
    now = datetime.now(UTC)
    return Note(
        author_account_id=author_id,
        title=title,
        text=text,
        folder_id=folder_id,
        reply_to_note_id=reply_to,
        created_at=now,
        updated_at=now,
    )


def _touch(note: Note) -> None:
    note.updated_at = max(
        datetime.now(UTC), note.updated_at + timedelta(microseconds=1)
    )


async def create_note(
    session: AsyncSession, account: Account, body: NoteCreate, key: UUID | None
) -> Note:
    await lock_account(session, account.account_id, no_key_update=True)
    request = _note_request(NoteWriteOperation.CREATE_NOTE, key, body)
    previous = await _previous_note(session, account.account_id, request)
    if previous is not None:
        return previous
    if body.folder_id is not None:
        await owned_folder(session, account.account_id, body.folder_id)
    note = _new_note(
        account.account_id, title=body.title, text=body.text, folder_id=body.folder_id
    )
    await _save_note(session, note, request)
    return note


async def update_note(
    session: AsyncSession, account: Account, note_id: UUID, body: NoteUpdateFields
) -> Note:
    await lock_account(session, account.account_id, no_key_update=True)
    note = await editable_note(session, account.account_id, note_id)
    title = body.get("title", note.title)
    text = body.get("text", note.text)
    folder_id = body.get("folder_id", note.folder_id)
    if (title, text, folder_id) == (note.title, note.text, note.folder_id):
        return note
    if folder_id is not None and folder_id != note.folder_id:
        await owned_folder(session, account.account_id, folder_id)
    if text != note.text:
        await remap_recipient_ticks(session, note, text)
    note.title = title
    note.text = text
    note.folder_id = folder_id
    _touch(note)
    return note


async def delete_note(session: AsyncSession, account: Account, note_id: UUID) -> None:
    await lock_account(session, account.account_id, no_key_update=True)
    note = await editable_note(session, account.account_id, note_id)
    # spec:impl note-sharing-tags#keep-reply-unchanged-note-answers
    await session.delete(note)


async def taggable_people(
    session: AsyncSession, leader: Account, origin: str
) -> NoteTaggableList:
    rows = await session.execute(
        select(ClientCard, TagHistory.client_card_id.is_not(None))
        .outerjoin(
            TagHistory,
            (TagHistory.client_card_id == ClientCard.client_card_id)
            & (TagHistory.leader_account_id == ClientCard.leader_account_id),
        )
        .where(
            ClientCard.leader_account_id == leader.account_id,
            ClientCard.status == ClientCardStatus.ACTIVE.value,
        )
        .order_by(ClientCard.name, ClientCard.client_card_id)
    )
    # spec:impl note-sharing-tags#list-screen-7-3-person-not-one
    # spec:impl note-sharing-tags#show-first-tag-warning-person-leader
    return NoteTaggableList(
        items=[
            NoteTaggablePerson(
                target_id=card.client_card_id,
                name=card.name,
                linked=card.linked_account_id is not None,
                photo_url=client_photo_url(card.client_card_id, card.photo_key, origin),
                tagged_before=tagged_before,
            )
            for card, tagged_before in rows
        ]
    )


async def tag_note(
    session: AsyncSession, leader: Account, note_id: UUID, client_id: UUID
) -> Note:
    await lock_account(session, leader.account_id, no_key_update=True)
    note = await editable_note(session, leader.account_id, note_id)
    card = await owned_client(session, leader.account_id, client_id, lock=True)
    # spec:impl note-sharing-tags#allow-tagging-archived-client-new
    if card.status == ClientCardStatus.ARCHIVED.value:
        raise AppError(409, ErrorCode.TAG_NOT_ALLOWED)
    duplicates = NoteTag.client_card_id == client_id
    if card.linked_account_id is not None:
        duplicates = or_(duplicates, NoteTag.account_id == card.linked_account_id)
    prior = await session.scalar(
        select(NoteTag.note_tag_id).where(NoteTag.note_id == note_id, duplicates)
    )
    if prior is not None:
        raise AppError(409, ErrorCode.CONFLICT)
    session.add(
        NoteTag(
            note_id=note_id,
            target_kind=NoteTagTargetKind.CLIENT_CARD.value,
            client_card_id=client_id,
        )
    )
    await session.execute(
        insert(TagHistory)
        .values(leader_account_id=leader.account_id, client_card_id=client_id)
        .on_conflict_do_nothing()
    )
    _touch(note)
    return note


async def _linked_card(
    session: AsyncSession, leader_id: UUID, account_id: UUID
) -> ClientCard | None:
    return await session.scalar(
        select(ClientCard)
        .where(
            ClientCard.leader_account_id == leader_id,
            ClientCard.linked_account_id == account_id,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )


async def remove_tag(
    session: AsyncSession, account: Account, note_id: UUID, tag_id: UUID
) -> None:
    await lock_account(session, account.account_id, no_key_update=True)
    note = await editable_note(session, account.account_id, note_id)
    tag = await session.scalar(
        select(NoteTag).where(NoteTag.note_id == note_id, NoteTag.note_tag_id == tag_id)
    )
    if tag is None:
        raise AppError(404, ErrorCode.NOT_FOUND)

    if tag.client_card_id is not None:
        card = await owned_client(
            session, account.account_id, tag.client_card_id, lock=True
        )
        recipient = card.linked_account_id
    else:
        recipient = tag.account_id
        card = (
            await _linked_card(session, account.account_id, recipient)
            if recipient is not None
            else None
        )

    targets = NoteTag.note_tag_id == tag_id
    if recipient is not None:
        # A card linked after being tagged may overlap with an automatic reply tag.
        targets = or_(targets, NoteTag.account_id == recipient)
        if card is not None:
            targets = or_(targets, NoteTag.client_card_id == card.client_card_id)
        await session.execute(
            delete(NoteChecklistTick).where(
                NoteChecklistTick.note_id == note_id,
                NoteChecklistTick.account_id == recipient,
            )
        )
    # spec:impl note-sharing-tags#offer-remove-access-author-taps-tagged
    # spec:impl note-sharing-tags#send-email-contacts-written-client
    await session.execute(delete(NoteTag).where(NoteTag.note_id == note_id, targets))
    _touch(note)


async def reply_to_note(
    session: AsyncSession,
    account: Account,
    note_id: UUID,
    body: NoteReplyCreate,
    key: UUID | None,
) -> Note:
    await lock_account(session, account.account_id, no_key_update=True)
    request = _note_request(NoteWriteOperation.REPLY_TO_NOTE, key, body, note_id)
    previous = await _previous_note(session, account.account_id, request)
    if previous is not None:
        return previous
    original = await readable_note(session, account.account_id, note_id, lock=True)
    if original.author_account_id == account.account_id:
        raise AppError(403, ErrorCode.FORBIDDEN)
    card = await _linked_card(session, original.author_account_id, account.account_id)
    if card is not None and card.status == ClientCardStatus.ARCHIVED.value:
        raise AppError(409, ErrorCode.TAG_NOT_ALLOWED)
    # The replier's account lock also serializes transitions of cards they own.
    archived_recipient = await session.scalar(
        select(ClientCard.client_card_id).where(
            ClientCard.leader_account_id == account.account_id,
            ClientCard.linked_account_id == original.author_account_id,
            ClientCard.status == ClientCardStatus.ARCHIVED.value,
        )
    )
    if archived_recipient is not None:
        raise AppError(409, ErrorCode.TAG_NOT_ALLOWED)
    reply = _new_note(account.account_id, title="", text=body.text, reply_to=note_id)
    await _save_note(session, reply, request)
    session.add(
        NoteTag(
            note_id=reply.note_id,
            target_kind=NoteTagTargetKind.ACCOUNT.value,
            account_id=original.author_account_id,
        )
    )
    return reply


async def set_checklist_ticks(
    session: AsyncSession, account: Account, note_id: UUID, body: NoteChecklistTicks
) -> Note:
    note = await readable_note(session, account.account_id, note_id, lock=True)
    if note.author_account_id == account.account_id:
        raise AppError(403, ErrorCode.FORBIDDEN)
    if note.updated_at != body.expected_updated_at:
        raise AppError(409, ErrorCode.CONFLICT)
    await replace_recipient_ticks(
        session,
        note,
        account.account_id,
        body.checked_items,
        body.expected_checked_items,
    )
    return note
