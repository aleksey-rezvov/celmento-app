import { useRef } from "react";

interface Submission {
  body: string;
  key: string;
}

interface IdempotencyKey {
  keyFor: (body: object) => string;
  clear: () => void;
}

export function useIdempotencyKey(): IdempotencyKey {
  const submission = useRef<Submission | null>(null);

  return {
    keyFor: (body) => {
      const serialized = JSON.stringify(body);
      if (submission.current?.body !== serialized) {
        submission.current = { body: serialized, key: crypto.randomUUID() };
      }
      return submission.current.key;
    },
    clear: () => {
      submission.current = null;
    },
  };
}
