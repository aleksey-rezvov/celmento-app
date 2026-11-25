from typing import Annotated, Self, TypedDict
from uuid import UUID

from pydantic import (
    AfterValidator,
    AwareDatetime,
    BaseModel,
    BeforeValidator,
    Field,
    RootModel,
    StringConstraints,
    model_validator,
    with_config,
)

from celmento_api.models.enums import FolderColor, Language, NoteTagTargetKind
from celmento_api.schemas.account import TextInput, Uri
from celmento_api.schemas.meetings import require_timestamp

FolderName = Annotated[
    TextInput, StringConstraints(strip_whitespace=True, min_length=1, max_length=50)
]
NoteTitle = Annotated[TextInput, StringConstraints(max_length=200)]
NoteText = Annotated[TextInput, StringConstraints(max_length=20000)]
ReplyText = Annotated[NoteText, StringConstraints(min_length=1)]
NoteSearch = Annotated[TextInput, StringConstraints(min_length=1, max_length=200)]
ChecklistPosition = Annotated[int, Field(ge=0, strict=True)]
TemplateFolderKey = Annotated[
    str, StringConstraints(pattern=r"^[a-z][a-z0-9_]*$", max_length=32)
]


def distinct_positions(positions: list[int]) -> list[int]:
    if len(positions) != len(set(positions)):
        raise ValueError("Checklist positions must be unique")
    return positions


ChecklistPositions = Annotated[
    list[ChecklistPosition],
    AfterValidator(distinct_positions),
    Field(json_schema_extra={"uniqueItems": True}),
]


class FolderCreate(BaseModel, extra="forbid"):
    name: FolderName = Field(repr=False)
    color: FolderColor


@with_config(extra="forbid")
class FolderUpdateFields(TypedDict, total=False):
    name: FolderName
    color: FolderColor


class FolderUpdate(RootModel[FolderUpdateFields]):
    pass


class Folder(BaseModel):
    id: UUID
    name: str = Field(repr=False)
    color: FolderColor
    created_at: AwareDatetime


class FolderList(BaseModel):
    items: list[Folder]


class NoteCreate(BaseModel, extra="forbid"):
    title: NoteTitle = Field(default="", repr=False)
    text: NoteText = Field(default="", repr=False)
    folder_id: UUID | None = None


@with_config(extra="forbid")
class NoteUpdateFields(TypedDict, total=False):
    title: NoteTitle
    text: NoteText
    folder_id: UUID | None


class NoteUpdate(RootModel[NoteUpdateFields]):
    pass


class NoteTagCreate(BaseModel, extra="forbid"):
    target_id: UUID


class NoteReplyCreate(BaseModel, extra="forbid"):
    text: ReplyText = Field(repr=False)


class NoteChecklistTicks(BaseModel, extra="forbid"):
    expected_updated_at: Annotated[AwareDatetime, BeforeValidator(require_timestamp)]
    expected_checked_items: ChecklistPositions
    checked_items: ChecklistPositions


class NoteTag(BaseModel):
    id: UUID
    target_kind: NoteTagTargetKind
    target_id: UUID
    name: str = Field(repr=False)
    photo_url: Uri | None
    archived: bool
    linked: bool
    created_at: AwareDatetime


class NoteAuthor(BaseModel):
    id: UUID
    name: str = Field(repr=False)
    photo_url: Uri | None


class Note(BaseModel):
    id: UUID
    author: NoteAuthor
    title: NoteTitle = Field(repr=False)
    text: NoteText = Field(repr=False)
    folder_id: UUID | None
    tags: list[NoteTag]
    shared_with_me: bool
    can_edit: bool
    checked_items: list[ChecklistPosition]
    created_at: AwareDatetime
    updated_at: AwareDatetime


class NoteList(BaseModel):
    items: list[Note]
    total: Annotated[int, Field(ge=0)]


class ClientNoteList(BaseModel):
    items: list[Note]


class NoteTaggablePerson(BaseModel):
    target_id: UUID
    name: str = Field(repr=False)
    photo_url: Uri | None
    linked: bool
    tagged_before: bool


class NoteTaggableList(BaseModel):
    items: list[NoteTaggablePerson]


class AdminPreseededFolder(BaseModel, extra="forbid"):
    key: TemplateFolderKey
    name: FolderName
    color: FolderColor


class AdminPreseededNote(BaseModel, extra="forbid"):
    folder: TemplateFolderKey | None
    title: Annotated[NoteTitle, StringConstraints(min_length=1)]
    text: NoteText


class AdminPreseededNotesSetReplace(BaseModel, extra="forbid"):
    folders: list[AdminPreseededFolder]
    notes: list[AdminPreseededNote]

    @model_validator(mode="after")
    def validate_folder_keys(self) -> Self:
        keys = {folder.key for folder in self.folders}
        if len(keys) != len(self.folders) or any(
            note.folder is not None and note.folder not in keys for note in self.notes
        ):
            raise ValueError(
                "Folder keys must be unique and every reference must exist"
            )
        return self


class PreseededNotesAsset(AdminPreseededNotesSetReplace):
    language: Language
