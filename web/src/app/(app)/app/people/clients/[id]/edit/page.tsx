"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import { useClientPhoto } from "@/components/clients/ClientAvatar";
import { PaymentTypeChips, isZeroClientRate } from "@/components/clients/PaymentTypeChips";
import {
  RateCurrencyFields,
  normalizeClientRate,
  validRateInput,
} from "@/components/clients/RateCurrencyFields";
import {
  ClientCardScreen,
  ClientScreen,
  clientPath,
} from "@/components/clients/card/ClientCardScreen";
import {
  availableContacts,
  contactFields,
  contactNames,
} from "@/components/clients/card/ContactsBlock";
import { PrivateTitle } from "@/components/clients/card/PrivateTextBlock";
import { cents } from "@/components/clients/card/card-money";
import { PhotoPicker, type PendingPhoto } from "@/components/profile/PhotoPicker";
import { useProfileLeaveGuard } from "@/components/profile/ProfileLeaveGuard";
import { apiClient, type Schemas } from "@/lib/api/client";
import { useTranslation, type MessageKey } from "@/lib/i18n";
import { getSessionToken } from "@/lib/session";

type Card = Schemas["ClientCard"];
type Update = Schemas["ClientUpdate"];

const privateFields = [
  { name: "request", label: "client.request", hint: "client.request_hint" },
  { name: "goals", label: "client.goals", hint: "client.goals_hint" },
  { name: "info", label: "client.info", hint: "client.info_hint" },
  { name: "hypotheses", label: "client.hypotheses", hint: "client.hypotheses_hint" },
] as const satisfies readonly { name: keyof Update; label: MessageKey; hint: MessageKey }[];

type TextKey = (typeof privateFields)[number]["name"] | (typeof contactNames)[number];

interface Draft extends Pick<Card, TextKey | "name" | "currency" | "preferred_channel"> {
  rate: string;
  payment_type: Schemas["PaymentType"] | null;
}

function draftFrom(card: Card): Draft {
  const {
    name,
    phone,
    email,
    telegram,
    whatsapp,
    other_contact,
    preferred_channel,
    rate,
    currency,
    request,
    goals,
    info,
    hypotheses,
    payment_type,
  } = card;
  return {
    name,
    phone,
    email,
    telegram,
    whatsapp,
    other_contact,
    preferred_channel,
    rate: rate ?? "",
    currency,
    request,
    goals,
    info,
    hypotheses,
    payment_type,
  };
}

function editChanges(draft: Draft, card: Card): Update {
  const changes: Update = {};
  if (draft.name.trim() !== card.name) changes.name = draft.name.trim();
  for (const field of contactNames) {
    if (draft[field] !== card[field]) changes[field] = draft[field] || null;
  }
  for (const { name } of privateFields) {
    if (draft[name] !== card[name]) changes[name] = draft[name] || null;
  }
  if (draft.preferred_channel !== card.preferred_channel)
    changes.preferred_channel = draft.preferred_channel;
  if (draft.currency !== card.currency) changes.currency = draft.currency;
  const rate = normalizeClientRate(draft.rate);
  if (rate !== card.rate || changes.currency) changes.rate = rate;
  if (draft.payment_type !== null && draft.payment_type !== card.payment_type)
    changes.payment_type = draft.payment_type;
  return changes;
}

async function savePhoto(cardId: string, photo: PendingPhoto | null): Promise<Card> {
  const api = apiClient(getSessionToken());
  const params = { path: { client_id: cardId } };
  const result = photo
    ? await api.PUT("/clients/{client_id}/photo", {
        params,
        body: { file: "client.png" },
        bodySerializer: ({ file }) => {
          const form = new FormData();
          form.set("file", photo.blob, file);
          return form;
        },
      })
    : await api.DELETE("/clients/{client_id}/photo", { params });
  if (!result.data) throw new Error("Client photo update failed.");
  return result.data;
}

interface EditorProps {
  card: Card;
  onChanged: (card: Card) => void;
}

