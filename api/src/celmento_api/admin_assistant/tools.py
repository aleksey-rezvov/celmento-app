from collections import Counter
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from difflib import SequenceMatcher
from functools import partial
from uuid import UUID

from mcp.server import MCPServer
from mcp.server.mcpserver import Context
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations
from pydantic import BaseModel, JsonValue, StrictBool

from celmento_api.admin_assistant.api import AdminAPI, Method
from celmento_api.admin_assistant.confirmation import (
    Approval,
    ChangeDetails,
    ChangePreview,
    ChangeRequest,
    ConfirmationCount,
    Confirmations,
    Confirmed,
    CountConfirmation,
)
from celmento_api.models.enums import AdminAction, Language, LegalDocumentKind
from celmento_api.schemas.account import Email
from celmento_api.schemas.admin import (
    AdminAccountLookup,
    AdminFeedbackList,
    AdminFeedbackMarkProcessed,
    AdminGrantedSubscription,
    AdminJournalList,
    AdminLegalDocumentVersion,
    AdminLegalDocumentVersionCreate,
    AdminPeriod,
    AdminPreseededNotesSet,
    AdminReservedLoginWordCreate,
    AdminReservedLoginWordList,
    AdminStatistics,
    AdminSubscriptionGrant,
)
from celmento_api.schemas.notes import (
    AdminPreseededFolder,
    AdminPreseededNote,
    AdminPreseededNotesSetReplace,
)

READ_TOOL: ToolAnnotations = ToolAnnotations(read_only_hint=True, open_world_hint=False)
CHANGE_TOOL: ToolAnnotations = ToolAnnotations(
    read_only_hint=False, open_world_hint=False
)
FEEDBACK_PATH: str = "admin/feedback"
RESERVED_WORDS_PATH: str = "admin/reserved-login-words"


@dataclass(frozen=True, slots=True)
class AdminAssistant:
    api: AdminAPI
    confirmations: Confirmations


def _period_params(period: AdminPeriod | None) -> dict[str, str | bool]:
    params: dict[str, str | bool] = {}
    if period is not None:
        if period.from_ is not None:
            params["from"] = period.from_.isoformat()
        if period.to is not None:
            params["to"] = period.to.isoformat()
    return params


def _without_feedback_emails(feedback: AdminFeedbackList) -> AdminFeedbackList:
    return AdminFeedbackList(
        items=[item.model_copy(update={"email": None}) for item in feedback.items]
    )


async def _feedback_preview(
    api: AdminAPI, args: AdminFeedbackMarkProcessed
) -> ChangeDetails:
    feedback = await api.request(AdminFeedbackList, Method.GET, FEEDBACK_PATH)
    items = {item.id: item for item in feedback.items}
    if any(identifier not in items for identifier in args.ids):
        raise ToolError(
            "One or more selected feedback messages are missing in this contour."
        )
    return ChangeDetails(
        changes={
            "messages": [
                items[identifier].model_dump(mode="json", exclude={"email"})
                for identifier in args.ids
            ],
            "processed": True,
        },
        count=len(args.ids),
    )


def _preseeded_path(language: Language) -> str:
    return f"admin/preseeded-notes/{language.value}"


def _ordered_changes(
    before: Sequence[BaseModel], after: Sequence[BaseModel]
) -> list[JsonValue]:
    matcher = SequenceMatcher(
        a=[entry.model_dump_json() for entry in before],
        b=[entry.model_dump_json() for entry in after],
        autojunk=False,
    )
    changes: list[JsonValue] = []
    for (
        operation,
        start_before,
        end_before,
        start_after,
        end_after,
    ) in matcher.get_opcodes():
        if operation == "equal":
            continue
        changes.append(
            {
                "position_before": start_before + 1,
                "position_after": start_after + 1,
                "before": [
                    item.model_dump(mode="json")
                    for item in before[start_before:end_before]
                ],
                "after": [
                    item.model_dump(mode="json")
                    for item in after[start_after:end_after]
                ],
            }
        )
    return changes


