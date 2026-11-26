from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import ColumnElement, Nullable, Select, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from celmento_api.errors import AppError
from celmento_api.models.account import Account
from celmento_api.models.client_card import ClientCard
from celmento_api.models.enums import (
    ClientCardStatus,
    ErrorCode,
    NoteFilter,
    NoteTagTargetKind,
)
from celmento_api.models.note import Note, NoteChecklistTick, NoteTag
from celmento_api.schemas.notes import ClientNoteList, NoteAuthor, NoteList
from celmento_api.schemas.notes import Note as NoteView
from celmento_api.schemas.notes import NoteTag as TagView
from celmento_api.services.clients import owned_client
from celmento_api.services.folders import owned_folder
from celmento_api.storage import client_photo_url, photo_url


def shared_condition(account_id: UUID) -> ColumnElement[bool]:
    # spec:impl note-sharing-tags#keep-tag-placed-standalone-card
    return (
        select(NoteTag.note_tag_id)
        .outerjoin(
            ClientCard,
            (NoteTag.client_card_id == ClientCard.client_card_id)
            & (ClientCard.leader_account_id == Note.author_account_id),
        )
        .where(
            NoteTag.note_id == Note.note_id,
            or_(
                NoteTag.account_id == account_id,
                ClientCard.linked_account_id == account_id,
            ),
        )
        .correlate(Note)
        .exists()
    )


def _visibility(account_id: UUID) -> ColumnElement[bool]:
    # spec:impl note-editor#keep-new-note-private-author
    # spec:impl note-sharing-tags#show-note-anyone-author-until
    # spec:impl note-sharing-tags#show-note-client-other-specialists
    return or_(Note.author_account_id == account_id, shared_condition(account_id))


async def _lock_recipient_access(
    session: AsyncSession, note: Note, account_id: UUID
) -> bool:
    direct = await session.scalar(
        select(NoteTag.note_tag_id).where(
            NoteTag.note_id == note.note_id, NoteTag.account_id == account_id
        )
    )
    if direct is not None:
        return True
    card = await session.scalar(
        select(ClientCard.client_card_id)
        .join(NoteTag, NoteTag.client_card_id == ClientCard.client_card_id)
        .where(
            NoteTag.note_id == note.note_id,
            ClientCard.leader_account_id == note.author_account_id,
            ClientCard.linked_account_id == account_id,
        )
        .with_for_update(of=ClientCard)
    )
    return card is not None


async def readable_note(
    session: AsyncSession, account_id: UUID, note_id: UUID, *, lock: bool = False
) -> Note:
    statement = select(Note).where(Note.note_id == note_id, _visibility(account_id))
    if lock:
        statement = statement.with_for_update().execution_options(
            populate_existing=True
        )
    note = await session.scalar(statement)
    if note is None:
        raise AppError(404, ErrorCode.NOT_FOUND)
    # A tag or card link may have changed while the note lock was pending.
    if (
        lock
        and note.author_account_id != account_id
        and not await _lock_recipient_access(session, note, account_id)
    ):
        raise AppError(404, ErrorCode.NOT_FOUND)
    return note


async def editable_note(session: AsyncSession, account_id: UUID, note_id: UUID) -> Note:
    note = await readable_note(session, account_id, note_id, lock=True)
    # spec:impl note-editor#let-anyone-author-change-title
    # spec:impl note-sharing-tags#open-received-note-read-only-recipient
    if note.author_account_id != account_id:
        raise AppError(403, ErrorCode.NOTE_READ_ONLY)
    return note


def _person_name(account: Account) -> str:
    return f"{account.first_name} {account.last_name}"


def _tag_view(
    tag: NoteTag, card: ClientCard | None, account: Account | None, origin: str
) -> TagView:
    if card is not None:
        return TagView(
            id=tag.note_tag_id,
            target_kind=NoteTagTargetKind.CLIENT_CARD,
            target_id=card.client_card_id,
            name=card.name,
            photo_url=client_photo_url(card.client_card_id, card.photo_key, origin),
            archived=card.status == ClientCardStatus.ARCHIVED.value,
            linked=card.linked_account_id is not None,
            created_at=tag.created_at,
        )
    if account is None:
        raise AppError(500, ErrorCode.INTERNAL_ERROR)
    return TagView(
        id=tag.note_tag_id,
        target_kind=NoteTagTargetKind.ACCOUNT,
        target_id=account.account_id,
        name=_person_name(account),
        photo_url=photo_url(account.photo_key, origin),
        archived=False,
        linked=True,
        created_at=tag.created_at,
    )


