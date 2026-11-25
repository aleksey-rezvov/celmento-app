"use client";

import { useCallback, useEffect, useState, type ReactElement } from "react";
import { Sheet } from "@/components/shell/Sheet";
import { useNavigationGuard } from "@/components/shell/navigation";
import { useTranslation } from "@/lib/i18n";

interface ProfileLeaveOptions {
  dirty: boolean;
  saving: boolean;
  valid: boolean;
  save: () => Promise<boolean>;
  onDiscard?: () => void;
}

interface ProfileLeaveGuard {
  confirm: (proceed: () => void) => void;
  sheet: ReactElement | null;
}

export function useProfileLeaveGuard({
  dirty,
  saving,
  valid,
  save,
  onDiscard,
}: ProfileLeaveOptions): ProfileLeaveGuard {
  const t = useTranslation();
  const [destination, setDestination] = useState<(() => void) | null>(null);
  const confirm = useCallback(
    (proceed: () => void): void => {
      if (saving) return;
      if (dirty) {
        setDestination(() => proceed);
      } else {
        proceed();
      }
    },
    [dirty, saving],
  );

  useNavigationGuard(dirty || saving ? confirm : null);

  useEffect(() => {
    if (!dirty && !saving) return;
    const warn = (event: BeforeUnloadEvent): void => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, saving]);

  // spec:impl account-profile#ask-unsaved-save-dont-save-account
  const sheet = destination && (
    <Sheet title={t("profile.unsaved")} onClose={() => !saving && setDestination(null)}>
      <div className="profile-sheet-actions">
        <button
          className="profile-primary"
          type="button"
          disabled={!valid || saving}
          onClick={async () => {
            if (await save()) destination();
            setDestination(null);
          }}
        >
          {t("profile.save")}
        </button>
        <button
          className="profile-secondary"
          type="button"
          disabled={saving}
          onClick={() => {
            onDiscard?.();
            setDestination(null);
            destination();
          }}
        >
          {t("profile.dont_save")}
        </button>
      </div>
    </Sheet>
  );

  return { confirm, sheet };
}
