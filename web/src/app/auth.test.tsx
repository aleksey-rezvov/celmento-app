import { webcrypto } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, type ReactElement } from "react";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import type { Schemas } from "@/lib/api/client";
import { LanguageProvider } from "@/lib/i18n";
import { t, type Language } from "@/lib/i18n/messages";
import {
  clearRegistration,
  closeCode,
  loadCode,
  loadIntent,
  loadPackage,
  loadRegistrationDestination,
  loadSignupEmail,
  saveEmail,
  saveIntent,
  savePackage,
  saveSignupEmail,
  startCode,
} from "@/lib/registration";
import { createRegistrationDeviceKey } from "@/lib/registration-device";
import { getSessionToken, setSessionToken } from "@/lib/session";
import AuthLayout from "./(auth)/layout";
import LoginCode from "./(auth)/login/code/page";
import Login from "./(auth)/login/page";
import Ticket from "./(auth)/login/ticket/page";
import FinishRegistration from "./(auth)/register/finish/page";
import Signup from "./(auth)/register/page";
import Home from "./page";

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));

const world = "https://world-api.example.test";
const ru = "https://ru-api.example.test";
const ruWeb = "https://ru-app.example.test";
const email = "ada@example.com";
const requestedTitle = "Terms of Use";
const consents = [
  { document: "terms_of_use", version: "1" },
  { document: "personal_data_consent", version: "2" },
] satisfies Schemas["ConsentAcceptance"][];

function packageFor(
  publicKey: string,
  intent: Schemas["RegistrationIntent"] = "attend",
  lifetime = 24 * 60 * 60 * 1000,
): Schemas["RegistrationPackage"] {
  return {
    token: "test-registration",
    claims: {
      email,
      first_name: "Ada",
      last_name: "Lovelace",
      consents,
      intent,
      origin: null,
      entry_contour: "world",
      code_confirmed: true,
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + lifetime).toISOString(),
      device_public_key: publicKey,
    },
  };
}

async function saveNewPackage(
  intent?: Schemas["RegistrationIntent"],
): Promise<Schemas["RegistrationPackage"]> {
  const registration = packageFor(await createRegistrationDeviceKey(), intent);
  savePackage(registration);
  return registration;
}

const deviceKeys = new Map<string, CryptoKeyPair>();
const openDeviceDatabase = vi.fn(() => {
  const request = {
    result: {
      close: () => undefined,
      transaction() {
        const transaction = {
          oncomplete: () => undefined,
          objectStore: () => ({
            get: (key: string) => complete(deviceKeys.get(key)),
            put: (pair: CryptoKeyPair, key: string) => {
              deviceKeys.set(key, pair);
              return complete(key);
            },
            delete: (key: string) => {
              deviceKeys.delete(key);
              return complete(undefined);
            },
          }),
        };

        function complete<T>(result: T): { result: T } {
          queueMicrotask(() => transaction.oncomplete());
          return { result };
        }

        return transaction;
      },
    },
    onsuccess: () => undefined,
  };

  queueMicrotask(() => request.onsuccess());
  return request;
});

async function expectDeviceProof(
  request: Request | undefined,
  purpose: string,
  contour: Schemas["Contour"],
  registration: Schemas["RegistrationPackage"],
  selectedContour?: Schemas["Contour"],
): Promise<void> {
  expect(request).toBeDefined();
  const body = await request?.json();
  expect(body).toMatchObject({
    registration_package: registration.token,
    device_proof: expect.stringMatching(/^[A-Za-z0-9_-]{86}$/u),
  });
  const publicKey = await webcrypto.subtle.importKey(
    "spki",
    Buffer.from(registration.claims.device_public_key, "base64url"),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const lines = ["celmento:registration", purpose, contour, registration.token];
  if (selectedContour) lines.push(selectedContour);
  expect(
    await webcrypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      Buffer.from(body.device_proof, "base64url"),
      Buffer.from(lines.join("\n")),
    ),
  ).toBe(true);
}

function json(content: unknown, status = 200): Response {
  return new Response(JSON.stringify(content), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockApi(respond: (request: Request) => Response | Promise<Response>): Request[] {
  const requests: Request[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      requests.push(request.clone());
      return respond(request);
    }),
  );
  return requests;
}

function legalDocument(request: Request): Response {
  const url = new URL(request.url);
  const kind = url.pathname.split("/").at(-1);
  const titles = {
    terms_of_use: requestedTitle,
    personal_data_consent: "Personal Data Consent",
    privacy_policy: "Privacy Policy",
    specialist_offer: "Specialist Terms",
    data_processing_instruction: "Data Processing Instruction",
  } as const;
  if (!kind || !Object.hasOwn(titles, kind)) {
    throw new Error("Unexpected document request.");
  }

  const contour = url.origin === ru ? "ru" : "world";
  const documentKind = kind as keyof typeof titles;
  return json({
    kind,
    contour,
    language: url.searchParams.get("language"),
    title: titles[documentKind],
    version: contour === "ru" ? "ru-v1" : "world-v1",
    text:
      documentKind === "personal_data_consent"
        ? "Read our Privacy Policy for details."
        : "The current version.",
  });
}

function display(ui: ReactElement, language: Language = "en") {
  return render(<LanguageProvider language={language}>{ui}</LanguageProvider>);
}

function changeField(label: string, value: string): void {
  fireEvent.change(screen.getByRole("textbox", { name: label }), { target: { value } });
}