async def _views(
    session: AsyncSession,
    account_id: UUID,
    rows: Sequence[tuple[Note, Account]],
    origin: str,
) -> list[NoteView]:
    owned = [note.note_id for note, _ in rows if note.author_account_id == account_id]
    shared = [note.note_id for note, _ in rows if note.author_account_id != account_id]
    tags: dict[UUID, list[TagView]] = {}
    if owned:
        stored_tags = await session.execute(
            select(NoteTag, Nullable(ClientCard), Nullable(Account))
            .outerjoin(ClientCard, NoteTag.client_card_id == ClientCard.client_card_id)
            .outerjoin(Account, NoteTag.account_id == Account.account_id)
            .where(NoteTag.note_id.in_(owned))
            .order_by(NoteTag.created_at, NoteTag.note_tag_id)
        )
        # spec:impl note-sharing-tags#copy-private-client-card-fields
        for tag, card, target in stored_tags:
            tags.setdefault(tag.note_id, []).append(
                _tag_view(tag, card, target, origin)
            )

    ticks: dict[UUID, list[int]] = {}
    if shared:
        stored_ticks = await session.execute(
            select(NoteChecklistTick.note_id, NoteChecklistTick.checked_items).where(
                NoteChecklistTick.note_id.in_(shared),
                NoteChecklistTick.account_id == account_id,
            )
        )
        ticks = {note_id: positions for note_id, positions in stored_ticks}

    return [
        NoteView(
            id=note.note_id,
            author=NoteAuthor(
                id=author.account_id,
                name=_person_name(author),
                photo_url=photo_url(author.photo_key, origin),
            ),
            title=note.title,
            text=note.text,
            # spec:impl notes-grid-folders#move-received-note-account-folders
            folder_id=note.folder_id if note.author_account_id == account_id else None,
            # spec:impl note-sharing-tags#reveal-tagged-people-other-tagged
            tags=tags.get(note.note_id, []),
            checked_items=ticks.get(note.note_id, []),
            can_edit=note.author_account_id == account_id,
            shared_with_me=note.author_account_id != account_id,
            created_at=note.created_at,
            updated_at=note.updated_at,
        )
        for note, author in rows
    ]


async def note_view(
    session: AsyncSession, viewer: Account, note: Note, origin: str
) -> NoteView:
    author = await session.get(Account, note.author_account_id)
    if author is None:
        raise AppError(500, ErrorCode.INTERNAL_ERROR)
    return (await _views(session, viewer.account_id, [(note, author)], origin))[0]


def _note_rows() -> Select[Note, Account]:
    return select(Note, Account).join(
        Account, Note.author_account_id == Account.account_id
    )


def _client_scope(card: ClientCard) -> ColumnElement[bool]:
    tagged_card = (
        select(NoteTag.note_tag_id)
        .where(
            NoteTag.note_id == Note.note_id,
            NoteTag.client_card_id == card.client_card_id,
        )
        .correlate(Note)
        .exists()
    )
    return or_(
        (Note.author_account_id == card.leader_account_id) & tagged_card,
        (Note.author_account_id == card.linked_account_id)
        & shared_condition(card.leader_account_id),
    )


async def notes_for(
    session: AsyncSession,
    viewer: Account,
    origin: str,
    ownership: NoteFilter,
    folder_id: UUID | None,
    q: str | None,
    client_id: UUID | None,
) -> NoteList:
    account_id = viewer.account_id
    visible = _visibility(account_id)
    statement = _note_rows().where(visible)
    if folder_id is not None:
        await owned_folder(session, account_id, folder_id)
        statement = statement.where(
            Note.folder_id == folder_id, Note.author_account_id == account_id
        )
    if client_id is not None:
        if viewer.activated_at is None:
            raise AppError(403, ErrorCode.ACTIVATION_REQUIRED)
        card = await owned_client(session, account_id, client_id)
        statement = statement.where(_client_scope(card))
    if q is not None:
        statement = statement.where(
            or_(
                Note.title.icontains(q, autoescape=True),
                Note.text.icontains(q, autoescape=True),
            )
        )
    else:
        if folder_id is None and client_id is None:
            statement = statement.where(
                or_(Note.folder_id.is_(None), Note.author_account_id != account_id)
            )
        if ownership == NoteFilter.MINE:
            statement = statement.where(Note.author_account_id == account_id)
        elif ownership == NoteFilter.SHARED:
            statement = statement.where(Note.author_account_id != account_id)
    rows = await session.execute(
        statement.order_by(Note.updated_at.desc(), Note.note_id.desc())
    )
    total = await session.scalar(select(func.count()).select_from(Note).where(visible))
    return NoteList(
        items=await _views(
            session, account_id, [(note, author) for note, author in rows], origin
        ),
        total=total or 0,
    )


async def notes_for_client(
    session: AsyncSession, viewer: Account, card: ClientCard, origin: str, limit: int
) -> ClientNoteList:
    rows = await session.execute(
        _note_rows()
        .where(_client_scope(card))
        .order_by(Note.updated_at.desc(), Note.note_id.desc())
        .limit(limit)
    )
    return ClientNoteList(
        items=await _views(
            session,
            viewer.account_id,
            [(note, author) for note, author in rows],
            origin,
        )
    )


async def notes_shared_by_specialist(
    session: AsyncSession, viewer: Account, specialist_id: UUID, origin: str
) -> list[NoteView]:
    rows = await session.execute(
        _note_rows()
        .where(
            Note.author_account_id == specialist_id,
            shared_condition(viewer.account_id),
        )
        .order_by(Note.updated_at.desc(), Note.note_id.desc())
        .limit(3)
    )
    return await _views(
        session, viewer.account_id, [(note, author) for note, author in rows], origin
    )
