import type { ReactElement } from "react";
import { meetingPath } from "@/components/meetings/MeetingScreen";
import { useAppNavigation } from "@/components/shell/navigation";
import { useAccount } from "@/lib/account";
import type { Schemas } from "@/lib/api/client";
import { formatDate, formatTime } from "@/lib/format";
import { useTranslation } from "@/lib/i18n";

type Meeting = Schemas["Meeting"];

export function ArchiveMeetingTime({
  startsAt,
  id,
}: {
  startsAt: string;
  id?: string;
}): ReactElement {
  const { account } = useAccount();
  const { time_zone, language } = account;

  return (
    <time id={id} dateTime={startsAt}>
      {formatDate(startsAt, time_zone, language)} · {formatTime(startsAt, time_zone, language)}
    </time>
  );
}

export function OutcomesFirstBlock({ meetings }: { meetings: Meeting[] }): ReactElement | null {
  const navigate = useAppNavigation();
  const t = useTranslation();

  // spec:impl client-archive-restore#show-top-screen-5-4-outcomes-first
  if (meetings.length === 0) return null;

  return (
    <section className="client-archive-outcomes">
      <h2>{t("archive.outcomes_first")}</h2>
      <ul>
        {meetings.map((meeting) => {
          const timeId = "archive-outcome-" + meeting.id;
          const href = meetingPath(meeting.id) + "/outcome?from=archive&status=";

          return (
            <li key={meeting.id}>
              <ArchiveMeetingTime id={timeId} startsAt={meeting.starts_at} />
              <div className="client-archive-actions">
                <button
                  className="shell-secondary"
                  type="button"
                  aria-describedby={timeId}
                  onClick={() => navigate(href + "completed")}
                >
                  {t("outcome.done")}
                </button>
                <button
                  className="shell-secondary"
                  type="button"
                  aria-describedby={timeId}
                  onClick={() => navigate(href + "not_taken_place")}
                >
                  {t("outcome.missed")}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