function fillSignup(language: Language = "en"): void {
  changeField(t("signup.first_name", undefined, language), "Ada");
  changeField(t("signup.last_name", undefined, language), "Lovelace");
  fireEvent.click(screen.getByRole("checkbox", { name: t("signup.terms", undefined, language) }));
  fireEvent.click(screen.getByRole("checkbox", { name: t("signup.privacy", undefined, language) }));
}

let browserCryptoKey: unknown;

beforeAll(async () => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
  };

  const pair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
    "verify",
  ]);
  browserCryptoKey = pair.privateKey.constructor;
});

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  window.localStorage.clear();
  clearRegistration();
  deviceKeys.clear();
  openDeviceDatabase.mockClear();
  vi.stubGlobal("indexedDB", { open: openDeviceDatabase });
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("CryptoKey", browserCryptoKey);
  navigation.push.mockReset();
  navigation.replace.mockReset();
  vi.stubEnv("NEXT_PUBLIC_CLM_APP_CONTOUR", "world");
  vi.stubEnv("NEXT_PUBLIC_CLM_APP_API_URL", world);
  vi.stubEnv("NEXT_PUBLIC_CLM_APP_OTHER_ZONE_API_URL", ru);
  vi.stubEnv("NEXT_PUBLIC_CLM_APP_OTHER_ZONE_URL", ruWeb);
  vi.spyOn(navigator, "language", "get").mockReturnValue("en-US");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// spec:test registration-intent-screen#show-intent-choices
// spec:test registration-intent-screen#show-screen-1-0-identically-celmento
// spec:test registration-intent-screen#ask-person-specialist-client-use
// spec:test registration-intent-screen#open-sign-in-after-intent
// spec:test registration-intent-screen#intent-does-not-create-account
// spec:test registration-intent-screen#retain-intent-on-device
test("offers the same two intents on both contours and only goes to sign-in", () => {
  const requests = mockApi(() => {
    throw new Error("Opening sign-in should not call the API.");
  });
  const worldView = render(<Home />);
  expect(screen.getByRole("heading", { name: t("start.title") })).toBeDefined();
  expect(screen.getByText(t("start.lead_hint"))).toBeDefined();
  expect(screen.getByText(t("start.attend_hint"))).toBeDefined();
  const start = screen.getByRole("main").textContent;
  expect(screen.getAllByRole("button")).toHaveLength(2);

  fireEvent.click(screen.getByRole("button", { name: /^Start working with clients/u }));
  expect(loadIntent()).toBe("lead");
  expect(navigation.push).toHaveBeenLastCalledWith("/login");
  worldView.unmount();

  vi.stubEnv("NEXT_PUBLIC_CLM_APP_CONTOUR", "ru");
  render(<Home />);
  expect(screen.getByRole("main").textContent).toBe(start);
  fireEvent.click(screen.getByRole("button", { name: /^I see a specialist/u }));
  expect(loadIntent()).toBe("attend");
  expect(navigation.push).toHaveBeenLastCalledWith("/login");
  expect(requests).toHaveLength(0);
});

// spec:test registration-intent-screen#show-screen-1-0-signed-in-person
test("resumes an unfinished package or a session and returns expired packages to sign-in", async () => {
  const registration = await saveNewPackage();
  const resuming = render(<Home />);
  expect(navigation.replace).toHaveBeenLastCalledWith("/register/finish");
  expect(loadPackage()).toEqual(registration);
  expect(screen.queryByRole("heading")).toBeNull();
  resuming.unmount();

  savePackage(packageFor(registration.claims.device_public_key, "attend", -1000));
  const expired = render(<Home />);
  expect(navigation.replace).toHaveBeenLastCalledWith("/login");
  expect(loadPackage()).toBeNull();
  expired.unmount();

  setSessionToken("test-session");
  render(<Home />);
  expect(navigation.replace).toHaveBeenLastCalledWith("/app");
  expect(screen.queryByRole("heading")).toBeNull();
});

// spec:test interface-language#show-screens-1-0-1-4-device
// spec:test registration-intent-screen#render-screen-1-0-device-language
// spec:test account-registration#render-screen-1-2-device-language
// spec:test registration-finish-screen#render-screen-1-4-device-language
test("chooses the device language for each screen and defaults an unsupported language to English", async () => {
  mockApi((request) =>
    new URL(request.url).pathname.includes("/documents/")
      ? legalDocument(request)
      : json({ login: "ada123", status: "available" } satisfies Schemas["LoginAvailability"]),
  );
  vi.spyOn(navigator, "language", "get").mockReturnValue("ru-RU");
  const root = render(<Home />);
  expect(
    await screen.findByRole("heading", { name: t("start.title", undefined, "ru") }),
  ).toBeDefined();
  root.unmount();
  const login = render(
    <AuthLayout>
      <Login />
    </AuthLayout>,
  );
  expect(
    await screen.findByRole("heading", { name: t("login.title", undefined, "ru") }),
  ).toBeDefined();
  login.unmount();
  saveSignupEmail(email);
  const signup = render(
    <AuthLayout>
      <Signup />
    </AuthLayout>,
  );
  expect(
    await screen.findByRole("heading", { name: t("signup.title", undefined, "ru") }),
  ).toBeDefined();
  signup.unmount();
  startCode(email, null);
  const code = render(
    <AuthLayout>
      <LoginCode />
    </AuthLayout>,
  );
  expect(
    await screen.findByRole("heading", { name: t("code.title_new", undefined, "ru") }),
  ).toBeDefined();
  code.unmount();
  await saveNewPackage();
  const finish = render(
    <AuthLayout>
      <FinishRegistration />
    </AuthLayout>,
  );
  expect(
    await screen.findByRole("heading", { name: t("finish.title", undefined, "ru") }),
  ).toBeDefined();
  expect(document.documentElement.lang).toBe("ru");
  finish.unmount();

  clearRegistration();
  vi.spyOn(navigator, "language", "get").mockReturnValue("sr-Latn");
  render(
    <AuthLayout>
      <Login />
    </AuthLayout>,
  );
  expect(await screen.findByRole("heading", { name: t("login.title") })).toBeDefined();
  expect(document.documentElement.lang).toBe("en");
});

