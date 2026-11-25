"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, type ReactElement } from "react";
import { apiClient, type Schemas } from "@/lib/api/client";
import { clearRegistration } from "@/lib/registration";
import { setSessionToken } from "@/lib/session";

function readTicket(): string | null {
  const url = new URL(window.location.href);
  return new URLSearchParams(url.hash.slice(1)).get("ticket") ?? url.searchParams.get("ticket");
}

async function exchangeTicket(ticket: string): Promise<Schemas["SignInSession"] | null> {
  try {
    const { data } = await apiClient(null).POST("/auth/tickets/exchange", { body: { ticket } });
    return data ?? null;
  } catch {
    return null;
  }
}

export default function Ticket(): ReactElement {
  const router = useRouter();
  const exchange = useRef<Promise<Schemas["SignInSession"] | null> | null>(null);

  useEffect(() => {
    if (exchange.current === null) {
      const ticket = readTicket();
      window.history.replaceState(window.history.state, "", window.location.pathname);
      exchange.current = ticket ? exchangeTicket(ticket) : Promise.resolve(null);
    }

    let current = true;
    void exchange.current.then((session) => {
      if (!current) {
        return;
      }

      if (session === null) {
        router.replace("/login");
        return;
      }

      clearRegistration();
      setSessionToken(session.token);
      router.replace("/app");
    });

    return () => {
      current = false;
    };
  }, [router]);

  return <main aria-busy="true" />;
}
