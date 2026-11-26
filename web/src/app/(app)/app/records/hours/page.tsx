"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState, type ReactElement } from "react";
import { HoursBreakdown } from "@/components/records/HoursBreakdown";
import { HoursGoal } from "@/components/records/HoursGoal";
import { HoursMeetingRow } from "@/components/records/HoursMeetingRow";
import { HoursTabs, hoursLogType } from "@/components/records/HoursTabs";
import {
  RecordsListEmpty,
  RecordsLoadState,
  RecordsScreen,
} from "@/components/records/RecordsScreen";
import { useRecordsHours } from "@/components/records/records-data";
import { formatRecordsHours, hoursExportPath } from "@/components/records/records-display";
import type { Schemas } from "@/lib/api/client";
import { useLanguage, useTranslation } from "@/lib/i18n";
import { usePeriod } from "@/lib/records-period";

type Log = Schemas["RecordsHoursLogType"];

interface HoursProps {
  initial: Log;
}

function Hours({ initial }: HoursProps): ReactElement {
  const t = useTranslation();
  const language = useLanguage();
  const [period] = usePeriod();
  const [type, setType] = useState<Log>(initial);
  const { data, error, retry } = useRecordsHours(period, type);

  // spec:impl hours-log#show-screen-8-3-titled-tabs
  // spec:impl hours-log#offer-editing-meeting-hours-log
  return (
    <RecordsScreen title="hours.title">
      <HoursTabs value={type} onChange={setType} />
      {/* spec:impl records-hours-export#open-export */}
      <Link
        className="shell-secondary records-export-link"
        href={hoursExportPath + "?type=" + type}
      >
        {t("export.button")}
      </Link>
      {data ? (
        <>
          <div className="records-hours-total">
            {/* spec:impl hours-log#show-total-large-type-log */}
            <p className="records-tile-value">
              {t("hours.total", { H: formatRecordsHours(data.total_hours, language) })}
            </p>
            {/* spec:impl hours-log#show-period-next-total-log */}
            {period.kind !== "all" && (
              <p>{t("hours.period", { H: formatRecordsHours(data.period_hours, language) })}</p>
            )}
          </div>
          <HoursBreakdown value={data.breakdown} />
          <HoursGoal key={type} type={type} totalHours={data.total_hours} />
          {data.items.length > 0 ? (
            <ul className="records-list">
              {data.items.map((meeting) => (
                <HoursMeetingRow key={meeting.id} meeting={meeting} />
              ))}
            </ul>
          ) : (
            // spec:impl hours-log#show-empty-tile-sentence-one-button
            <RecordsListEmpty />
          )}
        </>
      ) : (
        <RecordsLoadState error={error} retry={retry} />
      )}
    </RecordsScreen>
  );
}

function RequestedHours(): ReactElement {
  const value = useSearchParams().get("type");
  const initial = hoursLogType(value);
  return <Hours key={initial} initial={initial} />;
}

export default function HoursPage(): ReactElement {
  return (
    <Suspense
      fallback={
        <RecordsScreen title="hours.title">
          <div aria-busy="true" />
        </RecordsScreen>
      }
    >
      <RequestedHours />
    </Suspense>
  );
}