// spec:test email-code-sign-in#show-email-entry
// spec:test email-code-sign-in#show-celmento-login-blue-left
// spec:test character-illustrations#build-sign-in-screen-1-1-two
// spec:test email-code-sign-in#require-valid-email
// spec:test email-code-sign-in#route-unknown-email-to-registration
test("shows the login pair in order, rejects malformed email, and routes an unknown address", async () => {
  const requests = mockApi(() =>
    json({
      outcome: "registration_required",
      first_name: null,
    } satisfies Schemas["SignInCodeRequestResult"]),
  );
  const view = display(<Login />);
  expect(screen.getByRole("heading", { name: t("login.title") })).toBeDefined();
  expect(screen.getByText(t("login.subtitle"))).toBeDefined();
  expect(screen.getByText(t("login.tagline"))).toBeDefined();
  const images = [...view.container.querySelectorAll("picture img")];
  expect(images.map((img) => img.getAttribute("src"))).toEqual([
    "/characters/celmento-login-blue@200px.png",
    "/characters/celmento-login-red@200px.png",
  ]);
  expect(images.map((img) => img.getAttribute("width"))).toEqual(["172", "172"]);
  expect(images[0]?.parentElement?.parentElement?.style.alignItems).toBe("flex-end");

  const submit = screen.getByRole("button", { name: t("login.title") });
  changeField(t("login.email"), "ada@invalid");
  expect(submit).toHaveProperty("disabled", true);
  expect(screen.getByText(t("extra.auth_email_invalid"))).toBeDefined();
  fireEvent.click(submit);
  expect(requests).toHaveLength(0);

  changeField(t("login.email"), "Ada@Example.COM");
  fireEvent.click(submit);
  await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/register"));
  expect(requests).toHaveLength(1);
  expect(await requests[0]?.json()).toEqual({ email, language: "en" });
  expect(loadSignupEmail()).toBe(email);
  expect(loadCode()).toBeNull();
});

// spec:test email-code-sign-in#show-keep-entered-data-code
test("reports the offline login attempt without clearing the email", async () => {
  mockApi(() => {
    throw new TypeError("offline");
  });
  display(<Login />);
  changeField(t("login.email"), email);
  fireEvent.click(screen.getByRole("button", { name: t("login.title") }));
  expect((await screen.findByRole("alert")).textContent).toBe(t("extra.auth_network_error"));
  expect(screen.getByRole("textbox", { name: t("login.email") })).toHaveProperty("value", email);
  expect(navigation.push).not.toHaveBeenCalled();
});

// spec:test email-code-sign-in#reopen-screen-1-1-email-prefilled
// spec:test email-code-sign-in#return-screen-1-1-email-prefilled
test("reopens on the email screen, can resume the valid code, and lets the person change the email", async () => {
  const requests = mockApi(() => {
    throw new Error("A live challenge should be reused.");
  });
  startCode(email, "Ada");
  closeCode();
  const home = render(<Home />);
  expect(navigation.replace).toHaveBeenLastCalledWith("/login");
  home.unmount();

  const login = display(<Login />);
  expect(screen.getByRole("textbox", { name: t("login.email") })).toHaveProperty("value", email);
  fireEvent.click(screen.getByRole("button", { name: t("login.title") }));
  expect(navigation.push).toHaveBeenLastCalledWith("/login/code");
  expect(requests).toHaveLength(0);
  login.unmount();

  display(<LoginCode />);
  expect(
    screen.getByRole("heading", { name: t("code.title_known", { name: "Ada" }) }),
  ).toBeDefined();
  const change = screen.getAllByRole("button", { name: t("code.change_email") });
  expect(change).toHaveLength(2);
  if (change[1]) {
    fireEvent.click(change[1]);
  }
  await waitFor(() => expect(navigation.replace).toHaveBeenLastCalledWith("/login"));
  expect(loadCode()?.email).toBe(email);
});

// spec:test account-registration#offer-separate-registration-entry-point
test("requires an unknown-email lookup before opening signup", () => {
  display(<Signup />);
  expect(navigation.replace).toHaveBeenLastCalledWith("/login");
  expect(screen.queryByRole("heading")).toBeNull();
});

