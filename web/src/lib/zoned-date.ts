const zonedFormatters = new Map<string, Intl.DateTimeFormat>();
const hour = 3_600_000;

function wallTime(instant: Date | string, timeZone: string): string {
  let format = zonedFormatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      calendar: "iso8601",
      numberingSystem: "latn",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    zonedFormatters.set(timeZone, format);
  }

  const parts = new Map(
    format
      .formatToParts(typeof instant === "string" ? new Date(instant) : instant)
      .map(({ type, value }) => [type, value]),
  );
  return `${parts.get("year")?.padStart(4, "0")}-${parts.get("month")}-${parts.get("day")}T${parts.get("hour")}:${parts.get("minute")}:${parts.get("second")}`;
}

export function zonedDay(instant: Date | string, timeZone: string): string {
  return wallTime(instant, timeZone).slice(0, 10);
}

export function zonedClock(instant: Date | string, timeZone: string): string {
  return wallTime(instant, timeZone).slice(11, 16);
}

export function zonedInstant(day: string, time: string, timeZone: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(day) || !/^\d{2}:\d{2}$/u.test(time)) return null;

  const target = `${day}T${time}:00`;
  const asUtc = Date.parse(target + "Z");
  if (!Number.isFinite(asUtc) || new Date(asUtc).toISOString().slice(0, 19) !== target) return null;

  // Sampling both sides of a zone transition finds either offset of a repeated hour.
  const candidates = [-36 * hour, 0, 36 * hour].flatMap((delta) => {
    const sample = asUtc + delta;
    const offset = Date.parse(wallTime(new Date(sample), timeZone) + "Z") - sample;
    const candidate = new Date(asUtc - offset);
    return wallTime(candidate, timeZone) === target ? [candidate.getTime()] : [];
  });
  return candidates.length > 0 ? new Date(Math.min(...candidates)).toISOString() : null;
}

export function civilDate(day: string): Date {
  return new Date(day + "T00:00:00Z");
}

export function shiftCivilDay(day: string, distance: number): string {
  const date = civilDate(day);
  date.setUTCDate(date.getUTCDate() + distance);
  return date.toISOString().slice(0, 10);
}

export function shiftCivilMonth(month: string, distance: number): string {
  const date = civilDate(month + "-01");
  date.setUTCMonth(date.getUTCMonth() + distance);
  return date.toISOString().slice(0, 7);
}

export function firstCivilDayOfWeek(day: string): string {
  const index = civilDate(day).getUTCDay();
  return shiftCivilDay(day, -((index + 6) % 7));
}