def _folder_change_count(
    before: Sequence[AdminPreseededFolder], after: Sequence[AdminPreseededFolder]
) -> int:
    previous = {folder.key: folder for folder in before}
    proposed = {folder.key: folder for folder in after}
    changed = {
        key
        for key in previous.keys() | proposed.keys()
        if previous.get(key) != proposed.get(key)
    }
    previous_common = [key for key in previous if key in proposed]
    proposed_common = [key for key in proposed if key in previous]
    changed.update(
        key
        for key, new_key in zip(previous_common, proposed_common, strict=True)
        if key != new_key
    )
    return len(changed)


def _shared_order(rows: Sequence[str], shared: Counter[str]) -> list[str]:
    remaining = shared.copy()
    order: list[str] = []
    for row in rows:
        if remaining[row]:
            remaining[row] -= 1
            order.append(row)
    return order


def _note_change_count(
    before: Sequence[AdminPreseededNote], after: Sequence[AdminPreseededNote]
) -> int:
    previous = [note.model_dump_json() for note in before]
    proposed = [note.model_dump_json() for note in after]
    previous_counts, proposed_counts = Counter(previous), Counter(proposed)
    shared = previous_counts & proposed_counts
    replaced_rows = len(previous) + len(proposed) - 2 * shared.total()
    reordered = sum(
        left != right
        for left, right in zip(
            _shared_order(previous, shared),
            _shared_order(proposed, shared),
            strict=True,
        )
    )

    # A repeated folder and title cannot identify which note was edited.
    previous_keys = Counter((note.folder, note.title) for note in before)
    proposed_keys = Counter((note.folder, note.title) for note in after)
    previous_by_key = {(note.folder, note.title): note for note in before}
    proposed_by_key = {(note.folder, note.title): note for note in after}
    edits = sum(
        previous_by_key[key] != proposed_by_key[key]
        for key in previous_keys.keys() & proposed_keys.keys()
        if previous_keys[key] == proposed_keys[key] == 1
    )
    return replaced_rows + reordered - edits


async def _preseeded_preview(
    api: AdminAPI, language: Language, args: AdminPreseededNotesSetReplace
) -> ChangeDetails:
    current = await api.request(
        AdminPreseededNotesSet, Method.GET, _preseeded_path(language)
    )
    folder_changes = _ordered_changes(current.folders, args.folders)
    note_changes = _ordered_changes(current.notes, args.notes)
    other_language = Language.EN if language == Language.RU else Language.RU
    # spec:impl admin-content-and-access#remind-administrator-other-language
    reminder = (
        f"Review the {other_language.value.upper()} version of the preseeded notes as well."
        if note_changes
        else None
    )
    return ChangeDetails(
        changes={
            "language": language.value,
            "version_before": current.version,
            "version_after": current.version + 1,
            "folders": folder_changes,
            "notes": note_changes,
        },
        count=max(
            1,
            _folder_change_count(current.folders, args.folders)
            + _note_change_count(current.notes, args.notes),
        ),
        reminder=reminder,
        base_version=current.version,
    )


async def _change[Result: BaseModel](
    assistant: AdminAssistant,
    result: type[Result],
    request: ChangeRequest,
    approval: Approval,
    preview: ChangeDetails | Callable[[], Awaitable[ChangeDetails]],
) -> ChangePreview | CountConfirmation | Result:
    if not approval.confirmed:
        if approval.confirmation_id is not None or approval.confirmed_count is not None:
            raise ToolError("Request a preview without a confirmation ID or count.")
        details = preview if isinstance(preview, ChangeDetails) else await preview()
        return assistant.confirmations.preview(request, details)

    accepted = assistant.confirmations.accept(request, approval)
    if isinstance(accepted, CountConfirmation):
        return accepted
    if accepted.base_version is not None:
        return await assistant.api.request(
            result,
            request.method,
            request.path,
            body=request.body,
            params={"expected_version": str(accepted.base_version)},
            conflict="The preseeded notes changed. Request and confirm a new preview.",
        )
    return await assistant.api.request(
        result, request.method, request.path, body=request.body
    )