// spec:test account-registration#show-registration-details
// spec:test account-registration#show-two-separate-consent-checkboxes
// spec:test account-registration#gate-registration-submit
// spec:test account-registration#retain-registration-details-on-device
test("shows the editable email, requires both consent boxes, and keeps the versioned draft for the code screen", async () => {
  saveSignupEmail(email);
  saveIntent("lead");
  const requests = mockApi((request) =>
    request.method === "GET"
      ? legalDocument(request)
      : json({
          account_exists: false,
          first_name: null,
        } satisfies Schemas["AccountRegistrationResult"]),
  );
  display(<Signup />);
  expect(screen.getByRole("heading", { name: t("signup.title") })).toBeDefined();
  expect(screen.getByText(t("signup.subtitle"))).toBeDefined();
  const emailField = screen.getByRole("textbox", { name: t("login.email") });
  expect(emailField).toHaveProperty("value", email);
  const terms = screen.getByRole("checkbox", { name: t("signup.terms") });
  const privacy = screen.getByRole("checkbox", { name: t("signup.privacy") });
  const submit = screen.getByRole("button", { name: t("signup.create") });
  expect(terms).toHaveProperty("checked", false);
  expect(privacy).toHaveProperty("checked", false);
  expect(submit).toHaveProperty("disabled", true);

  changeField(t("signup.first_name"), "Ada");
  changeField(t("signup.last_name"), "Lovelace");
  fireEvent.click(terms);
  expect(submit).toHaveProperty("disabled", true);
  fireEvent.click(privacy);
  await waitFor(() => expect(submit).toHaveProperty("disabled", false));
  changeField(t("login.email"), "ada@broken");
  expect(submit).toHaveProperty("disabled", true);
  changeField(t("login.email"), "Ada2@example.com");
  fireEvent.click(submit);

  await waitFor(() => expect(navigation.push).toHaveBeenLastCalledWith("/login/code"));
  const draft = loadCode()?.registration;
  expect(draft).toMatchObject({
    email: "ada2@example.com",
    first_name: "Ada",
    last_name: "Lovelace",
    intent: "lead",
    consents: [
      { document: "terms_of_use", version: "world-v1", accepted_at: expect.any(String) },
      { document: "personal_data_consent", version: "world-v1", accepted_at: expect.any(String) },
    ],
  });
  expect(await requests.find((request) => request.method === "POST")?.json()).toEqual(draft);
});

// spec:test account-registration#make-document-name-inside-checkbox
test("links the terms inside the consent label without losing the person's fields", async () => {
  saveSignupEmail(email);
  mockApi(legalDocument);
  display(<Signup />);
  changeField(t("signup.first_name"), "Ada");
  changeField(t("signup.last_name"), "Lovelace");
  const privacy = screen.getByRole("checkbox", { name: t("signup.privacy") });
  fireEvent.click(privacy);

  fireEvent.click(screen.getByRole("button", { name: t("profile.terms") }));
  expect(await screen.findByRole("heading", { name: requestedTitle })).toBeDefined();
  expect(screen.getByText("world-v1")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: t("extra.auth_close_document") }));

  expect(screen.getByRole("textbox", { name: t("signup.first_name") })).toHaveProperty(
    "value",
    "Ada",
  );
  expect(screen.getByRole("textbox", { name: t("signup.last_name") })).toHaveProperty(
    "value",
    "Lovelace",
  );
  expect(screen.getByRole("textbox", { name: t("login.email") })).toHaveProperty("value", email);
  expect(screen.getByRole("checkbox", { name: t("signup.privacy") })).toHaveProperty(
    "checked",
    true,
  );
  expect(screen.getByRole("checkbox", { name: t("signup.terms") })).toHaveProperty(
    "checked",
    false,
  );
});

// spec:test account-registration#show-other-region-link-create
// spec:test account-registration#open-screen-1-1-other-zone
// spec:test account-registration#return-screen-1-1-entered-email
test("preserves the edited address in the other-zone link and in the local back action", () => {
  saveSignupEmail(email);
  const requests = mockApi(legalDocument);
  const view = display(<Signup />);
  const address = "new@example.com";
  changeField(t("login.email"), address);
  expect(screen.getByText(t("signup.other_region"), { exact: false })).toBeDefined();
  const link = screen.getByRole("link", { name: t("signup.other_region_link") });
  const href = new URL(link.getAttribute("href") ?? "");
  expect(href.origin).toBe(ruWeb);
  expect(href.pathname).toBe("/login");
  expect(href.searchParams.get("email")).toBe(address);
  expect(requests.every((request) => new URL(request.url).origin === world)).toBe(true);

  fireEvent.click(screen.getByRole("button", { name: t("code.change_email") }));
  expect(navigation.replace).toHaveBeenLastCalledWith("/login");
  view.unmount();
  display(<Login />);
  expect(screen.getByRole("textbox", { name: t("login.email") })).toHaveProperty("value", address);
});

// spec:test account-registration#keep-person-screen-1-2-entered
test("preserves all signup values and consent choices after a lost connection", async () => {
  saveSignupEmail(email);
  mockApi((request) => {
    if (request.method === "GET") {
      return legalDocument(request);
    }
    throw new TypeError("offline");
  });
  display(<Signup />);
  fillSignup();
  const submit = screen.getByRole("button", { name: t("signup.create") });
  await waitFor(() => expect(submit).toHaveProperty("disabled", false));
  fireEvent.click(submit);

  expect((await screen.findByRole("alert")).textContent).toBe(t("extra.auth_network_error"));
  expect(screen.getByRole("textbox", { name: t("signup.first_name") })).toHaveProperty(
    "value",
    "Ada",
  );
  expect(screen.getByRole("textbox", { name: t("signup.last_name") })).toHaveProperty(
    "value",
    "Lovelace",
  );
  expect(screen.getByRole("textbox", { name: t("login.email") })).toHaveProperty("value", email);
  expect(screen.getByRole("checkbox", { name: t("signup.terms") })).toHaveProperty("checked", true);
  expect(screen.getByRole("checkbox", { name: t("signup.privacy") })).toHaveProperty(
    "checked",
    true,
  );
  expect(navigation.push).not.toHaveBeenCalled();
});

