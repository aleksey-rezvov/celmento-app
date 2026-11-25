from collections import defaultdict, deque
from difflib import SequenceMatcher
from re import Pattern
from re import compile as compile_pattern
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from celmento_api.errors import AppError
from celmento_api.models.enums import ErrorCode
from celmento_api.models.note import Note, NoteChecklistTick

CHECKLIST_LINE: Pattern[str] = compile_pattern(r"^[ \t]*-[ \t]+\[[ xX]\][ \t]+(.*)$")


def _checklist_lines(lines: list[str]) -> dict[int, str]:
    labels: dict[int, str] = {}
    for line_number, line in enumerate(lines):
        match = CHECKLIST_LINE.fullmatch(line)
        if match is not None:
            labels[line_number] = match.group(1).strip()
    return labels


def _matching_checklist_positions(
    old_lines: list[str], new_lines: list[str]
) -> dict[int, int]:
    old_labels = _checklist_lines(old_lines)
    new_labels = _checklist_lines(new_lines)
    old_positions = {line: index for index, line in enumerate(old_labels)}
    new_positions = {line: index for index, line in enumerate(new_labels)}
    old_keys = [
        (index in old_labels, old_labels.get(index, line))
        for index, line in enumerate(old_lines)
    ]
    new_keys = [
        (index in new_labels, new_labels.get(index, line))
        for index, line in enumerate(new_lines)
    ]
    moved: dict[int, int] = {}
    # Unchanged surrounding lines distinguish repeated labels before the fallback.
    for old_start, new_start, size in SequenceMatcher(
        a=old_keys, b=new_keys
    ).get_matching_blocks():
        for offset in range(size):
            old_line, new_line = old_start + offset, new_start + offset
            if old_line in old_positions:
                moved[old_positions[old_line]] = new_positions[new_line]
    matched = set(moved.values())
    remaining: defaultdict[str, deque[int]] = defaultdict(deque)
    for line, position in new_positions.items():
        if position not in matched:
            remaining[new_labels[line]].append(position)
    for line, position in old_positions.items():
        label = old_labels[line]
        if position not in moved and remaining[label]:
            moved[position] = remaining[label].popleft()
    return moved


def _text_lines(text: str) -> list[str]:
    return [line.removesuffix("\r") for line in text.split("\n")]


async def remap_recipient_ticks(
    session: AsyncSession, note: Note, new_text: str
) -> None:
    if note.text == new_text:
        return
    rows = await session.scalars(
        select(NoteChecklistTick).where(NoteChecklistTick.note_id == note.note_id)
    )
    ticks = rows.all()
    if not ticks:
        return
    moved = _matching_checklist_positions(_text_lines(note.text), _text_lines(new_text))
    # spec:impl note-sharing-tags#show-author-changes-tagged-person
    for tick in ticks:
        positions = sorted(moved[item] for item in tick.checked_items if item in moved)
        if positions:
            tick.checked_items = positions
        else:
            await session.delete(tick)


async def replace_recipient_ticks(
    session: AsyncSession,
    note: Note,
    account_id: UUID,
    items: list[int],
    expected_items: list[int],
) -> None:
    size = len(_checklist_lines(_text_lines(note.text)))
    positions = sorted(position for position in items if position < size)
    row = await session.get(NoteChecklistTick, (note.note_id, account_id))
    current = row.checked_items if row is not None else []
    if positions == current:
        return
    if sorted(expected_items) != current:
        raise AppError(409, ErrorCode.CONFLICT)
    # spec:impl note-sharing-tags#let-tagged-person-leader-non-leader
    if row is None:
        session.add(
            NoteChecklistTick(
                note_id=note.note_id, account_id=account_id, checked_items=positions
            )
        )
    elif positions:
        row.checked_items = positions
    else:
        await session.delete(row)
