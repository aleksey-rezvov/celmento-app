import type { ReactElement } from "react";
import { zonedClock } from "@/lib/zoned-date";

interface CurrentTimeLineProps {
  instant: Date;
  timeZone: string;
  top?: string;
}

export function CurrentTimeLine({ instant, timeZone, top }: CurrentTimeLineProps): ReactElement {
  return (
    <div className="schedule-current-time" data-positioned={top !== undefined} style={{ top }}>
      <time dateTime={instant.toISOString()}>{zonedClock(instant, timeZone)}</time>
    </div>
  );
}
