from pathlib import Path

import yaml
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from celmento_api.errors import AppError
from celmento_api.models.account import Account
from celmento_api.models.enums import ErrorCode, Language
from celmento_api.models.leader import LeaderProfile
from celmento_api.models.note import Folder, Note
from celmento_api.models.preseeded import PreseededNoteSet
from celmento_api.schemas.notes import (
    AdminPreseededNotesSetReplace,
    PreseededNotesAsset,
)

CONTENT: Path = Path(__file__).resolve().parents[1] / "content"
INITIAL_VERSION: int = 1


def _template_asset(language: Language) -> PreseededNotesAsset:
    source = CONTENT / f"preseeded-notes.{language.value}.yaml"
    data: object = yaml.safe_load(source.read_text(encoding="utf-8"))
    # spec:impl preseeded-notes#take-folder-name-title-text
    asset = PreseededNotesAsset.model_validate(data)
    if asset.language != language:
        raise ValueError("Preseeded notes asset language must match its filename")
    return asset


async def _copy_set(
    session: AsyncSession,
    profile: LeaderProfile,
    template: AdminPreseededNotesSetReplace,
    version: int,
) -> None:
    # spec:impl preseeded-notes#create-set-second-time-account
    if profile.preseeded_notes_version is not None:
        return
    # spec:impl preseeded-notes#create-exactly-composition-note-how
    # spec:impl preseeded-notes#create-folders-order-practice
    folders = {
        item.key: Folder(
            owner_account_id=profile.account_id, name=item.name, color=item.color.value
        )
        for item in template.folders
    }
    session.add_all(folders.values())
    await session.flush()
    # spec:impl preseeded-notes#create-notes-folders-leader-private
    session.add_all(
        Note(
            author_account_id=profile.account_id,
            title=item.title,
            text=item.text,
            folder_id=folders[item.folder].folder_id
            if item.folder is not None
            else None,
        )
        for item in template.notes
    )
    profile.preseeded_notes_version = version


async def create_for(
    session: AsyncSession, account: Account, profile: LeaderProfile
) -> None:
    # spec:impl preseeded-notes#create-set-account-without-activation
    if account.activated_at is None:
        return
    # spec:impl preseeded-notes#create-set-account-interface-language
    template = await session.get(PreseededNoteSet, account.language)
    if template is None:
        raise AppError(500, ErrorCode.INTERNAL_ERROR)
    await _copy_set(
        session,
        profile,
        AdminPreseededNotesSetReplace.model_validate(template.content),
        template.version,
    )


async def seed_preseeded_notes(session: AsyncSession) -> None:
    templates = {language: _template_asset(language) for language in Language}
    statement = insert(PreseededNoteSet).values(
        [
            {
                "preseeded_note_set_id": language.value,
                "version": INITIAL_VERSION,
                "content": template.model_dump(mode="json", exclude={"language"}),
            }
            for language, template in templates.items()
        ]
    )
    content = statement.excluded["content"]
    await session.execute(
        statement.on_conflict_do_update(
            index_elements=[PreseededNoteSet.preseeded_note_set_id],
            set_={"content": content, "updated_at": func.clock_timestamp()},
            where=(PreseededNoteSet.version == INITIAL_VERSION)
            & PreseededNoteSet.content.is_distinct_from(content),
        )
    )
    legacy = await session.scalars(
        select(Account)
        .join(LeaderProfile, LeaderProfile.account_id == Account.account_id)
        .where(
            Account.activated_at.is_not(None),
            LeaderProfile.preseeded_notes_version.is_(None),
        )
        .order_by(Account.account_id)
        .with_for_update(of=Account, key_share=True)
        .execution_options(populate_existing=True)
    )
    for account in legacy:
        profile = await session.get(
            LeaderProfile,
            account.account_id,
            with_for_update=True,
            populate_existing=True,
        )
        if profile is not None:
            await _copy_set(
                session, profile, templates[Language(account.language)], INITIAL_VERSION
            )
