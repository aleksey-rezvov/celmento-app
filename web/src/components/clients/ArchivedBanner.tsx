import type { ReactElement } from "react";
import { useAccount } from "@/lib/account";
import { formatDate } from "@/lib/format";
import { useTranslation } from "@/lib/i18n";

export function ArchivedBanner({ archivedAt }: { archivedAt: string }): ReactElement {
  const { account } = useAccount();
  const t = useTranslation();
  const date = formatDate(archivedAt, account.time_zone, account.language);

  return <p className="client-archived">{t("client.archived_banner", { date, дата: date })}</p>;
}
