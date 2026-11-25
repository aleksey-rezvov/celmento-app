import re

import pytest
import yaml

from celmento_api.models.enums import Language
from celmento_api.schemas.notes import PreseededNotesAsset
from celmento_api.services.preseeded_notes import CONTENT


@pytest.fixture(scope="module", params=list(Language))
def note_asset(request: pytest.FixtureRequest) -> PreseededNotesAsset:
    language: object = request.param
    assert isinstance(language, Language)
    filename = CONTENT / f"preseeded-notes.{language.value}.yaml"
    content: object = yaml.safe_load(filename.read_text(encoding="utf-8"))
    return PreseededNotesAsset.model_validate(content)


def test_preseeded_notes_demonstrate_the_editor(
    note_asset: PreseededNotesAsset,
) -> None:
    guide, session, _, checklist, _, _, _ = note_asset.notes
    russian = note_asset.language == Language.RU
    guide_topics = (
        (
            "Папки",
            "Чек-листы",
            "Отметить клиента",
            "Ответ на заметку",
            "Отправить текстом",
        )
        if russian
        else (
            "Folders",
            "Checklists",
            "Tag a client",
            "Reply to a note",
            "Send as text",
        )
    )
    topics = re.findall(r"(?m)^\d+\. \*\*(.+?)\.\*\*", guide.text)
    # spec:test preseeded-notes#write-how-use-notes-5-7-short
    assert 5 <= len(topics) <= 7 and set(guide_topics).issubset(topics)

    # spec:test preseeded-notes#structure-session-protocol-sections
    assert re.findall(r"(?m)^## (.+)$", session.text) == (
        [
            "Запрос клиента",
            "Ключевые моменты",
            "Инсайты",
            "Договорённости",
            "Домашнее задание",
            "Мои наблюдения",
        ]
        if russian
        else [
            "Client's request",
            "Key moments",
            "Insights",
            "Agreements",
            "Homework",
            "My observations",
        ]
    )

    entries = re.findall(r"(?m)^- \[([ x])\] (.+)$", checklist.text)
    authors_and_films = (
        (
            "Уитмор",
            "Ялом",
            "Мак-Вильямс",
            "Роджерс",
            "Франкл",
            "Умница Уилл Хантинг",
            "Король говорит",
        )
        if russian
        else (
            "Whitmore",
            "Yalom",
            "McWilliams",
            "Rogers",
            "Frankl",
            "Good Will Hunting",
            "The King's Speech",
        )
    )
    # spec:test preseeded-notes#make-books-films-checklist-7-titles
    assert [mark for mark, _ in entries] == ["x", "x", " ", " ", " ", " ", " "]
    assert all(
        title in line
        for (_, line), title in zip(entries, authors_and_films, strict=True)
    )


def test_preseeded_notes_include_links_and_affirmations(
    note_asset: PreseededNotesAsset,
) -> None:
    _, _, ethics, _, libraries, _, affirmations = note_asset.notes
    link_lines = r"(?m)^- \[[^\]]+\]\(https://([^/]+)/[^)]*\) — [^\n]+$"
    # spec:test preseeded-notes#write-ethical-codes-links-icf
    assert set(re.findall(link_lines, ethics.text)) == {
        "coachingfederation.org",
        "procoach.ru",
        "psyrus.ru",
        "www.globalcodeofethics.org",
        "www.associationforcoaching.com",
        "eurocoach.eu",
    }
    # spec:test preseeded-notes#list-libraries-digital-libraries
    assert set(re.findall(link_lines, libraries.text)) == {
        "www.elibrary.ru",
        "www.koob.ru",
        "urait.ru",
        "www.iprbookshop.ru",
        "biblioclub.ru",
    }
    tagline = (
        "Выбирайте ту, что откликается сегодня."
        if note_asset.language == Language.RU
        else "Pick the one that speaks to you today."
    )
    lines = re.findall(r"(?m)^- (.+)$", affirmations.text)
    # spec:test preseeded-notes#include-10-15-affirmations-original
    assert affirmations.text.startswith(tagline + "\n")
    assert 10 <= len(lines) == len(set(lines)) <= 15
