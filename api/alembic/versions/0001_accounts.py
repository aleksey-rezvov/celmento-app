"""Create accounts, sessions and versioned legal documents."""

import sqlalchemy as sa

from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: tuple[str, ...] | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "account",
        sa.Column(
            "account_id",
            sa.Uuid(),
            server_default=sa.text("uuidv7()"),
            primary_key=True,
        ),
        sa.Column("email", sa.Text(), nullable=False, unique=True),
        sa.Column("first_name", sa.Text(), nullable=False),
        sa.Column("last_name", sa.Text(), nullable=False),
        sa.Column("login", sa.Text(), nullable=False, unique=True),
        sa.Column("language", sa.Text(), nullable=False),
        sa.Column("time_zone", sa.Text(), nullable=False),
        sa.Column("phone", sa.Text()),
        sa.Column("telegram", sa.Text()),
        sa.Column("whatsapp", sa.Text()),
        sa.Column("photo_key", sa.Text()),
        sa.Column("activated_at", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "length(first_name) BETWEEN 1 AND 100", name="account_first_name_length"
        ),
        sa.CheckConstraint(
            "length(last_name) BETWEEN 1 AND 100", name="account_last_name_length"
        ),
    )
    op.create_table(
        "session",
        sa.Column(
            "session_id",
            sa.Uuid(),
            server_default=sa.text("uuidv7()"),
            primary_key=True,
        ),
        sa.Column(
            "account_id",
            sa.Uuid(),
            sa.ForeignKey("account.account_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token_hash", sa.Text(), nullable=False, unique=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_session_account_id", "session", ["account_id"])
    op.create_table(
        "sign_in_ticket",
        sa.Column(
            "sign_in_ticket_id",
            sa.Uuid(),
            server_default=sa.text("uuidv7()"),
            primary_key=True,
        ),
        sa.Column(
            "account_id",
            sa.Uuid(),
            sa.ForeignKey("account.account_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token_hash", sa.Text(), nullable=False, unique=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_sign_in_ticket_account_id", "sign_in_ticket", ["account_id"])
    op.create_table(
        "reserved_login_word",
        sa.Column("reserved_login_word_id", sa.Text(), primary_key=True),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "source IN ('builtin', 'admin')", name="reserved_login_word_source"
        ),
    )
    op.create_table(
        "legal_document_version",
        sa.Column(
            "legal_document_version_id",
            sa.Uuid(),
            server_default=sa.text("uuidv7()"),
            primary_key=True,
        ),
        sa.Column("document", sa.Text(), nullable=False),
        sa.Column("version", sa.Text(), nullable=False),
        sa.Column("title_ru", sa.Text(), nullable=False),
        sa.Column("title_en", sa.Text(), nullable=False),
        sa.Column("text_ru", sa.Text(), nullable=False),
        sa.Column("text_en", sa.Text(), nullable=False),
        sa.Column(
            "uploaded_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "document", "version", name="legal_document_version_document_version_key"
        ),
    )
    op.create_index(
        "legal_document_version_document_uploaded_at_idx",
        "legal_document_version",
        ["document", "uploaded_at"],
    )
    op.create_table(
        "acceptance",
        sa.Column(
            "acceptance_id",
            sa.Uuid(),
            server_default=sa.text("uuidv7()"),
            primary_key=True,
        ),
        sa.Column(
            "account_id",
            sa.Uuid(),
            sa.ForeignKey("account.account_id", ondelete="RESTRICT"),
        ),
        sa.Column("meeting_id", sa.Uuid()),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("version", sa.Text()),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "(account_id IS NULL) <> (meeting_id IS NULL)",
            name="acceptance_has_one_subject",
        ),
        sa.CheckConstraint(
            "(kind = 'age_confirmation') = (version IS NULL)",
            name="acceptance_requires_document_version",
        ),
    )
    op.create_index("ix_acceptance_account_id", "acceptance", ["account_id"])
    op.create_index("ix_acceptance_meeting_id", "acceptance", ["meeting_id"])


def downgrade() -> None:
    op.drop_table("acceptance")
    op.drop_table("legal_document_version")
    op.drop_table("reserved_login_word")
    op.drop_table("sign_in_ticket")
    op.drop_table("session")
    op.drop_table("account")
