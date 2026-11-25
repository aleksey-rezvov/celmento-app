export function cents(amount: string): bigint {
  const negative = amount.startsWith("-");
  const [units = "0", digits = ""] = (negative ? amount.slice(1) : amount).split(".");
  const value = BigInt(units) * 100n + BigInt(digits.padEnd(2, "0"));
  return negative ? -value : value;
}

export function decimalAmount(amount: bigint): string {
  const sign = amount < 0n ? "-" : "";
  const absolute = amount < 0n ? -amount : amount;
  const fraction = absolute % 100n;
  return sign + absolute / 100n + (fraction === 0n ? "" : "." + String(fraction).padStart(2, "0"));
}

export function accountDate(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);

  return ["year", "month", "day"]
    .map((type) => parts.find((part) => part.type === type)?.value)
    .join("-");
}
