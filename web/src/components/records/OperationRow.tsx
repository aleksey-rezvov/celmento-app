import Link from "next/link";
import type { ReactElement } from "react";
import { ClientAvatar } from "@/components/clients/ClientAvatar";
import { clientPath } from "@/components/clients/card/ClientCardScreen";
import type { Schemas } from "@/lib/api/client";
import { formatMoney } from "@/lib/format";
import { useLanguage, useTranslation } from "@/lib/i18n";
import { meetingTitle } from "@/lib/meeting-display";
import { recordsDate } from "@/lib/records-period";
import { recordsMeetingPath } from "./records-display";

interface OperationRowProps {
  operation: Schemas["RecordsOperation"];
}

export function OperationRow({ operation }: OperationRowProps): ReactElement {
  const language = useLanguage();
  const t = useTranslation();
  const date = recordsDate(operation.date, language);
  const client = operation.client;
  const expense = operation.kind === "service_expense";
  const amount = formatMoney(operation.amount, language).replace(/^−/u, "");
  const label = client
    ? client.name
    : operation.meeting_type
      ? meetingTitle({ type: operation.meeting_type, client, with_whom: operation.with_whom }, t)
      : t("acc.expenses");

  const dateParams = { date, дата: date };
  let annotation: string | null = null;
  switch (operation.kind) {
    case "session_charge":
      annotation = t("op.session", dateParams);
      break;
    case "missed_charge":
      annotation = t("op.missed", dateParams);
      break;
    case "payment":
      annotation = t("op.payment");
      break;
  }

  // spec:impl money-operations-feed#open-meeting-card-meeting-row
  const href = operation.meeting_id
    ? recordsMeetingPath(operation.meeting_id)
    : client
      ? clientPath(client.id) + "/balance"
      : null;

  // spec:impl money-operations-feed#show-row-amount-sign-operation
  // spec:impl money-operations-feed#color-income-receipts-rows-green
  const content = (
    <>
      <span className="records-operation-amount" data-expense={expense}>
        {expense ? "− " : "+ "}
        {amount}
      </span>
      <div className="records-row-description">
        <span>{label}</span>
        <div className="records-row-meta">
          {!expense && operation.kind !== "payment" ? (
            <time dateTime={operation.date}>{annotation}</time>
          ) : (
            <>
              {annotation && <span>{annotation} · </span>}
              <time dateTime={operation.date}>{date}</time>
            </>
          )}
        </div>
      </div>
      {client && (
        <ClientAvatar
          clientId={client.id}
          name={client.name}
          photoUrl={client.photo_url}
          size={34}
        />
      )}
      {href && (
        <span className="records-row-chevron" aria-hidden="true">
          ›
        </span>
      )}
    </>
  );

  return (
    <li>
      {href ? (
        <Link className="records-list-row" href={href}>
          {content}
        </Link>
      ) : (
        <div className="records-list-row">{content}</div>
      )}
    </li>
  );
}
