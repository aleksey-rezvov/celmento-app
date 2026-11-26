import type { ReactElement, ReactNode } from "react";
import { LeaderPlansGate } from "@/components/plans/LeaderPlansGate";
import { PlansJourneyProvider } from "@/components/plans/PlansJourney";
import "./plans.css";

interface PlansLayoutProps {
  children: ReactNode;
}

export default function PlansLayout({ children }: PlansLayoutProps): ReactElement {
  return (
    <LeaderPlansGate>
      <PlansJourneyProvider>{children}</PlansJourneyProvider>
    </LeaderPlansGate>
  );
}
