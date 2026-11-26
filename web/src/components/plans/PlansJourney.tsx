"use client";

import { createContext, useContext, useState, type ReactElement, type ReactNode } from "react";
import type { Schemas } from "@/lib/api/client";

interface PlansReceipt {
  accountId: string;
  request: Schemas["SubscriptionRequest"];
  plansHref: string;
}

interface PlansJourney {
  receipt: PlansReceipt | null;
  received: (receipt: PlansReceipt) => void;
}

const PlansJourneyContext = createContext<PlansJourney | null>(null);

interface PlansJourneyProviderProps {
  children: ReactNode;
}

export function PlansJourneyProvider({ children }: PlansJourneyProviderProps): ReactElement {
  const [receipt, received] = useState<PlansReceipt | null>(null);
  return (
    <PlansJourneyContext.Provider value={{ receipt, received }}>
      {children}
    </PlansJourneyContext.Provider>
  );
}

export function usePlansJourney(): PlansJourney {
  const journey = useContext(PlansJourneyContext);
  if (journey === null) throw new Error("The Plans layout is required.");
  return journey;
}
