"use client";

import { useEffect, useState } from "react";
import { apiClient, type Schemas } from "./api/client";
import type { Contour } from "./contour";
import type { Language } from "./i18n/messages";

type Kind = Schemas["LegalDocumentKind"];
type Document = Schemas["LegalDocument"];

export const signupKinds = ["terms_of_use", "personal_data_consent"] satisfies readonly Kind[];
export const activationKinds = [
  "specialist_offer",
  "data_processing_instruction",
] satisfies readonly Kind[];
export const finishKinds = [...signupKinds, ...activationKinds];
export const noDocuments: readonly Kind[] = [];

export async function getLegalDocument(
  kind: Kind,
  contour: Contour,
  language: Language,
  signal: AbortSignal,
): Promise<Document> {
  const { data } = await apiClient(null, contour).GET("/documents/{kind}", {
    params: { path: { kind }, query: { language } },
    signal,
  });

  if (
    data === undefined ||
    data.kind !== kind ||
    data.contour !== contour ||
    data.language !== language
  ) {
    throw new Error("The requested document is unavailable.");
  }

  return data;
}

interface DocumentLoad {
  key: string;
  documents: readonly Document[];
  failed: boolean;
}

interface LegalDocuments {
  documents: readonly Document[];
  failed: boolean;
  refresh: () => void;
}

export function useLegalDocuments(
  kinds: readonly Kind[],
  contour: Contour,
  language: Language,
): LegalDocuments {
  const [load, setLoad] = useState<DocumentLoad | null>(null);
  const [version, setVersion] = useState(0);
  const key = [contour, language, kinds.join(","), version].join(":");

  useEffect(() => {
    if (kinds.length === 0) {
      return;
    }

    const controller = new AbortController();
    void Promise.all(
      kinds.map((kind) => getLegalDocument(kind, contour, language, controller.signal)),
    )
      .then((documents) => {
        if (!controller.signal.aborted) {
          setLoad({ key, documents, failed: false });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setLoad({ key, documents: [], failed: true });
        }
      });

    return () => controller.abort();
  }, [contour, key, kinds, language]);

  return {
    documents: load?.key === key ? load.documents : [],
    failed: load?.key === key && load.failed,
    refresh: () => setVersion((current) => current + 1),
  };
}

export function documentAcceptances(
  documents: readonly Document[],
  kinds: readonly Kind[],
  acceptedAt?: string,
): Schemas["ConsentAcceptance"][] | null {
  const acceptances: Schemas["ConsentAcceptance"][] = [];
  for (const kind of kinds) {
    const doc = documents.find((candidate) => candidate.kind === kind);
    if (doc === undefined) {
      return null;
    }

    acceptances.push({ document: kind, version: doc.version, accepted_at: acceptedAt });
  }

  return acceptances;
}
