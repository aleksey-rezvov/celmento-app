import Link from "next/link";
import type { ReactElement } from "react";
import { LeaderAvatar } from "@/components/booking/LeaderAvatar";
import { leaderName, leaderSpecialties } from "@/components/booking/booking-display";
import { useAccount } from "@/lib/account";
import type { Schemas } from "@/lib/api/client";
import { formatDate, formatTime } from "@/lib/format";
import { useTranslation } from "@/lib/i18n";
import { specialistPath } from "./specialist-display";

interface SpecialistRowProps {
  item: Schemas["SpecialistListItem"];
}

export function SpecialistRow({ item }: SpecialistRowProps): ReactElement {
  const { account } = useAccount();
  const t = useTranslation();
  const specialist = item.specialist;
  const name = leaderName(specialist.first_name, specialist.last_name);
  const specialties = leaderSpecialties(
    specialist.specializations,
    specialist.specialization_other,
    t,
  );
  const startsAt = item.next_booking_at;
  const dateTime = startsAt
    ? formatDate(startsAt, account.time_zone, account.language) +
      ", " +
      formatTime(startsAt, account.time_zone, account.language)
    : null;

  // spec:impl client-my-specialists#show-listed-leader-photo-name
  return (
    <li className="client-row">
      <LeaderAvatar
        firstName={specialist.first_name}
        lastName={specialist.last_name}
        photoUrl={specialist.photo_url}
        size={46}
      />
      <div>
        {/* spec:impl client-my-specialists#open-specialist-card-9-6-account */}
        <Link className="client-row-title client-row-link" href={specialistPath(specialist.id)}>
          {name}
        </Link>
        {specialties && <p className="client-row-detail">{specialties}</p>}
        <p className="client-row-detail">
          {dateTime && startsAt ? (
            <time dateTime={startsAt}>
              {t("c.next_booking", { "date, time": dateTime, "дата, время": dateTime })}
            </time>
          ) : (
            t("c.no_bookings_short")
          )}
        </p>
      </div>
      <span className="client-row-chevron" aria-hidden="true">
        ›
      </span>
    </li>
  );
}
