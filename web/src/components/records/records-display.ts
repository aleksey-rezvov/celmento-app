import type { Schemas } from "@/lib/api/client";
import type { Language, MessageKey } from "@/lib/i18n/messages";

export const recordsPath = "/app/records";
export const operationsPath = recordsPath + "/operations";
export const hoursPath = recordsPath + "/hours";
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
  return new Intl.NumberFormat(language === "ru" ? "ru-RU" : "en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(hours);
}

export function recordsMeetingPath(meetingId: string): string {
  return "/app/meetings/" + encodeURIComponent(meetingId);
}