function ClientEditor({ card, onChanged }: EditorProps): ReactElement {
  const t = useTranslation();
  const router = useRouter();
  const href = clientPath(card.id);
  const [draft, setDraft] = useState(() => draftFrom(card));
  const [photo, setPhoto] = useState<PendingPhoto | null>();
  const existingPhoto = useClientPhoto(card.id, card.photo_url);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const currencyChanged = draft.currency !== card.currency;
  const balance = card.balance.balance;
  const locked = cents(balance.amount) !== 0n;
  const contacts = availableContacts(draft);
  const changes = editChanges(draft, card);
  const dirty =
    Object.keys(changes).length > 0 || draft.payment_type === null || photo !== undefined;
  const valid =
    Boolean(draft.name.trim()) &&
    validRateInput(draft.rate) &&
    (!currencyChanged || (!locked && normalizeClientRate(draft.rate) !== null)) &&
    draft.payment_type !== null &&
    (!isZeroClientRate(draft.rate) || draft.payment_type !== "paid");

  useEffect(() => {
    const target = window.location.hash.slice(1);
    if (target) document.getElementById(target)?.scrollIntoView({ block: "start" });
  }, []);

  function onFieldChange(field: TextKey, value: string): void {
    setDraft((current) => {
      const next = { ...current, [field]: value };
      if (
        next.preferred_channel &&
        !availableContacts(next).some(
          (name) => contactFields[name].channel === next.preferred_channel,
        )
      ) {
        next.preferred_channel = null;
      }
      return next;
    });
  }

  async function save(): Promise<boolean> {
    if (!valid || saving || photoBusy || card.status !== "active") return false;

    setSaving(true);
    setError(null);
    try {
      if (Object.keys(changes).length > 0) {
        const { data } = await apiClient(getSessionToken()).PATCH("/clients/{client_id}", {
          params: { path: { client_id: card.id } },
          body: changes,
        });
        if (!data) {
          setError("extra.auth_request_failed");
          return false;
        }
        onChanged(data);
        setDraft(draftFrom(data));
      }

      if (photo !== undefined) {
        onChanged(await savePhoto(card.id, photo));
        setPhoto(undefined);
      }
      return true;
    } catch {
      setError("extra.auth_network_error");
      return false;
    } finally {
      setSaving(false);
    }
  }

  const leave = useProfileLeaveGuard({ dirty, saving: saving || photoBusy, valid, save });
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void save().then((saved) => {
      if (saved) router.replace(href);
    });
  }

  if (card.status !== "active") {
    return (
      <ClientScreen title={card.name} back={href}>
        <p>{t("clients.in_archive")}</p>
      </ClientScreen>
    );
  }

  const names = draft.name.trim().split(/\s+/u);
  return (
    <ClientScreen title={t("card.edit")} back={href}>
      {/* spec:impl client-card-view-edit#open-screen-6-2-name-photo */}
      <form className="client-form" onSubmit={submit}>
        <fieldset disabled={saving} className="client-form-fields">
          <div className="client-edit-photo">
            <PhotoPicker
              existing={existingPhoto}
              hasExisting={card.photo_url !== null}
              firstName={names[0] ?? ""}
              lastName={names.length > 1 ? (names.at(-1) ?? "") : ""}
              pending={photo}
              onChange={setPhoto}
              busy={photoBusy || saving}
              onBusyChange={setPhotoBusy}
            />
          </div>
          <div className="shell-field-group">
            <label className="client-field">
              <span>{t("new.name")}</span>
              <input
                required
                autoComplete="off"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })}
              />
            </label>
          </div>
          <section className="client-block" id="contacts">
            <PrivateTitle title={t("client.contacts_title")} />
            <p className="client-hint">{t("client.contacts_hint")}</p>
            {/* spec:impl client-card-view-edit#accept-reference-contact-screen-6-2 */}
            {contactNames.map((field) => (
              <label className="client-field" key={field}>
                <span>{t(contactFields[field].label)}</span>
                <input
                  type="text"
                  autoComplete="off"
                  value={draft[field] ?? ""}
                  onChange={(event) => onFieldChange(field, event.currentTarget.value)}
                />
              </label>
            ))}
            <label className="client-field">
              <span>{t("client.preferred_channel")}</span>
              <select
                value={draft.preferred_channel ?? ""}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    preferred_channel:
                      contacts
                        .map((field) => contactFields[field].channel)
                        .find((channel) => channel === event.currentTarget.value) ?? null,
                  })
                }
              >
                <option value="">—</option>
                {contacts.map((field) => (
                  <option key={field} value={contactFields[field].channel}>
                    {t(contactFields[field].label)}
                  </option>
                ))}
              </select>
            </label>
          </section>
          <div className="client-block" id="rate">
            {/* spec:impl client-rate-currency#offer-screen-6-2-rate-number */}
            {/* spec:impl client-rate-currency#allow-changing-currency-screen-6-2 */}
            <RateCurrencyFields
              rate={draft.rate}
              currency={draft.currency}
              lockedBalance={locked ? balance : undefined}
              currencyChanged={currencyChanged}
              onRateChange={(rate) =>
                setDraft({
                  ...draft,
                  rate,
                  payment_type:
                    draft.payment_type === "paid" && isZeroClientRate(rate)
                      ? null
                      : draft.payment_type,
                })
              }
              onCurrencyChange={(currency) => {
                if (currency !== draft.currency)
                  setDraft({
                    ...draft,
                    currency,
                    rate: currency === card.currency ? (card.rate ?? "") : "",
                  });
              }}
            />
            {/* spec:impl client-rate-currency#offer-screen-6-2-payment-type */}
            <PaymentTypeChips
              price={draft.rate}
              value={draft.payment_type}
              onChange={(payment_type) => setDraft({ ...draft, payment_type })}
            />
          </div>
          {/* spec:impl client-card-view-edit#offer-screen-6-2-fields-request */}
          {privateFields.map(({ name, label, hint }) => (
            <section className="client-block" key={name} id={name}>
              <PrivateTitle title={t(label)} />
              <textarea
                className="client-private-input"
                aria-label={t(label)}
                placeholder={t(hint)}
                value={draft[name] ?? ""}
                rows={3}
                onChange={(event) => onFieldChange(name, event.currentTarget.value)}
              />
            </section>
          ))}
        </fieldset>
        {error && (
          <p className="client-error" role="alert">
            {t(error)}
          </p>
        )}
        <button className="shell-primary" type="submit" disabled={!valid || saving || photoBusy}>
          {t("extra.client_save")}
        </button>
      </form>
      {leave.sheet}
    </ClientScreen>
  );
}

export default function ClientEditPage(): ReactElement {
  const { id } = useParams<{ id: string }>();
  return (
    <ClientCardScreen clientId={id}>
      {({ card, setCard }) => <ClientEditor key={card.id} card={card} onChanged={setCard} />}
    </ClientCardScreen>
  );
}