// spec:test email-code-sign-in#accept-only-digits-code-field
// spec:test email-code-sign-in#support-one-time-code-autofill-email
// spec:test email-code-sign-in#keep-person-screen-1-3-after
// spec:test email-code-sign-in#show-hint-spam-screen-1-3
// spec:test email-code-sign-in#confirm-registration-code
// spec:test registration-finish-screen#sign-device-registration-package
// spec:test registration-finish-screen#reopen-screen-1-4-prefill-without-asking
test("verifies six digits automatically and resumes on the same device using the persisted key", async () => {
  startCode(email, null, {
    email,
    first_name: "Ada",
    last_name: "Lovelace",
    language: "en",
    intent: "attend",
    consents,
  });
  const requests = mockApi(() => json({ code: "code_invalid" }, 400));
  const codeScreen = display(<LoginCode />);
  const input = screen.getByRole("textbox", { name: t("extra.auth_code_input") });
  expect(input.getAttribute("autocomplete")).toBe("one-time-code");
  expect(input.getAttribute("inputmode")).toBe("numeric");
  expect(screen.getByText(t("code.hint_spam"))).toBeDefined();
  fireEvent.change(input, { target: { value: "1a2 3" } });
  expect(input).toHaveProperty("value", "123");
  expect(requests).toHaveLength(0);
  fireEvent.change(input, { target: { value: "1a2b3 4-56" } });
  expect((await screen.findByRole("alert")).textContent).toBe(t("code.error"));
  expect(await requests[0]?.json()).toMatchObject({ email, code: "123456" });
  expect(navigation.replace).not.toHaveBeenCalled();
  expect(input.getAttribute("aria-invalid")).toBe("true");

  const confirmed = mockApi(async (request) => {
    const body = await request.json();
    return json({
      outcome: "registration_confirmed",
      session: null,
      registration_package: packageFor(body.registration_device_key),
    } satisfies Schemas["SignInCodeVerificationResult"]);
  });
  fireEvent.change(input, { target: { value: "654321" } });
  await waitFor(() => expect(navigation.replace).toHaveBeenLastCalledWith("/register/finish"));
  expect(await confirmed[0]?.json()).toMatchObject({
    code: "654321",
    registration_device_key: expect.stringMatching(/^[A-Za-z0-9_-]{122}$/u),
  });
  const registration = loadPackage();
  if (registration === null) {
    throw new Error("Expected the confirmed registration to be stored.");
  }
  expect(deviceKeys.get(registration.claims.device_public_key)?.privateKey.extractable).toBe(false);
  expect(deviceKeys.size).toBe(1);
  codeScreen.unmount();

  const resumed = render(<Home />);
  expect(navigation.replace).toHaveBeenLastCalledWith("/register/finish");
  resumed.unmount();
  const finishRequests = mockApi(() =>
    json({ login: "ada123", status: "available" } satisfies Schemas["LoginAvailability"]),
  );
  display(<FinishRegistration />);
  const login = await screen.findByRole("textbox", { name: t("finish.login") });
  await waitFor(() => expect(login).toHaveProperty("value", "ada123"));
  expect(finishRequests).toHaveLength(1);
  expect(finishRequests[0]?.url).toBe(world + "/api/v1/auth/registration/login-proposal");
  await expectDeviceProof(finishRequests[0], "login-proposal", "world", registration);
});

// spec:test registration-finish-screen#return-to-login-on-expired-package
test("returns expired or copied packages to sign-in without using the registration API", async () => {
  const requests = mockApi(() => {
    throw new Error("Expected no registration requests.");
  });
  const key = await createRegistrationDeviceKey();
  saveEmail(email);
  savePackage(packageFor(key, "attend", -1000));
  const expired = display(<FinishRegistration />);
  expect(navigation.replace).toHaveBeenLastCalledWith("/login");
  expect(loadPackage()).toBeNull();
  expired.unmount();
  navigation.replace.mockClear();

  const copied = packageFor(key);
  savePackage(copied);
  deviceKeys.clear();
  const foreign = display(<FinishRegistration />);
  await waitFor(() => expect(navigation.replace).toHaveBeenLastCalledWith("/login"));
  expect(screen.queryByRole("heading", { name: t("finish.title") })).toBeNull();
  expect(loadPackage()).toBeNull();
  expect(requests).toHaveLength(0);
  foreign.unmount();
  display(<Login />);
  expect(screen.getByRole("textbox", { name: t("login.email") })).toHaveProperty("value", email);
});

