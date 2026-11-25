"use client";

import { useMemo, useState, type ReactElement } from "react";
import { Sheet } from "@/components/shell/Sheet";
import { zoneLabel } from "@/lib/format";
import { useLanguage, useTranslation } from "@/lib/i18n";

interface TimeZonePickerProps {
  value: string;
  onSelect: (zone: string) => void;
  onClose: () => void;
  busy: boolean;
}

export function TimeZonePicker({
  value,
  onSelect,
  onClose,
  busy,
}: TimeZonePickerProps): ReactElement {
  const t = useTranslation();
  const language = useLanguage();
  const [query, setQuery] = useState("");
  const zones = useMemo(() => {
    const today = new Date();
    return [...new Set([...Intl.supportedValuesOf("timeZone"), "UTC", value])]
      .map((zone) => ({ zone, label: zoneLabel(zone, today, language) }))
      .sort((a, b) => a.label.localeCompare(b.label, language));
  }, [value, language]);
  const search = query.trim().toLocaleLowerCase(language);
  const results = zones.filter(
    ({ zone, label }) =>
      label.toLocaleLowerCase(language).includes(search) ||
      zone.replaceAll("_", " ").toLocaleLowerCase(language).includes(search),
  );

  return (
    <Sheet title={t("profile.timezone")} onClose={onClose}>
      <div className="profile-zone-picker">
        <input
          className="profile-zone-search"
          type="search"
          aria-label={t("extra.profile_city_search")}
          placeholder={t("extra.profile_city_search")}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        <ul className="profile-zone-list">
          {results.map(({ zone, label }) => (
            <li key={zone}>
              <button
                className="profile-row"
                type="button"
                aria-pressed={zone === value}
                disabled={busy}
                onClick={() => onSelect(zone)}
              >
                {label}
                {zone === value && <span aria-hidden="true">✓</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Sheet>
  );
}
