export interface CharacterPlacement {
  readonly files: readonly string[];
  readonly stateFile?: string;
  readonly color: "blue" | "red" | "both";
  readonly emotion: "curiosity" | "surprise" | "joy" | "thoughtfulness" | "calm" | "gratitude";
}

const masterBlue = ["celmento-master-blue"] as const;
const masterRed = ["celmento-master-red"] as const;
const masterPair = [...masterBlue, ...masterRed] as const;
const availableFiles = new Set(process.env.NEXT_PUBLIC_CLM_APP_CHARACTER_SETS?.split(",") ?? []);

export const PLACEMENT = {
  login_pair: {
    files: ["celmento-login-blue", "celmento-login-red"],
    color: "both",
    emotion: "curiosity",
  },
  signup: { files: masterRed, stateFile: "celmento-signup", color: "red", emotion: "surprise" },
  code: { files: masterBlue, stateFile: "celmento-code", color: "blue", emotion: "joy" },
  code_error: {
    files: masterBlue,
    stateFile: "celmento-error",
    color: "blue",
    emotion: "thoughtfulness",
  },
  finish_pair: {
    files: masterPair,
    stateFile: "celmento-finish",
    color: "both",
    emotion: "curiosity",
  },
  feedback_thanks: {
    files: masterRed,
    stateFile: "celmento-thanks",
    color: "red",
    emotion: "joy",
  },
  meetings_empty_day: { files: masterBlue, color: "blue", emotion: "calm" },
  meetings_today_empty: { files: masterBlue, color: "blue", emotion: "calm" },
  meetings_need_outcome_empty: { files: masterBlue, color: "blue", emotion: "joy" },
  outcome_saved: { files: masterBlue, color: "blue", emotion: "joy" },
  outcome_not_taken_place: { files: masterRed, color: "red", emotion: "thoughtfulness" },
  clients_empty: {
    files: masterRed,
    stateFile: "celmento-empty-clients",
    color: "red",
    emotion: "surprise",
  },
  clients_archive_empty: {
    files: masterBlue,
    stateFile: "celmento-empty-archive",
    color: "blue",
    emotion: "calm",
  },
  clients_archive_confirm: {
    files: masterBlue,
    stateFile: "celmento-archive-confirm",
    color: "blue",
    emotion: "calm",
  },
  clients_not_found: {
    files: masterRed,
    stateFile: "celmento-not-found",
    color: "red",
    emotion: "thoughtfulness",
  },
  notes_not_found: {
    files: masterRed,
    stateFile: "celmento-not-found",
    color: "red",
    emotion: "thoughtfulness",
  },
  client_no_meetings: { files: masterBlue, color: "blue", emotion: "curiosity" },
  payment_saved: { files: masterBlue, color: "blue", emotion: "joy" },
  notes_empty: {
    files: masterBlue,
    stateFile: "celmento-empty-notes",
    color: "blue",
    emotion: "calm",
  },
  notes_empty_shared: { files: masterBlue, color: "blue", emotion: "calm" },
  notes_folder_empty: { files: masterBlue, color: "blue", emotion: "calm" },
  notes_share_confirm: { files: masterBlue, color: "blue", emotion: "joy" },
  records_empty: { files: masterBlue, color: "blue", emotion: "curiosity" },
  public_booking: { files: masterBlue, color: "blue", emotion: "curiosity" },
  booking_done: {
    files: masterBlue,
    stateFile: "celmento-booked",
    color: "blue",
    emotion: "joy",
  },
  booking_unavailable: {
    files: masterRed,
    stateFile: "celmento-unavailable",
    color: "red",
    emotion: "thoughtfulness",
  },
  public_not_found: {
    files: masterRed,
    stateFile: "celmento-404",
    color: "red",
    emotion: "surprise",
  },
  meeting_invite: {
    files: masterBlue,
    stateFile: "celmento-meet",
    color: "blue",
    emotion: "calm",
  },
  meeting_not_found: {
    files: masterBlue,
    stateFile: "celmento-meet-404",
    color: "blue",
    emotion: "thoughtfulness",
  },
  specialists_empty: {
    files: masterRed,
    stateFile: "celmento-empty-specialists",
    color: "red",
    emotion: "calm",
  },
  attendee_meetings_empty: {
    files: masterRed,
    stateFile: "celmento-empty-specialists",
    color: "red",
    emotion: "calm",
  },
  plan_limit_pair: {
    files: masterPair,
    stateFile: "celmento-limit",
    color: "both",
    emotion: "thoughtfulness",
  },
  plans_thanks: { files: masterBlue, color: "blue", emotion: "joy" },
} as const satisfies Readonly<Record<string, CharacterPlacement>>;

export type CharacterState = keyof typeof PLACEMENT;

export function characterFiles(
  state: CharacterState,
  available: ReadonlySet<string> = availableFiles,
): readonly string[] {
  const { files, stateFile }: CharacterPlacement = PLACEMENT[state];

  // spec:impl character-illustrations#state-image-with-master-fallback
  return stateFile && available.has(stateFile) ? [stateFile] : files;
}
