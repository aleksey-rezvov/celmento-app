import { expect, test } from "vitest";
import { formatDate, formatMoney, formatMoneyLine, formatTime, zoneLabel } from "./format";

// spec:test interface-language#locale-formats
test("formats the local date, 24-hour time, and exact amounts in both languages", () => {
  const instant = "2026-06-10T22:05:00.000Z";
  const timeZone = "Europe/Belgrade";

  expect(formatDate(instant, timeZone, "ru")).toBe("11 июня");
  expect(formatDate(instant, timeZone, "en")).toBe("11 June");
  expect(formatTime(instant, timeZone, "ru")).toBe("00:05");
  expect(formatTime(instant, timeZone, "en")).toBe("00:05");

  expect(formatMoney({ amount: "-12345.6", currency: "EUR" }, "ru")).toBe("−12 345,60 €");
  expect(formatMoney({ amount: "-12345.6", currency: "EUR" }, "en")).toBe("−12 345.60 €");
  expect(formatMoney({ amount: "-0000.0000", currency: "RUB" }, "ru")).toBe("0 ₽");
  expect(formatMoney({ amount: "900719925474099.99", currency: "USD" }, "en")).toBe(
    "900 719 925 474 099.99 $",
  );
  expect(
    formatMoneyLine(
      [
        { amount: "120000", currency: "RUB" },
        { amount: "800.00", currency: "EUR" },
      ],
      "ru",
    ),
  ).toBe("120 000 ₽ · 800 €");
});

// spec:test time-zone-handling#zone-label-city-offset
test("labels cities with the UTC offset at the specified date", () => {
  const winter = new Date("2026-01-15T12:00:00.000Z");
  const summer = new Date("2026-07-15T12:00:00.000Z");

  expect(zoneLabel("Europe/Belgrade", winter, "en")).toBe("Belgrade (UTC+1)");
  expect(zoneLabel("Europe/Belgrade", summer, "ru")).toBe("Белград (UTC+2)");
  expect(zoneLabel("Asia/Kathmandu", summer, "en")).toBe("Kathmandu (UTC+5:45)");
});
