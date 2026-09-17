/**
 * Hands-free voice mode: what the phone should say next, and what the worker's spoken reply
 * means. Pure and deterministic (no model call), so web, native, and server code can all use it.
 * Per-field wording lives beside the catalog in `./log-form`.
 */
import { requiredCoreLogFields, requiredLogDetailKeys, spokenAsk, spokenUnit, type LogDetails, type ResolvedLogForm } from "./log-form";

export type VoiceStatus = "needs_fields" | "ready_to_confirm";
export type VoiceGuidance = {
  status: VoiceStatus;
  /** One short sentence for text-to-speech. */
  prompt: string;
  /** Every required fact still unknown: core keys first, then the activity's detail keys. */
  missingFields: string[];
};
export type VoiceIntent = "save" | "change" | "cancel" | "unclear";
export type VoiceConfirmResult = { transcript: string; intent: VoiceIntent };
export type VoiceConfirmResponse = { data: VoiceConfirmResult };
export type SpeechRequest = { text: string };
export const MAX_SPEECH_CHARS = 600;
export const VOICE_CONFIRM_SUFFIX = "Say save, or tell me what to change.";

/** The part of an extracted log the voice mode reads; `ExtractedLogFields` satisfies it. */
export type VoiceLogFields = {
  fieldId: string | null; activity: string | null; workDate: string | null;
  startTime: string | null; endTime: string | null; tags?: readonly string[]; details: LogDetails;
};
export type VoiceContext = { fields: readonly { id: string; name: string }[]; form: ResolvedLogForm };

/** Required core facts that are null, then required details of the chosen activity with no value. */
export function missingLogFields(fields: VoiceLogFields, form: ResolvedLogForm): string[] {
  const core = requiredCoreLogFields.filter(key => fields[key] === null);
  const details = fields.activity ? requiredLogDetailKeys(form, fields.activity).filter(key => fields.details[key] === undefined) : [];
  return [...core, ...details];
}

const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const sentence = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
/** "FIELD A" is read letter by letter by speech engines; "Field A" is not. */
const spokenName = (name: string) => name.replace(/\b[A-Z]{2,}\b/g, word => word.charAt(0) + word.slice(1).toLowerCase());
function spokenDate(date: string) {
  const [, month, day] = date.split("-").map(Number);
  return `${months[month - 1]} ${day}`;
}
function spokenTime(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return `${hour % 12 || 12}${minute ? `:${String(minute).padStart(2, "0")}` : ""} ${hour < 12 ? "AM" : "PM"}`;
}

function askPrompt(missing: string[], fields: VoiceLogFields, form: ResolvedLogForm) {
  const defs = fields.activity ? form[fields.activity]?.fields ?? [] : [];
  // A quantity question is answered with its unit, so the unit is not asked for separately.
  const units = new Set(defs.filter(field => field.unitKey && missing.includes(field.key)).map(field => field.unitKey));
  const asks = missing.filter(key => !units.has(key)).slice(0, 2).map(key => spokenAsk(key, fields.activity, defs.find(field => field.key === key)));
  return `${sentence(asks.join(", and "))}?`;
}

function readBack(fields: VoiceLogFields, context: VoiceContext) {
  const field = context.fields.find(item => item.id === fields.fieldId);
  const parts = [`${fields.activity} in ${spokenName(field?.name ?? "the selected field")} on ${spokenDate(fields.workDate!)}, from ${spokenTime(fields.startTime!)} to ${spokenTime(fields.endTime!)}.`];
  const defs = context.form[fields.activity!]?.fields ?? [];
  const unitKeys = new Set(defs.map(item => item.unitKey).filter(Boolean));
  const details = defs.filter(item => !unitKeys.has(item.key) && fields.details[item.key] !== undefined).map(item => {
    const unit = item.unitKey ? fields.details[item.unitKey] : undefined;
    const value = `${fields.details[item.key]}${unit === undefined ? "" : ` ${spokenUnit(String(unit))}`}`;
    // The item and its quantity read naturally without labels: "Neem oil, 2 liters".
    return item.key === "product" || item.key === "amount" ? value : `${item.label.replace(/\s*\(.*?\)/g, "").toLowerCase()} ${value}`;
  });
  if (details.length) parts.push(`${sentence(details.join(", "))}.`);
  if (fields.tags?.length) parts.push(`Tagged ${fields.tags.join(" and ").toLowerCase()}.`);
  return [...parts, VOICE_CONFIRM_SUFFIX].join(" ");
}

export function buildVoiceGuidance(fields: VoiceLogFields, context: VoiceContext): VoiceGuidance {
  const missingFields = missingLogFields(fields, context.form);
  return missingFields.length
    ? { status: "needs_fields", prompt: askPrompt(missingFields, fields, context.form), missingFields }
    : { status: "ready_to_confirm", prompt: readBack(fields, context), missingFields };
}

