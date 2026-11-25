export function publicBookingPath(login: string): string {
  return "/" + encodeURIComponent(login.toLowerCase());
}

export function callHref(link: string | null): string | null {
  if (!link) return null;

  try {
    const url = new URL(link);
    return ["http:", "https:", "zoommtg:", "msteams:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
