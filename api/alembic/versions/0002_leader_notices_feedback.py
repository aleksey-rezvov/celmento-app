"""Create editable leader profiles, working days, notices and feedback."""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0002"
down_revision: str = "0001"
branch_labels: tuple[str, ...] | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "leader_profile",
        sa.Column(
            "account_id",
            sa.Uuid(),
            sa.ForeignKey("account.account_id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "specializations",
            postgresql.ARRAY(sa.Text()),
            server_default=sa.text("'{}'::text[]"),
            nullable=False,
        ),
        sa.Column("specialization_other", sa.Text()),
        sa.Column("about", sa.Text(), server_default=sa.text("''"), nullable=False),
        sa.Column("contact_email", sa.Text()),
        sa.Column(
            "links",
            postgresql.ARRAY(sa.Text()),
            server_default=sa.text("'{}'::text[]"),
            nullable=False,
        ),
        sa.Column("main_channel", sa.Text()),
        sa.Column("session_duration_minutes", sa.Integer()),
        sa.Column("session_format", sa.Text()),
        sa.Column("default_meeting_link", sa.Text()),
        sa.Column("default_rate", sa.Numeric(19, 4)),
        sa.Column("default_currency", sa.Text()),
        sa.Column("preseeded_notes_version", sa.Integer()),
        sa.CheckConstraint(
            "specializations <@ ARRAY['coach', 'psychologist', 'psychotherapist', "
            "'psychoanalyst', 'consultant', 'mentor', 'other']::text[]",
            name="leader_profile_specializations_known",
        ),
        sa.CheckConstraint("length(about) <= 1000", name="leader_profile_about_length"),
        sa.CheckConstraint(
            "cardinality(links) <= 5", name="leader_profile_maximum_links"
        ),
        sa.CheckConstraint(
            "main_channel IN ('phone', 'telegram', 'whatsapp', 'email')",
            name="leader_profile_main_channel_known",
        ),
        sa.CheckConstraint(
            "session_duration_minutes IN (15, 30, 45, 60, 75, 90)",
            name="leader_profile_session_duration_known",
        ),
        sa.CheckConstraint(
            "session_format IN ('online', 'in_person', 'both')",
            name="leader_profile_session_format_known",
        ),
        sa.CheckConstraint(
            "default_rate >= 0 AND default_rate < 'Infinity'::numeric",
            name="leader_profile_default_rate_valid",
        ),
        sa.CheckConstraint(
            "default_currency IN ('RUB', 'EUR', 'USD')",
            name="leader_profile_default_currency_known",
        ),
    )
    op.create_table(
        "working_day",
        sa.Column(
            "account_id",
            sa.Uuid(),
            sa.ForeignKey("leader_profile.account_id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("weekday", sa.Text(), primary_key=True),
        sa.Column("working", sa.Boolean(), nullable=False),
        sa.Column("start_time", sa.Time(), nullable=False),
        sa.Column("end_time", sa.Time(), nullable=False),
        sa.CheckConstraint(
            "weekday IN ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')",
            name="working_day_weekday_known",
        ),
        sa.CheckConstraint(
            "NOT working OR end_time > start_time", name="working_day_order"
        ),
        sa.CheckConstraint(
            "extract(minute FROM start_time) % 15 = 0 "
            "AND extract(second FROM start_time) = 0 "
            "AND extract(hour FROM start_time) < 24 "
            "AND extract(minute FROM end_time) % 15 = 0 "
            "AND extract(second FROM end_time) = 0 "
            "AND extract(hour FROM end_time) < 24",
            name="working_day_quarter_hours",
        ),
    )
    op.execute(
        """
        INSERT INTO leader_profile (account_id, contact_email)
        SELECT account_id, email FROM account WHERE activated_at IS NOT NULL
        """
    )
    op.create_table(
        "notice",
        sa.Column(
            "notice_id", sa.Uuid(), server_default=sa.text("uuidv7()"), primary_key=True
        ),
        sa.Column(
            "account_id",
            sa.Uuid(),
            sa.ForeignKey("account.account_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("tab", sa.Text(), nullable=False),
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column(
            "params",
            postgresql.JSONB(),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("dismissed_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint(
            "tab IN ('people', 'meetings', 'profile')", name="notice_tab_known"
        ),
        sa.CheckConstraint(
            "key IN ('notify.limit_new_client', 'notify.archived_client_tried', "
            "'notify.invite_registered', 'client.linked_notice', "
            "'notify.rescheduled', 'notify.cancelled', 'admin.access_granted')",
            name="notice_key_known",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(params) = 'object'", name="notice_params_object"
        ),
    )
    op.create_index("ix_notice_account_id", "notice", ["account_id"])
    op.create_table(
        "feedback_message",
        sa.Column(
            "feedback_message_id",
            sa.Uuid(),
            server_default=sa.text("uuidv7()"),
            primary_key=True,
        ),
        sa.Column(
            "account_id",
            sa.Uuid(),
            sa.ForeignKey("account.account_id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("activated", sa.Boolean(), nullable=False),
        sa.Column("screen", sa.Text(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("processed_at", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("screen = 'profile'", name="feedback_message_screen_known"),
        sa.CheckConstraint(
            "length(text) BETWEEN 1 AND 5000", name="feedback_message_text_length"
        ),
    )
    op.create_index(
        "ix_feedback_message_account_id", "feedback_message", ["account_id"]
    )


def downgrade() -> None:
    op.drop_table("feedback_message")
    op.drop_table("notice")
    op.drop_table("working_day")
    op.drop_table("leader_profile")
