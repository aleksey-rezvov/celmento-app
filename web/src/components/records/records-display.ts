import type { Schemas } from "@/lib/api/client";
import { formatSessionCount } from "@/lib/format";
import type { Language, MessageKey } from "@/lib/i18n/messages";

export const recordsPath = "/app/records";
export const operationsPath = recordsPath + "/operations";
export const hoursPath = recordsPath + "/hours";
export const hoursExportPath = hoursPath + "/export";
export const balancesPath = recordsPath + "/balances";

export const operationLabels = {
  all: "feed.all",
  income: "acc.income",
  receipts: "acc.receipts",
  expenses: "acc.expenses",
} as const satisfies Record<Schemas["RecordsOperationFilter"], MessageKey>;

export const logLabels = {
  practice: "hours.practice",
  supervision: "hours.supervision",
  therapy: "hours.therapy",
  training: "hours.training",
} as const satisfies Record<Schemas["RecordsHoursLogType"], MessageKey>;

export function formatRecordsHours(hours: number, language: Language): string {
  return formatSessionCount(hours.toFixed(2), language);
}

export function recordsMeetingPath(meetingId: string): string {
  return "/app/meetings/" + encodeURIComponent(meetingId);
}
