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

export function downloadFile(data: Blob, filename: string): void {
  const url = URL.createObjectURL(data);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export async function shareFile(file: File): Promise<void> {
  const data = { files: [file] };
  if (navigator.share && navigator.canShare?.(data)) {
    await navigator.share(data);
    return;
  }

  downloadFile(file, file.name);
}
