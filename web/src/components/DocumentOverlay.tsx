"use client";

import { useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from "react";
import type { Schemas } from "@/lib/api/client";
import type { Contour } from "@/lib/contour";
import { useLanguage, useTranslation } from "@/lib/i18n";
import { getLegalDocument } from "@/lib/legal-documents";

type Kind = Schemas["LegalDocumentKind"];
type Document = Schemas["LegalDocument"];

interface DocumentOverlayProps {
  kind: Kind;
  contour: Contour;
  documents: readonly Document[];
  onClose: () => void;
}

interface Result {
  kind: Kind;
  document: Document | null;
}

interface DocumentBodyProps {
  document: Document;
  onOpenPrivacy: () => void;
}

function DocumentBody({ document, onOpenPrivacy }: DocumentBodyProps): ReactElement {
  const t = useTranslation();
  const privacyReference = t("extra.auth_privacy_reference");
  const lines: ReactNode[] = [];

  for (const [index, line] of document.text.split("\n").entries()) {
    if (line.startsWith("#")) {
      const heading = line.replace(/^#+\s+/u, "");
      if (heading.trim() !== document.title.trim()) {
        lines.push(<h3 key={index}>{heading}</h3>);
      }
      continue;
    }

    if (!line.trim()) {
      continue;
    }

    const text = line.replace(/^\s*-\s+/u, "• ").replaceAll("**", "");
    const privacyIndex =
      document.kind === "personal_data_consent"
        ? text.toLocaleLowerCase().indexOf(privacyReference.toLocaleLowerCase())
        : -1;

    lines.push(
      <p key={index}>
        {privacyIndex >= 0 ? (
          <>
            {text.slice(0, privacyIndex)}
            <button className="auth-text-link" type="button" onClick={onOpenPrivacy}>
              {text.slice(privacyIndex, privacyIndex + privacyReference.length)}
            </button>
            {text.slice(privacyIndex + privacyReference.length)}
          </>
        ) : (
          text
        )}
      </p>,
    );
  }

  return <div className="auth-document-text">{lines}</div>;
}

export function DocumentOverlay({
  kind,
  contour,
  documents,
  onClose,
}: DocumentOverlayProps): ReactElement {
  const language = useLanguage();
  const t = useTranslation();
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [visibleKind, setVisibleKind] = useState<Kind>(kind);
  const [result, setResult] = useState<Result | null>(null);
  const [request, setRequest] = useState(0);
  const preloaded = documents.find((doc) => doc.kind === visibleKind);
  const doc = preloaded ?? (result?.kind === visibleKind ? result.document : null);
  const failed =
    preloaded === undefined && result?.kind === visibleKind && result.document === null;

  useEffect(() => {
    const modal = dialog.current;
    if (modal && !modal.open) {
      modal.showModal();
    }

    return () => {
      modal?.close();
    };
  }, []);

  useEffect(() => {
    if (preloaded) {
      return;
    }

    const controller = new AbortController();
    void getLegalDocument(visibleKind, contour, language, controller.signal).then(
      (document) => {
        if (!controller.signal.aborted) {
          setResult({ kind: visibleKind, document });
        }
      },
      () => {
        if (!controller.signal.aborted) {
          setResult({ kind: visibleKind, document: null });
        }
      },
    );
    return () => controller.abort();
  }, [contour, language, preloaded, request, visibleKind]);

  return (
    <dialog
      ref={dialog}
      className="auth-document"
      aria-labelledby={doc ? titleId : undefined}
      aria-label={doc ? undefined : t("extra.auth_close_document")}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="auth-document-shell" aria-busy={!doc && !failed}>
        <button
          type="button"
          className="auth-icon auth-icon-secondary auth-document-close"
          aria-label={t("extra.auth_close_document")}
          onClick={onClose}
        >
          <span aria-hidden="true">×</span>
        </button>
        {doc && (
          <>
            <h2 id={titleId}>{doc.title}</h2>
            <p className="auth-document-version">{doc.version}</p>
            <DocumentBody document={doc} onOpenPrivacy={() => setVisibleKind("privacy_policy")} />
          </>
        )}
        {failed && (
          <>
            <p role="alert" className="auth-error">
              {t("extra.auth_request_failed")}
            </p>
            <button
              type="button"
              className="auth-secondary"
              onClick={() => setRequest((value) => value + 1)}
            >
              {t("extra.auth_retry")}
            </button>
          </>
        )}
      </div>
    </dialog>
  );
}
