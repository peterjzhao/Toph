import "server-only";
/**
 * The server's OpenAI key and the strict-JSON Responses API call that log extraction, Ask Toph,
 * field analysis and report detection share. The key never leaves the server.
 */
import { ApiError } from "@/server/errors";

/** The configured key, or null when AI features are off. */
export function openAiKey(): string | null {
  return process.env.OPENAI_API_KEY?.trim() || null;
}

/** The configured key; without one, the feature answers 503 with `message`. */
export function requireOpenAiKey(message: string): string {
  const key = openAiKey();
  if (!key) throw new ApiError(503, "NOT_CONFIGURED", message);
  return key;
}

type OutputItem = { type: string; content?: { type: string; text?: string }[] };

export type StructuredOutputRequest<T> = {
  apiKey: string;
  signal: AbortSignal;
  fetcher?: typeof fetch;
  model: string;
  instructions: string;
  maxOutputTokens: number;
  /** Sent as the one user message, serialized as JSON. */
  input: unknown;
  schemaName: string;
  /** JSON Schema the answer must follow exactly. */
  schema: unknown;
  /** Validates the parsed answer. Anything it throws counts as a failed request. */
  parse: (value: unknown) => T;
  /** What every failure becomes: an HTTP error, an incomplete or refused answer, or unusable JSON. */
  failure: () => ApiError;
  /** Message of the 499 thrown when `signal` aborts. */
  cancelled: string;
};

/** One Responses API request held to a strict JSON Schema, with a 45 second timeout. Nothing is stored by the provider. */
export async function requestStructuredOutput<T>(request: StructuredOutputRequest<T>): Promise<T> {
  const { apiKey, signal, fetcher = fetch, failure } = request;
  try {
    const response = await fetcher("https://api.openai.com/v1/responses", {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]),
      body: JSON.stringify({
        model: request.model, store: false, max_output_tokens: request.maxOutputTokens, instructions: request.instructions,
        input: [{ role: "user", content: JSON.stringify(request.input) }],
        text: { format: { type: "json_schema", name: request.schemaName, strict: true, schema: request.schema } },
      }),
    });
    if (!response.ok) throw failure();
    const result = await response.json();
    if (result.status !== "completed" || !Array.isArray(result.output)) throw failure();
    const content = (result.output as OutputItem[]).flatMap(item => item.type === "message" ? item.content ?? [] : []);
    if (content.some(item => item.type === "refusal")) throw failure();
    const text = content.filter(item => item.type === "output_text").map(item => item.text).join("");
    return request.parse(JSON.parse(text));
  } catch (error) {
    if (signal.aborted) throw new ApiError(499, "CANCELLED", request.cancelled);
    if (error instanceof ApiError) throw error;
    throw failure();
  }
}
