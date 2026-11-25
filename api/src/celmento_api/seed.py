from argparse import ArgumentParser
from asyncio import run
from dataclasses import dataclass
from pathlib import Path
from re import MULTILINE, search

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from celmento_api.contour import current_contour
from celmento_api.db import engine, session_factory
from celmento_api.models.account import ReservedLoginWord
from celmento_api.models.enums import Contour, Language, LegalDocumentKind
from celmento_api.models.legal import LegalDocumentVersion

DOCUMENTS: Path = Path(__file__).resolve().parent / "content" / "legal"
BUILTIN_RESERVED_WORDS: tuple[str, ...] = (
    "meet",
    "about",
    "api",
    "admin",
    "login",
    "app",
    "help",
    "register",
    "settings",
    "support",
)


@dataclass(frozen=True, slots=True)
class DocumentText:
    title: str
    version: str
    text: str


def _filter_contour(source: str, contour: Contour) -> str:
    result: list[str] = []
    active_contour: Contour | None = None
    for line in source.splitlines(keepends=True):
        stripped = line.strip()
        if stripped.startswith("<!-- contour: ") and stripped.endswith(" -->"):
            if active_contour is not None:
                raise ValueError("Unexpected nested legal document contour block")
            active_contour = Contour(stripped[14:-4])
        elif stripped == "<!-- /contour -->":
            if active_contour is None:
                raise ValueError("Unexpected closing legal document contour block")
            active_contour = None
        elif active_contour is None or active_contour == contour:
            result.append(line)
    if active_contour is not None:
        raise ValueError("Missing closing legal document contour block")
    return "".join(result)


def _read_document(
    kind: LegalDocumentKind, language: Language, contour: Contour
) -> DocumentText:
    filename = f"{kind.value.replace('_', '-')}.{language.value}.md"
    text = _filter_contour((DOCUMENTS / filename).read_text(encoding="utf-8"), contour)
    title, _, _ = text.partition("\n")
    version = search(r"^(?:Версия|Version) ([0-9.]+-draft)\b", text, flags=MULTILINE)
    if not title.startswith("# ") or version is None:
        raise ValueError(f"Missing title or draft version in {filename}")
    return DocumentText(
        title=title.removeprefix("# "), version=version.group(1), text=text
    )


async def seed(session: AsyncSession, *, draft_documents: bool = False) -> None:
    reserved = insert(ReservedLoginWord).values(
        [
            {"reserved_login_word_id": word, "source": "builtin"}
            for word in BUILTIN_RESERVED_WORDS
        ]
    )
    await session.execute(reserved.on_conflict_do_nothing())
    if draft_documents:
        contour = current_contour()
        # spec:impl legal-documents#provide-five-read-only-documents
        for kind in LegalDocumentKind:
            ru = _read_document(kind, Language.RU, contour)
            en = _read_document(kind, Language.EN, contour)
            if ru.version != en.version:
                raise ValueError(f"Draft versions differ for {kind.value}")
            document = insert(LegalDocumentVersion).values(
                document=kind.value,
                version=ru.version,
                title_ru=ru.title,
                title_en=en.title,
                text_ru=ru.text,
                text_en=en.text,
            )
            await session.execute(document.on_conflict_do_nothing())
    await session.commit()


async def _run_seed(draft_documents: bool) -> None:
    try:
        async with session_factory() as session:
            await seed(session, draft_documents=draft_documents)
    finally:
        await engine.dispose()


def main() -> None:
    parser = ArgumentParser(description="Seed the deployed database.")
    parser.add_argument(
        "--draft-documents",
        action="store_true",
        help="Load draft documents for development.",
    )
    draft_documents: object = parser.parse_args().draft_documents
    run(_run_seed(draft_documents is True))


if __name__ == "__main__":
    main()