test("allows retrying browser storage without discarding a confirmed package", async () => {
  const registration = await saveNewPackage();
  openDeviceDatabase.mockImplementationOnce(() => {
    throw new DOMException("Storage unavailable");
  });
  const requests = mockApi(() =>
    json({ login: "ada123", status: "available" } satisfies Schemas["LoginAvailability"]),
  );
  display(<FinishRegistration />);
  expect((await screen.findByRole("alert")).textContent).toContain(t("extra.auth_request_failed"));
  expect(loadPackage()).toEqual(registration);
  expect(requests).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: t("extra.auth_retry") }));
  const submit = await screen.findByRole("button", { name: t("finish.button") });
  await waitFor(() => expect(submit).toHaveProperty("disabled", false));
  await expectDeviceProof(requests[0], "login-proposal", "world", registration);
});

// spec:test email-code-sign-in#show-expired-send-code-button-entered
test("offers a fresh send after expiration, restarts the resend timer, and clears the old code", async () => {
  const previous = startCode(email, "Ada");
  vi.useFakeTimers();
  vi.setSystemTime(previous.expiresAt + 1000);
  const responses = mockApi(() =>
    json({
      outcome: "code_sent",
      first_name: "Ada",
    } satisfies Schemas["SignInCodeRequestResult"]),
  );
  display(<LoginCode />);
  expect(screen.getByText(t("code.expired"))).toBeDefined();
  expect(screen.getByRole("textbox", { name: t("extra.auth_code_input") })).toHaveProperty(
    "disabled",
    true,
  );
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: t("extra.auth_send_code") }));
  });
  expect(responses.map((request) => new URL(request.url).pathname)).toEqual([
    "/api/v1/auth/code/request",
  ]);
  expect(screen.getByRole("button", { name: /^Send again in \d+ s$/u })).toHaveProperty(
    "disabled",
    true,
  );
  expect(screen.getByRole("textbox", { name: t("extra.auth_code_input") })).toHaveProperty(
    "value",
    "",
  );
});

test("uses the server's retry time when an attempted resend is still rate-limited", async () => {
  const previous = startCode(email, "Ada");
  vi.useFakeTimers();
  vi.setSystemTime(previous.resendAt + 1000);
  const responses = mockApi(() =>
    json(
      {
        code: "resend_too_soon",
        details: { retry_after_seconds: 10 },
      },
      429,
    ),
  );
  display(<LoginCode />);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: t("code.resend") }));
  });
  expect(responses).toHaveLength(1);
  const countdown = screen.getByRole("button", { name: t("code.resend_timer", { sec: 10 }) });
  expect(countdown).toHaveProperty("disabled", true);
  await act(async () => {
    vi.advanceTimersByTime(10_000);
  });
  expect(screen.getByRole("button", { name: t("code.resend") })).toHaveProperty("disabled", false);
});

test("returns to the consent form with names preserved when an expired registration needs new marks", async () => {
  const previous = startCode(email, null, {
    email,
    language: "en",
    first_name: "Ada",
    last_name: "Lovelace",
    consents: [{ document: "terms_of_use", version: "previous" }],
  });
  vi.useFakeTimers();
  vi.setSystemTime(previous.expiresAt + 1000);
  const requests = mockApi((request) =>
    new URL(request.url).pathname.includes("/documents/")
      ? legalDocument(request)
      : json({ code: "consent_required" }, 400),
  );
  const codeView = display(<LoginCode />);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: t("extra.auth_send_code") }));
  });
  expect(requests[0]?.url).toContain("/auth/register");
  expect(navigation.replace).toHaveBeenLastCalledWith("/register");
  codeView.unmount();
  vi.useRealTimers();

  display(<Signup />);
  expect(screen.getByRole("textbox", { name: t("signup.first_name") })).toHaveProperty(
    "value",
    "Ada",
  );
  expect(screen.getByRole("textbox", { name: t("signup.last_name") })).toHaveProperty(
    "value",
    "Lovelace",
  );
  expect(screen.getByRole("textbox", { name: t("login.email") })).toHaveProperty("value", email);
  expect(screen.getByRole("checkbox", { name: t("signup.terms") })).toHaveProperty(
    "checked",
    false,
  );
  expect(screen.getByRole("checkbox", { name: t("signup.privacy") })).toHaveProperty(
    "checked",
    false,
  );
  expect(screen.getByRole("button", { name: t("signup.create") })).toHaveProperty("disabled", true);
});

// spec:test registration-finish-screen#show-finish-after-code
// spec:test registration-finish-screen#show-celmento-master-blue-celmento-master-red
// spec:test character-illustrations#show-celmento-master-blue-celmento-master-red
// spec:test registration-finish-screen#show-age-checkbox-age-question
// spec:test region-contours#show-region-field-region-screen
test("renders the finish form in the entry region and omits the activation questions for attend", async () => {
  await saveNewPackage();
  mockApi(() =>
    json({ login: "ada123", status: "available" } satisfies Schemas["LoginAvailability"]),
  );
  const view = display(<FinishRegistration />);
  expect(await screen.findByRole("heading", { name: t("finish.title") })).toBeDefined();
  expect(screen.getByText(t("finish.subtitle"))).toBeDefined();
  expect(screen.getByRole("combobox", { name: t("finish.region") })).toHaveProperty(
    "value",
    "world",
  );
  expect(screen.getByRole("option", { name: t("finish.region_world") })).toBeDefined();
  expect(screen.getByRole("option", { name: t("finish.region_ru") })).toBeDefined();
  expect(screen.getByText(t("finish.login_hint"))).toBeDefined();
  expect(screen.queryByRole("checkbox", { name: t("finish.age") })).toBeNull();
  expect(
    [...view.container.querySelectorAll("picture img")].map((img) => img.getAttribute("src")),
  ).toEqual([
    "/characters/celmento-master-blue@200px.png",
    "/characters/celmento-master-red@200px.png",
  ]);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: t("finish.button") })).toHaveProperty(
      "disabled",
      false,
    ),
  );
});

