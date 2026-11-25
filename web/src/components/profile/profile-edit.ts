import type { Schemas } from "@/lib/api/client";
import { validEmail } from "@/lib/auth";

type Account = Schemas["Account"];
type Leader = Schemas["LeaderProfile"];
type Update = Schemas["AccountUpdate"];
type LeaderUpdate = Schemas["LeaderProfileUpdate"];

type PersonalFields = Pick<Account, "first_name" | "last_name" | "phone" | "telegram" | "whatsapp">;
type LeaderFields = Pick<
  Leader,
  | "specializations"
  | "specialization_other"
  | "about"
  | "contact_email"
  | "links"
  | "main_channel"
  | "default_rate"
  | "default_currency"
>;

export interface ProfileFields extends PersonalFields {
  leader: LeaderFields | null;
}

export const accountNameLimit = 100;

export const contactKeys = {
  phone: "profile.phone",
  telegram: "card.telegram",
  whatsapp: "card.whatsapp",
  email: "profile.contact_email",
  other: "extra.profile_other",
} as const satisfies Record<Schemas["ContactChannel"], string>;

export const specializationKeys = {
  coach: "extra.profile_coach",
  psychologist: "extra.profile_psychologist",
  psychotherapist: "extra.profile_psychotherapist",
  psychoanalyst: "extra.profile_psychoanalyst",
  consultant: "extra.profile_consultant",
  mentor: "extra.profile_mentor",
  other: "extra.profile_other",
} as const satisfies Record<Schemas["Specialization"], string>;

export const specializations = [
  "coach",
  "psychologist",
  "psychotherapist",
  "psychoanalyst",
  "consultant",
  "mentor",
  "other",
] as const satisfies readonly Schemas["Specialization"][];

export const currencies = { RUB: "RUB (₽)", EUR: "EUR (€)", USD: "USD ($)" } as const;
export const currencyOptions = [
  "RUB",
  "EUR",
  "USD",
] as const satisfies readonly Schemas["Currency"][];

export function profileFields(account: Account): ProfileFields {
  const { first_name, last_name, phone, telegram, whatsapp } = account;
  const leader = account.activated ? account.leader : null;

  return {
    first_name,
    last_name,
    phone,
    telegram,
    whatsapp,
    leader: leader && {
      specializations: leader.specializations,
      specialization_other: leader.specialization_other,
      about: leader.about,
      contact_email: leader.contact_email,
      links: leader.links,
      main_channel: leader.main_channel,
      default_rate: leader.default_rate,
      default_currency: leader.default_currency,
    },
  };
}

export function filledChannels(fields: ProfileFields): Schemas["ContactChannel"][] {
  const channels: Schemas["ContactChannel"][] = [];
  if (fields.phone?.trim()) channels.push("phone");
  if (fields.telegram?.trim()) channels.push("telegram");
  if (fields.whatsapp?.trim()) channels.push("whatsapp");
  if (fields.leader?.contact_email?.trim()) channels.push("email");
  return channels;
}

export function webLinkValid(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function optionalText(value: string | null): string | null {
  return value?.trim() || null;
}

export function normalizeRate(value: string | null): string | null {
  return optionalText(value)?.replace(",", ".") ?? null;
}

export function validProfile(fields: ProfileFields): boolean {
  const { first_name, last_name, leader } = fields;
  const first = first_name.trim();
  const last = last_name.trim();
  if (!first || !last || first.length > accountNameLimit || last.length > accountNameLimit) {
    return false;
  }
  if (!leader) return true;

  const rate = normalizeRate(leader.default_rate);
  return (
    (!leader.contact_email?.trim() || validEmail(leader.contact_email)) &&
    leader.links.every((link) => !link.trim() || webLinkValid(link)) &&
    (rate === null || /^[0-9]{1,15}(?:\.[0-9]{1,2})?$/u.test(rate))
  );
}

export function profileChanges(account: Account, fields: ProfileFields): Update {
  const before = profileFields(account);
  const result: Update = {};

  if (fields.first_name !== before.first_name) result.first_name = fields.first_name.trim();
  if (fields.last_name !== before.last_name) result.last_name = fields.last_name.trim();
  if (fields.phone !== before.phone) result.phone = optionalText(fields.phone);
  if (fields.telegram !== before.telegram) result.telegram = optionalText(fields.telegram);
  if (fields.whatsapp !== before.whatsapp) result.whatsapp = optionalText(fields.whatsapp);

  const leader = fields.leader;
  const previous = before.leader;
  if (!leader || !previous) return result;

  const changes: LeaderUpdate = {};
  if (leader.specializations !== previous.specializations)
    changes.specializations = leader.specializations;
  if (leader.specialization_other !== previous.specialization_other)
    changes.specialization_other = optionalText(leader.specialization_other);
  if (leader.about !== previous.about) changes.about = leader.about;
  if (leader.contact_email !== previous.contact_email)
    changes.contact_email = optionalText(leader.contact_email);
  if (leader.links !== previous.links)
    changes.links = leader.links.map((link) => link.trim()).filter(Boolean);
  if (leader.main_channel !== previous.main_channel) changes.main_channel = leader.main_channel;
  if (leader.default_rate !== previous.default_rate)
    changes.default_rate = normalizeRate(leader.default_rate);
  if (leader.default_currency !== previous.default_currency)
    changes.default_currency = leader.default_currency;

  if (Object.keys(changes).length > 0) result.leader = changes;
  return result;
}
