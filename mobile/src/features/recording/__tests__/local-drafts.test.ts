import { listDrafts, saveDraft, type RecordingDraft } from "../local-drafts";

jest.mock("expo-file-system", () => require("./fake-file-system").createFakeFileSystem());

type Fake = ReturnType<typeof import("./fake-file-system").createFakeFileSystem>;
const fake = jest.requireMock("expo-file-system") as Fake;

function draft(overrides: Partial<RecordingDraft> = {}): RecordingDraft {
  return {
    id: "draft-1", createdAt: "2026-04-19T10:00:00.000Z", updatedAt: "2026-04-19T10:00:00.000Z",
    employee: { id: "employee-1", name: "Isaac Wang" }, farmId: "farm-1",
    field: "FIELD A", activity: "Spraying", workDate: "2026-04-19", startTime: "06:00", endTime: "10:40",
    notes: "Sprayed.", product: "", amount: "", unit: "L", tags: [], transcript: "", audio: null, durationSeconds: 0,
    ...overrides,
  };
}

beforeEach(() => fake.reset());

test("listDrafts returns an empty list and prepares storage on first use", async () => {
  await expect(listDrafts()).resolves.toEqual([]);
  expect(fake.directories.has("file:///documents/toph-recording-preview/audio")).toBe(true);
});

test("saveDraft copies the recording into app storage and lists it back by file name", async () => {
  fake.files.set("file:///cache/recording.m4a", "AUDIO");
  const saved = await saveDraft(draft({ audio: { uri: "file:///cache/recording.m4a", mimeType: "audio/mp4", extension: "m4a" }, durationSeconds: 12 }));
  expect(saved.audio?.uri).toBe("file:///documents/toph-recording-preview/audio/draft-1.m4a");
  expect(fake.files.get("file:///documents/toph-recording-preview/audio/draft-1.m4a")).toBe("AUDIO");

  const listed = await listDrafts();
  expect(listed).toHaveLength(1);
  expect(listed[0].audio).toEqual({ uri: "file:///documents/toph-recording-preview/audio/draft-1.m4a", mimeType: "audio/mp4", extension: "m4a" });
  expect(listed[0].durationSeconds).toBe(12);
  expect(JSON.parse(fake.files.get("file:///documents/toph-recording-preview/drafts.json")!)[0].audio).toEqual({ fileName: "draft-1.m4a", mimeType: "audio/mp4", extension: "m4a" });
});

test("re-saving a draft replaces it and keeps audio that already lives in storage", async () => {
  fake.files.set("file:///cache/recording.m4a", "AUDIO");
  const first = await saveDraft(draft({ audio: { uri: "file:///cache/recording.m4a", mimeType: "audio/mp4", extension: "m4a" } }));
  const second = await saveDraft({ ...first, notes: "Edited.", updatedAt: "2026-04-20T10:00:00.000Z" });
  expect(second.audio?.uri).toBe(first.audio?.uri);
  expect(fake.files.get("file:///documents/toph-recording-preview/audio/draft-1.m4a")).toBe("AUDIO");
  const listed = await listDrafts();
  expect(listed).toHaveLength(1);
  expect(listed[0].notes).toBe("Edited.");
});

test("drafts are ordered by most recently updated", async () => {
  await saveDraft(draft({ id: "a", updatedAt: "2026-04-01T00:00:00.000Z" }));
  await saveDraft(draft({ id: "b", updatedAt: "2026-04-03T00:00:00.000Z" }));
  await saveDraft(draft({ id: "c", updatedAt: "2026-04-02T00:00:00.000Z" }));
  expect((await listDrafts()).map((item) => item.id)).toEqual(["b", "c", "a"]);
});

test("storage failures surface the same messages as the web app", async () => {
  await saveDraft(draft());
  fake.failures.read = true;
  await expect(listDrafts()).rejects.toThrow("Your device drafts could not be loaded.");
  await expect(saveDraft(draft({ id: "x" }))).rejects.toThrow("Your draft could not be saved.");
});

test("appended clips and their transcripts survive save, reopen, and another save", async () => {
  const audio = { uri: "file:///cache/first.m4a", mimeType: "audio/mp4", extension: "m4a" };
  const second = { ...audio, uri: "file:///cache/second.m4a" };
  fake.files.set(audio.uri, "FIRST AUDIO");
  fake.files.set(second.uri, "SECOND AUDIO");
  await saveDraft(draft({ audio, durationSeconds: 7, transcript: "First.\n\nSecond.", clips: [
    { audio, durationSeconds: 3, transcript: "First." },
    { audio: second, durationSeconds: 4, transcript: "Second." },
  ] }));
  const [reopened] = await listDrafts();
  expect(reopened.clips?.map(clip => fake.files.get(clip.audio.uri))).toEqual(["FIRST AUDIO", "SECOND AUDIO"]);
  expect(reopened.clips?.map(clip => clip.transcript)).toEqual(["First.", "Second."]);
  expect(reopened.durationSeconds).toBe(7);
  await saveDraft({ ...reopened, notes: "Edited after reopening." });
  expect((await listDrafts())[0].clips).toEqual(reopened.clips);
  expect(fake.files.get("file:///documents/toph-recording-preview/drafts.json")).not.toContain("file:///");
});
