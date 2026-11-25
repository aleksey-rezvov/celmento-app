"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactElement } from "react";
import { DeviceScreen } from "@/components/auth/DeviceScreen";
import type { Schemas } from "@/lib/api/client";
import { useTranslation } from "@/lib/i18n";
import { resumePath, saveIntent } from "@/lib/registration";

function IntentScreen(): ReactElement | null {
  const router = useRouter();
  const t = useTranslation();
  const [next] = useState(resumePath);

  useEffect(() => {
    if (next) {
      router.replace(next);
    }
  }, [next, router]);

  function selectIntent(intent: Schemas["RegistrationIntent"]): void {
    // spec:impl registration-intent-screen#intent-does-not-create-account
    saveIntent(intent);
    // spec:impl registration-intent-screen#open-sign-in-after-intent
    router.push("/login");
  }

  // spec:impl registration-intent-screen#show-screen-1-0-signed-in-person
  if (next) {
    return null;
  }

  // spec:impl registration-intent-screen#show-intent-choices
  // spec:impl registration-intent-screen#show-screen-1-0-identically-celmento
  // spec:impl registration-intent-screen#render-screen-1-0-device-language
  // spec:impl registration-intent-screen#ask-person-specialist-client-use
  return (
    <div className="auth-intent">
      <h1>{t("start.title")}</h1>
      <button type="button" className="auth-intent-option" onClick={() => selectIntent("lead")}>
        <strong>{t("start.lead")}</strong>
        <span>{t("start.lead_hint")}</span>
      </button>
      <button type="button" className="auth-intent-option" onClick={() => selectIntent("attend")}>
        <strong>{t("start.attend")}</strong>
        <span>{t("start.attend_hint")}</span>
      </button>
    </div>
  );
}

export default function Home(): ReactElement {
  return (
    <main>
      <DeviceScreen>
        <IntentScreen />
      </DeviceScreen>
    </main>
  );
}
