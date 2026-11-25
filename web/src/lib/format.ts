import type { Schemas } from "./api/client";
import { t, type MessageKey } from "./i18n/messages";

type Language = Schemas["Language"];
type Money = Schemas["Money"];

const locales: Record<Language, string> = { en: "en-GB", ru: "ru-RU" };
const currencySymbols: Record<Schemas["Currency"], string> = { RUB: "₽", EUR: "€", USD: "$" };
const russianCityNames: Readonly<Partial<Record<string, string>>> = {
  "Europe/Belgrade": "Белград",
  "Europe/Moscow": "Москва",
};

export function formatTime(instant: string, timeZone: string, language: Language): string {
  // spec:impl interface-language#locale-formats
  return new Intl.DateTimeFormat(locales[language], {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(instant));
}

export function formatDate(instant: string, timeZone: string, language: Language): string {
  // spec:impl interface-language#locale-formats
  return new Intl.DateTimeFormat(locales[language], {
    timeZone,
    day: "numeric",
    month: "long",
  }).format(new Date(instant));
}

export function zoneLabel(timeZone: string, at: Date, language: Language): string {
  const offset = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    timeZoneName: "shortOffset",
  })
    .formatToParts(at)
    .find(({ type }) => type === "timeZoneName")
    ?.value.replace("GMT", "UTC");
  // spec:impl time-zone-handling#zone-label-city-offset
  return zoneCity(timeZone, language) + " (" + (offset ?? "UTC") + ")";
}

export function zoneCity(timeZone: string, language: Language): string {
  const ianaCity = (timeZone.split("/").at(-1) ?? timeZone).replaceAll("_", " ");
  return language === "ru" ? (russianCityNames[timeZone] ?? ianaCity) : ianaCity;
}

export function otherPartyHint(
  instant: string,
  ownZone: string,
  otherZone: string | null,
  key: MessageKey,
  language: Language = "en",
): string | null {
  if (!otherZone || ownZone === otherZone) {
    return null;
  }

  const time = formatTime(instant, otherZone, language);
  return t(key, { [language === "ru" ? "время" : "time"]: time }, language);
}

export function formatMoney(money: Money, language: Language): string {
  const [whole = "0", fraction = ""] = money.amount.split(".");
  const units = whole.replace(/^-?0*(?=\d)/u, "");
  const grouped = groupDigits(units);
  const fractionalDigits = fraction.replace(/0+$/u, "");
  const separator = language === "ru" ? "," : ".";
  const sign = whole.startsWith("-") && (units !== "0" || fractionalDigits) ? "−" : "";
  const amount = fractionalDigits ? grouped + separator + fractionalDigits.padEnd(2, "0") : grouped;

  // spec:impl interface-language#locale-formats
  return sign + amount + " " + currencySymbols[money.currency];
}

export function formatMoneyLine(items: readonly Money[], language: Language): string {
  return items.map((money) => formatMoney(money, language)).join(" · ");
}

function groupDigits(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/gu, " ");
}

export function formatSessionCount(value: Schemas["DecimalAmount"], language: Language): string {
  const [whole = "0", fraction] = value.split(".");
  const grouped = groupDigits(whole);
  const separator = language === "ru" ? "," : ".";
  return fraction ? grouped + separator + fraction : grouped;
}