const CANCEL = /\b(cancel|never ?mind|forget (it|this|that|about it)|discard|delete (it|this|that)|scrap (it|this|that)|throw (it|this|that) (away|out)|(don't|do not|dont) save|start over)\b/g;
const NO_CHANGE = /\b(no|without) changes?\b|\bnothing to change\b|\b(don't|do not|dont) change (anything|it|a thing)\b|\bno need to change\b/g;
const CHANGE = /\b(change|update|fix|edit|adjust|actually|instead|wrong|incorrect|not (right|correct)|correction|correct (the|that|my|it)|should (be|have been)|supposed to be|it was|i meant|make (it|that|the)|set (it|the)|add|remove|replace|switch)\b/;
const SAVE = /\b(save|submit|confirm|confirmed|correct|yes|yeah|yep|yup|sure|ok|okay|perfect|done|go ahead|send it|looks (good|right|fine)|sounds (good|right|fine)|all (good|set)|(that's|that is|thats|it's|its) (right|good|fine|it))\b/;
const FACTS = /\d|\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|noon|midnight|field|time|date|start|started|end|ended|finish|finished|product|amount|activity|today|yesterday|liters?|gallons?|pounds?)\b/;

/**
 * What a spoken reply to the read-back means. Anything corrective is "change", even next to
 * "save", so the client appends the reply as a new clip and re-extracts before saving.
 */
export function classifyVoiceIntent(transcript: string): VoiceIntent {
  const spoken = transcript.toLowerCase().replace(/[’`]/g, "'").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!spoken) return "unclear";
  // "No changes" is approval, not a correction.
  const rest = spoken.replace(NO_CHANGE, " ");
  if (CHANGE.test(rest)) return "change";
  const kept = rest.replace(CANCEL, " ");
  const cancel = kept !== rest || (/\b(stop|quit|abort)\b/.test(rest) && rest.split(" ").length <= 3);
  const save = rest !== spoken || SAVE.test(kept);
  if (cancel) return save ? "unclear" : "cancel";
  if (save) return "save";
  return FACTS.test(rest) ? "change" : "unclear";
}

/**
 * Realtime layer: the phone talks to OpenAI Realtime over WebRTC with a short-lived secret minted
 * by the server, and the server stays the validator. See docs/backend/voice.md.
 */
export const VOICE_TOOL_NAME = "check_log";
export const LOG_STATE_PREFIX = "LOG STATE";
export type VoiceSessionRequest = { context: { accountId: string; referenceDate: string } };
export type VoiceSession = {
  /** Ephemeral OpenAI key (`ek_…`) for the SDP exchange only. Never store it. */
  clientSecret: string;
  /** ISO time after which the secret can no longer start a call. */
  expiresAt: string;
  model: string;
  /** POST the SDP offer here with `Authorization: Bearer <clientSecret>` and `Content-Type: application/sdp`. */
  connectUrl: string;
  /** Data channel the phone creates before the offer. */
  dataChannel: string;
  toolName: string;
  /** The phone should hang up after this long; a realtime call is billed while it is open. */
  maxSessionSeconds: number;
};
export type VoiceSessionResponse = { data: VoiceSession };

export type VoiceCheckStatus = VoiceStatus | "invalid";
export type VoiceProblem = { key: string; message: string };
/** `fields` is the tool call's arguments, as an object or the JSON string the data channel delivers. */
export type VoiceCheckRequest = { fields: unknown; transcript?: string };
export type VoiceCheckResult<Fields = VoiceLogFields> = {
  status: VoiceCheckStatus;
  missingFields: string[];
  /** Values the server refused and cleared; "invalid" whenever this is not empty. */
  problems: VoiceProblem[];
  /** What the realtime model should say next. */
  prompt: string;
  /** The normalised log (field resolved to its ID), or null when the arguments were not an object. */
  fields: Fields | null;
  /** True when the model passed `confirmed: true` and the log is complete: the phone may now save. */
  saveRequested: boolean;
};
export type VoiceStateRequest = { context: { accountId: string; referenceDate: string }; transcript: string; turn: number };
export type VoiceStateResult<Fields = VoiceLogFields> = Omit<VoiceCheckResult<Fields>, "saveRequested" | "fields"> & {
  /** Echo of the request's turn, so the phone can drop results that arrive out of order. */
  turn: number;
  fields: Fields;
  /** Text to inject as a system item, without requesting a response. */
  stateNote: string;
};

const coreStateLabels: Record<string, [string, string]> = {
  fieldId: ["field", "field"], activity: ["activity", "activity"], workDate: ["date", "date"], startTime: ["start", "start time"], endTime: ["end", "end time"],
};
/** One deterministic line of server truth for the realtime model: what is filled, what is missing, what to ask. */
export function buildLogStateNote(fields: VoiceLogFields, context: VoiceContext, turn: number): string {
  const missing = missingLogFields(fields, context.form);
  const defs = fields.activity ? context.form[fields.activity]?.fields ?? [] : [];
  const label = (key: string) => coreStateLabels[key]?.[1] ?? defs.find(item => item.key === key)?.label.replace(/\s*\(.*?\)/g, "").toLowerCase() ?? key;
  const field = context.fields.find(item => item.id === fields.fieldId);
  const core = requiredCoreLogFields.map(key => `${coreStateLabels[key][0]}=${key === "fieldId" ? field?.name ?? "MISSING" : fields[key] ?? "MISSING"}`);
  const details = defs.filter(item => fields.details[item.key] !== undefined || missing.includes(item.key)).map(item => `${item.key}=${fields.details[item.key] ?? "MISSING"}`);
  const next = missing.length ? `Ask next for: ${missing.map(label).join(", ")}.` : `Nothing required is missing. Call ${VOICE_TOOL_NAME} before reading the log back.`;
  return `${LOG_STATE_PREFIX} (authoritative, turn ${turn}): ${[...core, ...details].join("; ")}. ${next}`;
}
