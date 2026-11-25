"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactElement } from "react";
import { useAccount } from "@/lib/account";
import { formatDate } from "@/lib/format";
import { useTranslation, type MessageKey } from "@/lib/i18n";
import { newClientHref, newClientPath } from "@/lib/limit";
import { folderIdFromPath, newNoteHref } from "@/lib/notes-navigation";
import { meetingCreationHref, useCurrentInstant, useMeetingCreationDay } from "@/lib/schedule-view";
import { zonedDay } from "@/lib/zoned-date";
import { FloatingAction } from "./FloatingAction";
import { useAppNavigation } from "./navigation";

type TabId = "meetings" | "notes" | "people" | "records" | "profile";

interface Tab {
  id: TabId;
  label: MessageKey;
  create?: { href: string; label: MessageKey };
}

const tabs: readonly Tab[] = [
  {
    id: "meetings",
    label: "meetings.title",
    create: { href: "/app/meetings/new", label: "meetings.empty_day_cta" },
  },
  {
    id: "notes",
    label: "notes.title",
    create: { href: newNoteHref(), label: "extra.note_create" },
  },
  {
    id: "people",
    label: "people.title",
    create: { href: newClientPath, label: "clients.empty_add" },
  },
  { id: "records", label: "acc.title" },
  { id: "profile", label: "profile.title" },
];

const tabIconPaths: Record<TabId, string> = {
  meetings:
    "M7 3v4m10-4v4M4 10h16M7 5h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3Z",
  notes:
    "M7 3h10a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Zm1 5h8m-8 4h8m-8 4h5",
  people:
    "M13.5 7.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Zm-10 11c0-2.1 2.9-3.6 6.5-3.6s6.5 1.5 6.5 3.6S13.6 22 10 22s-6.5-1.4-6.5-3.5Zm12.8-13.8a3.2 3.2 0 0 1 0 6.1m2.2 5.2c1.6.5 2.6 1.3 2.6 2.3 0 .9-.8 1.6-2.2 2.1",
  records: "M10.5 3.7a8.7 8.7 0 1 0 9.8 9.8h-9.8V3.7Zm3.4-1v7.5h7.4a8.8 8.8 0 0 0-7.4-7.5Z",
  profile:
    "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-6-2.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm-8 8.8c.8-2 2.4-3 5-3s4.2 1 5 3",
};

interface BottomMenuProps {
  activated: boolean;
}

export function BottomMenu({ activated }: BottomMenuProps): ReactElement {
  const { account } = useAccount();
  const pathname = usePathname();
  const navigate = useAppNavigation();
  const t = useTranslation();
  const now = useCurrentInstant();
  const creationDay = useMeetingCreationDay() ?? zonedDay(now, account.time_zone);
  const folderId = folderIdFromPath(pathname);

  // spec:impl mobile-app-shell#label-meetings-tab-bottom-menu
  // spec:impl schedule-date-navigation#label-meetings-tab-bottom-menu
  const today = formatDate(now.toISOString(), account.time_zone, account.language);
  // spec:impl mobile-app-shell#show-leader-one-bottom-menu
  // spec:impl mobile-app-shell#show-non-leader-bottom-menu-without-records
  // spec:impl mobile-app-shell#add-records-tab-bottom-menu
  // spec:impl client-leading-activation#show-non-leader-four-tabs-meetings
  const visible = tabs.filter(({ id }) => activated || id !== "records");

  return (
    <nav className="shell-dock" aria-label={t("extra.shell_navigation")}>
      <ul className="shell-tabs">
        {visible.map((tab) => {
          const href = `/app/${tab.id}`;
          const root = pathname === href;
          const active = root || pathname.startsWith(href + "/");
          // spec:impl mobile-app-shell#use-title-texts-people-tab
          const label = tab.id === "meetings" ? today : t(tab.label);
          // spec:impl mobile-app-shell#show-notes-account-meetings-people
          // spec:impl mobile-app-shell#show-records-profile-tabs-no-create
          // spec:impl notes-grid-folders#open-screen-7-4-folder-tile
          const action =
            tab.id === "notes" && folderId && tab.create
              ? { ...tab.create, href: newNoteHref(folderId) }
              : root && (activated || tab.id === "notes")
                ? tab.create
                : undefined;

          return (
            <li key={tab.id} className="shell-tab-slot">
              <Link
                href={href}
                className="shell-tab"
                aria-current={active ? "page" : undefined}
                aria-label={tab.id === "meetings" ? `${t(tab.label)}, ${today}` : undefined}
                onNavigate={(event) => {
                  event.preventDefault();
                  if (
                    !root ||
                    (tab.id === "notes" &&
                      new URLSearchParams(window.location.search).has("client_id"))
                  ) {
                    navigate(href);
                  }
                }}
              >
                <svg
                  className="shell-tab-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d={tabIconPaths[tab.id]} />
                </svg>
                <span>{label}</span>
              </Link>
              {/* spec:impl client-list#open-client-creation-form-floating */}
              {/* spec:impl meeting-form#open-screen-3-4-meetings-tab */}
              {action && (
                <FloatingAction
                  href={
                    tab.id === "people"
                      ? newClientHref(account.leader?.plan)
                      : tab.id === "meetings"
                        ? meetingCreationHref(creationDay)
                        : action.href
                  }
                  labelKey={action.label}
                />
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
