import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readMobileSubmission } from "@/server/mobile/logs";

/** A minimal PCM WAV, as the phone writes a call-mode recording. */
function wav() {
  const bytes = Buffer.alloc(48);
  bytes.write("RIFF", 0, "ascii"); bytes.writeUInt32LE(40, 4); bytes.write("WAVE", 8, "ascii");
  bytes.write("fmt ", 12, "ascii"); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(24_000, 24); bytes.writeUInt32LE(48_000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36, "ascii"); bytes.writeUInt32LE(4, 40);
  return bytes;
}
function upload(mimeType: string, body: Uint8Array = wav()) {
  const id = randomUUID();
  const form = new FormData();
  form.set("metadata", JSON.stringify({
    contractVersion: "1", clientDraftId: id, accountId: randomUUID(), fieldId: randomUUID(), activity: "Spraying",
    workDate: "2026-09-17", startTime: "17:00", endTime: "18:00", notes: "", transcript: "I sprayed field A.", treatment: null, tags: [],
    recordings: [{ mimeType, durationSeconds: 2.5 }],
  }));
  form.append("audio0", new Blob([new Uint8Array(body)], { type: mimeType }), "call.wav");
  return new Request("https://toph.example/api/mobile/v1/logs", { method: "POST", headers: { "idempotency-key": id }, body: form });
}

describe("mobile recording uploads", () => {
  // iOS names a .wav file audio/vnd.wave and Android audio/x-wav; the phone sends what the platform says.
  it.each(["audio/wav", "audio/vnd.wave", "audio/x-wav", "audio/wave"])("accepts a call recording sent as %s and keeps it as audio/wav", async mimeType => {
    const { metadata, clips } = await readMobileSubmission(upload(mimeType));
    expect(metadata.recordings).toEqual([{ mimeType: "audio/wav", durationSeconds: 2.5 }]);
    expect(clips).toHaveLength(1);
    expect(clips[0]).toMatchObject({ mimeType: "audio/wav", durationSeconds: 2.5 });
    expect(clips[0].bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
  });

  it("still checks that the bytes are a WAV file, and refuses types it does not know", async () => {
    await expect(readMobileSubmission(upload("audio/vnd.wave", new TextEncoder().encode("not audio")))).rejects.toMatchObject({ status: 400 });
    await expect(readMobileSubmission(upload("audio/aiff"))).rejects.toMatchObject({ status: 400 });
  });
});
