"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useId, useState, type ReactElement } from "react";
import { hoursLogType } from "@/components/records/HoursTabs";
import { PeriodPicker } from "@/components/records/PeriodPicker";
import { RecordsLoadState, RecordsScreen } from "@/components/records/RecordsScreen";
import { useRecordsHoursExport } from "@/components/records/records-data";
import { hoursPath, logLabels } from "@/components/records/records-display";
import { ChoiceChips } from "@/components/shell/ChoiceChips";
import { useAccount } from "@/lib/account";
import type { Schemas } from "@/lib/api/client";
import { useTranslation } from "@/lib/i18n";
import { RecordsPeriodProvider, usePeriod } from "@/lib/records-period";
import { shareFile } from "@/lib/share";

type Log = Schemas["RecordsHoursLogType"];
type Format = Schemas["RecordsHoursExportFormat"];

function ExportForm({ type }: { type: Log }): ReactElement {
  const t = useTranslation();
  const { currentSessionToken } = useAccount();
  const warningId = useId();
  const [period] = usePeriod();
  const [format, setFormat] = useState<Format>(type === "practice" ? "icf" : "sessions");
  const [sharing, setSharing] = useState(false);
  const [failed, setFailed] = useState(false);
  const { data: file, error, retry } = useRecordsHoursExport(period, type, format);

  async function exportFile(): Promise<void> {
    if (!file || sharing || !currentSessionToken()) return;
    setFailed(false);
    setSharing(true);
    try {
      // spec:impl records-hours-export#share-or-download
      await shareFile(file);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setFailed(true);
    } finally {
      setSharing(false);
    }
  }

  return (
    <RecordsScreen title="hours.title" showPeriod={false} backHref={hoursPath + "?type=" + type}>
      <div className="records-export-options">
        <h2>{t(logLabels[type])}</h2>
        <div>
          <h3>{t("export.period")}</h3>
          {/* spec:impl records-hours-export#choose-period-format */}
          <PeriodPicker title="export.period" allTimeLabel="export.all_time" />
        </div>
        {type === "practice" && (
          <div>
            <h3>{t("extra.records_export_format")}</h3>
            {/* spec:impl records-hours-export#choose-period-format */}
            <ChoiceChips
              label={t("extra.records_export_format")}
              value={format}
              options={[
                { value: "icf", label: t("export.icf") },
                { value: "sessions", label: t("export.sessions") },
              ]}
              onChange={(next: Format) => setFormat(next)}
            />
          </div>
        )}
        {/* spec:impl records-hours-export#warn-before-export */}
        <p className="records-export-warning" id={warningId}>
          {t("export.warning")}
        </p>
        {!file && <RecordsLoadState error={error} retry={retry} />}
        <button
          className="shell-primary"
          type="button"
          disabled={!file || sharing}
          aria-describedby={warningId}
          onClick={() => void exportFile()}
        >
          {t("export.button")}
        </button>
        {failed && <p role="alert">{t("extra.auth_request_failed")}</p>}
      </div>
    </RecordsScreen>
  );
}

function RequestedExport(): ReactElement {
  const type = hoursLogType(useSearchParams().get("type"));
  return (
    <RecordsPeriodProvider key={type}>
      <ExportForm type={type} />
    </RecordsPeriodProvider>
  );
}

export default function HoursExportPage(): ReactElement {
  return (
    <Suspense
      fallback={
        <RecordsScreen title="hours.title" showPeriod={false}>
          <div aria-busy="true" />
        </RecordsScreen>
      }
    >
      <RequestedExport />
    </Suspense>
  );
}
