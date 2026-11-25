from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from celmento_api.errors import AppError
from celmento_api.models.enums import ErrorCode, FolderColor
from celmento_api.models.note import Folder
from celmento_api.schemas.notes import Folder as FolderView
from celmento_api.schemas.notes import FolderList


def folder_view(folder: Folder) -> FolderView:
    return FolderView(
        id=folder.folder_id,
        name=folder.name,
        color=FolderColor(folder.color),
        created_at=folder.created_at,
    )


async def owned_folder(
    session: AsyncSession, account_id: UUID, folder_id: UUID
) -> Folder:
    # spec:impl notes-grid-folders#keep-folders-personal-account-created
    folder = await session.scalar(
        select(Folder).where(
            Folder.owner_account_id == account_id, Folder.folder_id == folder_id
        )
    )
    if folder is None:
        raise AppError(404, ErrorCode.NOT_FOUND)
    return folder


async def folders_for(session: AsyncSession, account_id: UUID) -> FolderList:
    folders = await session.scalars(
        select(Folder)
        .where(Folder.owner_account_id == account_id)
        .order_by(Folder.created_at, Folder.folder_id)
    )
    return FolderList(items=[folder_view(folder) for folder in folders])