# spec:impl admin-ai-assistant#limit-assistant-fixed-set-actions
# spec:impl admin-ai-assistant#include-action-reads-users-notes
# spec:impl admin-ai-assistant#include-action-reads-sign-in-codes
# spec:impl admin-ai-assistant#provide-way-sign-user-account
def register_tools(mcp: MCPServer) -> None:
    @mcp.tool(annotations=READ_TOOL)
    async def lookup_account(
        ctx: Context[AdminAssistant], email: Email
    ) -> AdminAccountLookup:
        """Look up the permitted account details by its sign-in email in this contour."""
        return await ctx.request_context.lifespan_context.api.request(
            AdminAccountLookup,
            Method.GET,
            "admin/accounts/lookup",
            params={"email": email},
            not_found="No account in this contour has that email.",
        )

    @mcp.tool(annotations=CHANGE_TOOL)
    async def grant_subscription(
        ctx: Context[AdminAssistant],
        account_id: UUID,
        args: AdminSubscriptionGrant,
        confirmed: Confirmed = False,
        confirmation_id: UUID | None = None,
        confirmed_count: ConfirmationCount | None = None,
    ) -> ChangePreview | CountConfirmation | AdminGrantedSubscription:
        """Preview or confirm access for the looked-up account until the named date."""
        return await _change(
            ctx.request_context.lifespan_context,
            AdminGrantedSubscription,
            ChangeRequest(
                AdminAction.GRANT_SUBSCRIPTION,
                Method.PUT,
                f"admin/accounts/{account_id}/subscription",
                args,
            ),
            Approval(confirmed, confirmation_id, confirmed_count),
            ChangeDetails(
                changes={"account_id": str(account_id), "until": args.until.isoformat()}
            ),
        )

    @mcp.tool(annotations=READ_TOOL)
    async def list_feedback(
        ctx: Context[AdminAssistant],
        period: AdminPeriod | None = None,
        new_only: StrictBool = False,
        include_email: StrictBool = False,
    ) -> AdminFeedbackList:
        """List feedback in this contour. Include author emails only on explicit request."""
        feedback = await ctx.request_context.lifespan_context.api.request(
            AdminFeedbackList,
            Method.GET,
            FEEDBACK_PATH,
            params={
                **_period_params(period),
                "new_only": new_only,
                "include_email": include_email,
            },
        )
        # spec:impl admin-feedback-stats#show-account-email-feedback-author
        return feedback if include_email else _without_feedback_emails(feedback)

    @mcp.tool(annotations=CHANGE_TOOL)
    async def mark_feedback_processed(
        ctx: Context[AdminAssistant],
        args: AdminFeedbackMarkProcessed,
        confirmed: Confirmed = False,
        confirmation_id: UUID | None = None,
        confirmed_count: ConfirmationCount | None = None,
    ) -> ChangePreview | CountConfirmation | AdminFeedbackList:
        """Preview or confirm marking the exact listed feedback messages as processed."""
        assistant = ctx.request_context.lifespan_context
        response = await _change(
            assistant,
            AdminFeedbackList,
            ChangeRequest(
                AdminAction.MARK_FEEDBACK_PROCESSED,
                Method.POST,
                f"{FEEDBACK_PATH}/mark-processed",
                args,
            ),
            Approval(confirmed, confirmation_id, confirmed_count),
            partial(_feedback_preview, assistant.api, args),
        )
        return (
            _without_feedback_emails(response)
            if isinstance(response, AdminFeedbackList)
            else response
        )

    @mcp.tool(annotations=READ_TOOL)
    async def list_journal(
        ctx: Context[AdminAssistant], period: AdminPeriod | None = None
    ) -> AdminJournalList:
        """Show the administrative journal for the selected period in this contour."""
        # spec:impl admin-ai-assistant#show-journal-key-contour-administrator
        return await ctx.request_context.lifespan_context.api.request(
            AdminJournalList, Method.GET, "admin/journal", params=_period_params(period)
        )

    @mcp.tool(annotations=CHANGE_TOOL)
    async def upload_legal_document_version(
        ctx: Context[AdminAssistant],
        document: LegalDocumentKind,
        args: AdminLegalDocumentVersionCreate,
        confirmed: Confirmed = False,
        confirmation_id: UUID | None = None,
        confirmed_count: ConfirmationCount | None = None,
    ) -> ChangePreview | CountConfirmation | AdminLegalDocumentVersion:
        """Preview or confirm publishing the submitted Russian and English legal texts."""
        return await _change(
            ctx.request_context.lifespan_context,
            AdminLegalDocumentVersion,
            ChangeRequest(
                AdminAction.UPLOAD_LEGAL_DOCUMENT_VERSION,
                Method.POST,
                f"admin/legal-documents/{document.value}/versions",
                args,
            ),
            Approval(confirmed, confirmation_id, confirmed_count),
            ChangeDetails(
                changes={
                    "document": document.value,
                    "text_ru": args.text_ru,
                    "text_en": args.text_en,
                }
            ),
        )

    @mcp.tool(annotations=READ_TOOL)
    async def get_preseeded_notes(
        ctx: Context[AdminAssistant], language: Language
    ) -> AdminPreseededNotesSet:
        """Read the current set of preseeded notes and folders for one language."""
        return await ctx.request_context.lifespan_context.api.request(
            AdminPreseededNotesSet, Method.GET, _preseeded_path(language)
        )

    @mcp.tool(annotations=CHANGE_TOOL)
    async def replace_preseeded_notes(
        ctx: Context[AdminAssistant],
        language: Language,
        args: AdminPreseededNotesSetReplace,
        confirmed: Confirmed = False,
        confirmation_id: UUID | None = None,
        confirmed_count: ConfirmationCount | None = None,
    ) -> ChangePreview | CountConfirmation | AdminPreseededNotesSet:
        """Preview or confirm replacing the ordered set for one language."""
        assistant = ctx.request_context.lifespan_context
        return await _change(
            assistant,
            AdminPreseededNotesSet,
            ChangeRequest(
                AdminAction.REPLACE_PRESEEDED_NOTES,
                Method.PUT,
                _preseeded_path(language),
                args,
            ),
            Approval(confirmed, confirmation_id, confirmed_count),
            partial(_preseeded_preview, assistant.api, language, args),
        )

    @mcp.tool(annotations=READ_TOOL)
    async def list_reserved_login_words(
        ctx: Context[AdminAssistant],
    ) -> AdminReservedLoginWordList:
        """List the reserved login words of this contour."""
        return await ctx.request_context.lifespan_context.api.request(
            AdminReservedLoginWordList, Method.GET, RESERVED_WORDS_PATH
        )

    @mcp.tool(annotations=CHANGE_TOOL)
    async def add_reserved_login_word(
        ctx: Context[AdminAssistant],
        args: AdminReservedLoginWordCreate,
        confirmed: Confirmed = False,
        confirmation_id: UUID | None = None,
        confirmed_count: ConfirmationCount | None = None,
    ) -> ChangePreview | CountConfirmation | AdminReservedLoginWordList:
        """Preview or confirm reserving one word for future logins in this contour."""
        return await _change(
            ctx.request_context.lifespan_context,
            AdminReservedLoginWordList,
            ChangeRequest(
                AdminAction.ADD_RESERVED_LOGIN_WORD,
                Method.POST,
                RESERVED_WORDS_PATH,
                args,
            ),
            Approval(confirmed, confirmation_id, confirmed_count),
            ChangeDetails(changes={"word": args.word}),
        )

    @mcp.tool(annotations=READ_TOOL)
    async def get_statistics(
        ctx: Context[AdminAssistant], period: AdminPeriod | None = None
    ) -> AdminStatistics:
        """Read anonymized aggregate statistics in this contour for the selected period."""
        return await ctx.request_context.lifespan_context.api.request(
            AdminStatistics,
            Method.GET,
            "admin/statistics",
            params=_period_params(period),
        )
