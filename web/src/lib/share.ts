export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

export async function shareLink(text: string, url: string): Promise<void> {
  if (navigator.share) {
    await navigator.share({ text: text || url });
    return;
  }

  await copyText(url);
}
