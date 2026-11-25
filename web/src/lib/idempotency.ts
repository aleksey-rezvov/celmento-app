import { useMemo, useRef } from "react";

interface Submission {
  body: string;
  key: string;
}

interface IdempotencyKey {
  keyFor: (body: object) => string;
  clear: () => void;
}

function restoreSubmission(storageKey: string): Submission | null {
  try {
    const stored = window.sessionStorage.getItem(storageKey);
    if (!stored) return null;
    const value: unknown = JSON.parse(stored);
    if (
      value &&
      typeof value === "object" &&
      "body" in value &&
      "key" in value &&
      typeof value.body === "string" &&
      typeof value.key === "string"
    ) {
      return { body: value.body, key: value.key };
    }
  } catch {
    return null;
  }
  return null;
}

function storeSubmission(storageKey: string, submission: Submission | null): void {
  try {
    if (submission) window.sessionStorage.setItem(storageKey, JSON.stringify(submission));
    else window.sessionStorage.removeItem(storageKey);
  } catch {
    // The attempt is still retained by the mounted form.
  }
}

export function useIdempotencyKey(sessionStorageKey?: string): IdempotencyKey {
  const submission = useRef<Submission | null>(null);

  return useMemo(
    () => ({
      keyFor: (body) => {
        if (!submission.current && sessionStorageKey) {
          submission.current = restoreSubmission(sessionStorageKey);
        }
        const serialized = JSON.stringify(body);
        if (submission.current?.body !== serialized) {
          submission.current = { body: serialized, key: crypto.randomUUID() };
          if (sessionStorageKey) storeSubmission(sessionStorageKey, submission.current);
        }
        return submission.current.key;
      },
      clear: () => {
        submission.current = null;
        if (sessionStorageKey) storeSubmission(sessionStorageKey, null);
      },
    }),
    [sessionStorageKey],
  );
}
