import "server-only";
/** Shared error handling for the satellite routes: both ApiError and the TranscriptionError family. */
import { toApiError } from "@/server/http/responses";
import { TranscriptionError } from "@/server/recordings/audio";

export async function satelliteRoute(handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler();
  } catch (cause) {
    const error = cause instanceof TranscriptionError ? cause : toApiError(cause);
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
