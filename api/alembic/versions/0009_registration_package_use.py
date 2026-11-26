"""Record a registration package's immutable contour choice and successful use."""

import sqlalchemy as sa

from alembic import op

revision: str = "0009"
down_revision: str = "0008"
branch_labels: tuple[str, ...] | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "registration_package_use",
        sa.Column(
            "registration_package_use_id",
            sa.Uuid(),
            server_default=sa.text("uuidv7()"),
            primary_key=True,
        ),
        sa.Column("package_digest", sa.Text(), nullable=False, unique=True),
        sa.Column("selected_contour", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "package_digest ~ '^[0-9a-f]{64}$'",
            name="registration_package_use_digest_valid",
        ),
        sa.CheckConstraint(
            "selected_contour IN ('ru', 'world')",
            name="registration_package_use_contour_known",
        ),
    )
    op.create_index(
        "ix_registration_package_use_expires_at",
        "registration_package_use",
        ["expires_at"],
    )


def downgrade() -> None:
    op.drop_table("registration_package_use")
