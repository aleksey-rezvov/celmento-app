from uuid import UUID

from pydantic import AwareDatetime, BaseModel

from celmento_api.models.enums import NoticeKey, NoticeTab


class Notice(BaseModel):
    id: UUID
    tab: NoticeTab
    key: NoticeKey
    params: dict[str, str]
    created_at: AwareDatetime


class NoticeList(BaseModel):
    items: list[Notice]
