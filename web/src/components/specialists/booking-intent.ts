interface BookingIntent {
  specialistId: string;
  session: string;
  key: string;
  expiresAt: number;
}

const navigationWindowMs = 60_000;
let pending: BookingIntent | null = null;

export function rememberBookingIntent(specialistId: string, session: string): void {
  pending = {
    specialistId,
    session,
    key: crypto.randomUUID(),
    expiresAt: Date.now() + navigationWindowMs,
  };
}

export function claimBookingIntent(specialistId: string, session: string): string | null {
  const intent = pending;
  if (!intent) return null;
  if (intent.session !== session || intent.expiresAt < Date.now()) {
    pending = null;
    return null;
  }
  if (intent.specialistId !== specialistId) return null;
  pending = null;
  return intent.key;
}