// spec:test registration-finish-screen#show-age-specialist-terms-two-separate
// spec:test registration-finish-screen#keep-button-disabled-shown-activation
// spec:test registration-finish-screen#show-login-taken-now-keep-other-value
test("requires both activation controls and preserves them when the server reports a late login conflict", async () => {
  await saveNewPackage("lead");
  const requests = mockApi((request) =>
    request.method === "GET"
      ? legalDocument(request)
      : new URL(request.url).pathname.endsWith("/finish")
        ? json({ code: "login_taken" }, 409)
        : json({ login: "ada123", status: "available" } satisfies Schemas["LoginAvailability"]),
  );
  display(<FinishRegistration />);
  const submit = await screen.findByRole("button", { name: t("finish.button") });
  const age = screen.getByRole("checkbox", { name: t("finish.age") });
  const terms = screen.getByRole("checkbox", { name: t("finish.specialist_terms") });
  expect(age).toHaveProperty("checked", false);
  expect(terms).toHaveProperty("checked", false);
  fireEvent.click(age);
  expect(submit).toHaveProperty("disabled", true);
  fireEvent.click(terms);
  await waitFor(() => expect(submit).toHaveProperty("disabled", false));

  fireEvent.click(submit);
  expect((await screen.findByRole("alert")).textContent).toBe(t("finish.login_taken_now"));
  const request = requests.find((entry) => new URL(entry.url).pathname.endsWith("/finish"));
  expect(await request?.json()).toMatchObject({
    activation: {
      age_confirmed: true,
      acceptances: [
        { document: "specialist_offer", version: "world-v1" },
        { document: "data_processing_instruction", version: "world-v1" },
      ],
    },
  });
  expect(age).toHaveProperty("checked", true);
  expect(terms).toHaveProperty("checked", true);
  expect(submit).toHaveProperty("disabled", true);
  expect(navigation.replace).not.toHaveBeenCalled();
});

// spec:test registration-finish-screen#require-available-login
// spec:test registration-finish-screen#validate-login-as-typed
test("checks the typed login against the selected region and waits for its own verdict", async () => {
  const registration = await saveNewPackage();
  const requests = mockApi((request) => {
    const path = new URL(request.url).pathname;
    return path.endsWith("login-proposal")
      ? json({ login: "ada123", status: "available" } satisfies Schemas["LoginAvailability"])
      : json({ login: "1ada234", status: "rule_start" } satisfies Schemas["LoginAvailability"]);
  });
  display(<FinishRegistration />);
  const submit = await screen.findByRole("button", { name: t("finish.button") });
  await waitFor(() => expect(submit).toHaveProperty("disabled", false));
  const input = screen.getByRole("textbox", { name: t("finish.login") });
  fireEvent.change(input, { target: { value: "1ada234" } });
  expect(submit).toHaveProperty("disabled", true);
  const rule = await screen.findByRole("status");
  expect(rule.textContent).toBe(t("profile.login_rule_start"));
  expect(submit).toHaveProperty("disabled", true);
  const check = requests.find((request) =>
    new URL(request.url).pathname.endsWith("login-availability"),
  );
  expect(check?.url).toBe(world + "/api/v1/auth/registration/login-availability");
  expect(await check?.clone().json()).toMatchObject({ login: "1ada234" });
  await expectDeviceProof(check, "login-availability", "world", registration);
});

