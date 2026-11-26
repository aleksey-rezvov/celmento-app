"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useState, type ReactElement } from "react";
import { NoticeBar } from "@/components/NoticeBar";
import { DateSubtitle } from "@/components/schedule/DateSubtitle";
import { DaySchedule } from "@/components/schedule/DaySchedule";
import { FeedView } from "@/components/schedule/FeedView";
import { MiniCalendar } from "@/components/schedule/MiniCalendar";
import { PendingOutcomesBar } from "@/components/schedule/PendingOutcomesBar";
import { ViewSwitcher } from "@/components/schedule/ViewSwitcher";
import type { OnScheduleLoaded } from "@/components/schedule/schedule-data";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { attendedMeetingPath } from "@/components/specialists/specialist-display";
import { useAccount } from "@/lib/account";
import type { Schemas } from "@/lib/api/client";
import { useTranslation } from "@/lib/i18n";
import {
  loadView,
  meetingCreationHref,
  saveView,
  useCurrentInstant,
  useSetMeetingCreationDay,
  type ScheduleView,
} from "@/lib/schedule-view";
import { shiftCivilDay, zonedDay, zonedInstant } from "@/lib/zoned-date";
import "./schedule.css";

const emptyStatus: { pendingCount: number; notices: Schemas["Notice"][] } = {
  pendingCount: 0,
  notices: [],
};

function MeetingSchedule({ savedDate }: { savedDate: string | null }): ReactElement {
  const { account } = useAccount();
  const router = useRouter();
  const t = useTranslation();
  const now = useCurrentInstant();
  const zone = account.time_zone;
  const today = zonedDay(now, zone);
  // spec:impl meeting-form#create-meeting-status-scheduled-save
  const savedDay = savedDate && zonedInstant(savedDate, "12:00", zone) ? savedDate : null;
  // spec:impl schedule-date-navigation#show-current-day-whenever-meetings
  const [day, setDay] = useState(savedDay ?? today);
  // spec:impl schedule-date-navigation#open-tab-view-last-chosen
  const [view, setView] = useState(loadView);
  const [feedAnchor, setFeedAnchor] = useState(savedDay ?? today);
  const [calendar, setCalendar] = useState(false);
  const [status, setStatus] = useState(emptyStatus);
  const onScheduleLoaded = useCallback<OnScheduleLoaded>((snapshot) => {
    setStatus((previous) =>
      snapshot
        ? {
            pendingCount: snapshot.schedule.pending_outcomes_count,
            notices: snapshot.notices ?? previous.notices,
          }
        : emptyStatus,
    );
  }, []);
  const leader = account.activated;
  useSetMeetingCreationDay(view === "day" ? day : today);

  function switchView(next: ScheduleView): void {
    if (next === view) return;
    // spec:impl schedule-date-navigation#switch-feed-day-view-switcher
    if (next === "schedule") setFeedAnchor(day);
    saveView(next);
    setView(next);
  }

  function openDay(picked: string): void {
    setDay(picked);
    setView("day");
  }

  function openMeeting(id: string): void {
    router.push(`/app/meetings/${encodeURIComponent(id)}`);
  }

  function openAttended(id: string): void {
    // spec:impl attended-meetings#open-details-9-9-account-taps
    router.push(attendedMeetingPath(id));
  }

  function moveDay(distance: number): void {
    setDay((value) => shiftCivilDay(value, distance));
  }

  return (
    <main className="schedule-page">
      {/* spec:impl schedule-date-navigation#show-title-header-meetings-tab */}
      <ScreenHeader
        title={t("meetings.title")}
        subtitle={
          <DateSubtitle
            day={day}
            today={today}
            expanded={calendar}
            onOpen={() => setCalendar(true)}
          />
        }
        actions={<ViewSwitcher value={view} onChange={switchView} />}
      />
      <NoticeBar tab="meetings" items={status.notices} />
      {/* spec:impl in-app-notice-bar#keep-pending-outcomes-bar */}
      {leader && <PendingOutcomesBar count={status.pendingCount} />}
      {view === "day" && (
        <div className="schedule-day-navigation">
          <button
            className="shell-icon-button"
            type="button"
            aria-label={t("extra.schedule_previous_day")}
            onClick={() => moveDay(-1)}
          >
            <span aria-hidden="true">‹</span>
          </button>
          {/* spec:impl schedule-day-view#return-current-day-today-tapped */}
          {day !== today && (
            <button className="shell-secondary" type="button" onClick={() => setDay(today)}>
              {t("meetings.today")}
            </button>
          )}
          <button
            className="shell-icon-button"
            type="button"
            aria-label={t("extra.schedule_next_day")}
            onClick={() => moveDay(1)}
          >
            <span aria-hidden="true">›</span>
          </button>
        </div>
      )}
      {view === "day" ? (
        <DaySchedule
          key={`${day}:${zone}`}
          day={day}
          leader={leader}
          now={now}
          onMove={moveDay}
          onCreateAt={(startsAt) => router.push(meetingCreationHref(day, startsAt))}
          onOpen={openMeeting}
          onOpenAttended={openAttended}
          onScheduleLoaded={onScheduleLoaded}
        />
      ) : (
        <FeedView
          key={`${feedAnchor}:${zone}`}
          initialDay={feedAnchor}
          today={today}
          now={now}
          onVisibleDay={setDay}
          onPickDay={openDay}
          onOpen={openMeeting}
          onOpenAttended={openAttended}
          onScheduleLoaded={onScheduleLoaded}
        />
      )}
      {calendar && (
        <MiniCalendar
          selected={day}
          today={today}
          onPick={(picked) => {
            // spec:impl schedule-date-navigation#close-mini-calendar-open-picked
            setCalendar(false);
            openDay(picked);
          }}
          onClose={() => {
            // spec:impl schedule-date-navigation#close-mini-calendar-without-changing
            setCalendar(false);
          }}
        />
      )}
    </main>
  );
}

function RequestedMeetingSchedule(): ReactElement {
  const { account } = useAccount();
  const savedDate = useSearchParams().get("date");
  return <MeetingSchedule key={account.id + ":" + savedDate} savedDate={savedDate} />;
}

export default function Meetings(): ReactElement {
  return (
    <Suspense fallback={<div aria-busy="true" />}>
      <RequestedMeetingSchedule />
    </Suspense>
  );
}