// spec:test region-contours#show-region-field-hint-selected
// spec:test region-contours#create-account-directly-selected-contour
// spec:test region-contours#sign-in-on-selected-domain
// spec:test registration-finish-screen#show-terms-privacy-unchecked-linked
// spec:test registration-finish-screen#move-person-selected-contour-domain
test("uses the selected contour's documents and creation endpoint and follows the returned recognized ticket", async () => {
  window.history.replaceState(null, "", "/login/ticket");
  vi.stubEnv("NEXT_PUBLIC_CLM_APP_OTHER_ZONE_URL", window.location.origin);
  const registration = await saveNewPackage();
  const requests = mockApi((request) => {
    const path = new URL(request.url).pathname;
    if (request.method === "GET") {
      return legalDocument(request);
    }
    if (path.endsWith("/handoff")) return json({ handoff: "test-handoff" });
    if (path.endsWith("/finish")) {
      return json(
        {
          outcome: "ticket",
          session: null,
          ticket: {
            ticket: "test-ticket",
            ticket_url: window.location.origin + "/login/ticket#ticket=test-ticket",
            expires_at: new Date(Date.now() + 120_000).toISOString(),
          },
        } satisfies Schemas["FinishRegistrationResult"],
        201,
      );
    }
    return json({ login: "ada123", status: "available" } satisfies Schemas["LoginAvailability"]);
  });
  display(<FinishRegistration />);
  expect(await screen.findByText(t("finish.region_hint_world"))).toBeDefined();
  const region = screen.getByRole("combobox", { name: t("finish.region") });
  fireEvent.change(region, { target: { value: "ru" } });
  expect(screen.getByText(t("finish.region_hint_ru"))).toBeDefined();
  expect(screen.getByText(t("finish.region_warning"))).toBeDefined();

  const terms = screen.getByRole("checkbox", { name: t("signup.terms") });
  const privacy = screen.getByRole("checkbox", { name: t("signup.privacy") });
  const submit = screen.getByRole("button", { name: t("finish.button") });
  expect(terms).toHaveProperty("checked", false);
  expect(privacy).toHaveProperty("checked", false);
  expect(submit).toHaveProperty("disabled", true);
  expect(requests.some((entry) => new URL(entry.url).pathname.endsWith("/handoff"))).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: t("profile.terms") }));
  expect(await screen.findByText("ru-v1")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: t("extra.auth_close_document") }));
  fireEvent.click(terms);
  fireEvent.click(privacy);
  await waitFor(() => expect(submit).toHaveProperty("disabled", false));
  fireEvent.click(submit);

  await waitFor(() => expect(window.location.hash).toBe("#ticket=test-ticket"));
  const authorize = requests.find((entry) => new URL(entry.url).pathname.endsWith("/handoff"));
  expect(authorize?.url).toBe(world + "/api/v1/auth/registration/handoff");
  expect(await authorize?.clone().json()).toMatchObject({ selected_contour: "ru" });
  await expectDeviceProof(authorize, "handoff", "world", registration, "ru");
  const finish = requests.find((entry) => new URL(entry.url).pathname.endsWith("/finish"));
  expect(finish?.url).toBe(ru + "/api/v1/auth/registration/finish");
  expect(await finish?.clone().json()).toMatchObject({
    consents: [
      { document: "terms_of_use", version: "ru-v1" },
      { document: "personal_data_consent", version: "ru-v1" },
    ],
    handoff: "test-handoff",
    notify_specialist: false,
  });
  await expectDeviceProof(finish, "finish", "ru", registration);
  expect(loadPackage()).toBeNull();
  expect(deviceKeys.has(registration.claims.device_public_key)).toBe(false);
});

test("keeps the authorized contour and retries its finish after reloading without another issuer request", async () => {
  const registration = await saveNewPackage();
  const finishes: Request[] = [];
  const requests = mockApi((request) => {
    const path = new URL(request.url).pathname;
    if (request.method === "GET") return legalDocument(request);
    if (path.endsWith("/handoff")) return json({ handoff: "authorized-once" });
    if (path.endsWith("/finish")) {
      finishes.push(request.clone());
      if (finishes.length === 1) throw new TypeError("Connection lost");
      return json({ code: "login_taken" }, 409);
    }
    return json({ login: "ada123", status: "available" });
  });
  function confirmTerms(): void {
    fireEvent.click(screen.getByRole("checkbox", { name: t("signup.terms") }));
    fireEvent.click(screen.getByRole("checkbox", { name: t("signup.privacy") }));
  }
  const first = display(<FinishRegistration />);
  const choice = await screen.findByRole("combobox", { name: t("finish.region") });
  fireEvent.change(choice, { target: { value: "ru" } });
  confirmTerms();
  const submit = screen.getByRole("button", { name: t("finish.button") });
  await waitFor(() => expect(submit).toHaveProperty("disabled", false));
  fireEvent.click(submit);
  await screen.findByText(t("extra.auth_network_error"));
  expect(loadRegistrationDestination(registration)).toEqual({
    contour: "ru",
    handoff: "authorized-once",
  });
  first.unmount();

  display(<FinishRegistration />);
  const pinned = await screen.findByRole("combobox", { name: t("finish.region") });
  expect(pinned).toHaveProperty("value", "ru");
  expect(pinned).toHaveProperty("disabled", true);
  confirmTerms();
  const retry = screen.getByRole("button", { name: t("finish.button") });
  await waitFor(() => expect(retry).toHaveProperty("disabled", false));
  fireEvent.click(retry);
  await screen.findByText(t("finish.login_taken_now"));
  expect(requests.filter((entry) => new URL(entry.url).pathname.endsWith("/handoff"))).toHaveLength(
    1,
  );
  expect(finishes.map((entry) => entry.url)).toEqual(
    Array(2).fill(ru + "/api/v1/auth/registration/finish"),
  );
  for (const request of finishes) {
    expect(await request.json()).toMatchObject({ handoff: "authorized-once" });
  }
});

test("scrubs the fragment and exchanges a fresh ticket only once under strict-effect replay", async () => {
  window.history.replaceState(null, "", "/login/ticket#ticket=test-ticket");
  const requests = mockApi(() => json({ token: "test-session" }));
  display(
    <StrictMode>
      <Ticket />
    </StrictMode>,
  );

  await waitFor(() => expect(navigation.replace).toHaveBeenLastCalledWith("/app"));
  expect(window.location.hash).toBe("");
  expect(requests).toHaveLength(1);
  expect(requests[0]?.url).toBe(world + "/api/v1/auth/tickets/exchange");
  expect(await requests[0]?.json()).toEqual({ ticket: "test-ticket" });
  expect(getSessionToken()).toBe("test-session");
});

test("returns an invalid ticket to sign-in without storing a session", async () => {
  window.history.replaceState(null, "", "/login/ticket#ticket=test-ticket");
  mockApi(() => json({ code: "ticket_invalid" }, 400));
  display(<Ticket />);
  await waitFor(() => expect(navigation.replace).toHaveBeenLastCalledWith("/login"));
  expect(window.location.hash).toBe("");
  expect(getSessionToken()).toBeNull();
});
