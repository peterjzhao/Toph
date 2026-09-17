/** Durable device drafts and audio. Synced drafts retain the server's commit receipt. */
import { Directory, File, Paths } from "expo-file-system";

export type RecordingAudio = { uri: string; mimeType: string; extension: string };
export type RecordingClip = { audio: RecordingAudio; durationSeconds: number; transcript: string };

export type RecordingDraft = {
  id: string;
  createdAt: string;
  updatedAt: string;
  employee: { id: string; name: string };
  farmId: string;
  field: string;
  activity: string;
  workDate: string;
  startTime: string;
  endTime: string;
  notes: string;
  product: string;
  amount: string;
  unit: string;
  tags: string[];
  /** Speech-to-text of the recording, or an empty string when none was produced. */
  transcript: string;
  audio: RecordingAudio | null;
  /** Ordered clips, including the first recording. Absent on older drafts. */
  clips?: RecordingClip[];
  durationSeconds: number;
  isDemo: boolean;
  /** Written only after the server returns a verified committed receipt. */
  sync?: { logId: string; savedAt: string };
};

/** Audio is stored by file name so drafts survive the app container moving between launches. */
type StoredAudio = { fileName: string; mimeType: string; extension: string };
type StoredDraft = Omit<RecordingDraft, "audio" | "clips"> & { audio: StoredAudio | null; clips?: Array<Omit<RecordingClip, "audio"> & { audio: StoredAudio }> };

export const storageDirectoryName = "toph-recording-preview";
const audioDirectoryName = "audio";
const indexFileName = "drafts.json";

const root = () => new Directory(Paths.document, storageDirectoryName);
const audioDirectory = () => new Directory(root(), audioDirectoryName);
const indexFile = () => new File(root(), indexFileName);

function ensureStorage() {
  try {
    const directory = audioDirectory();
    if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
  } catch {
    throw new Error("Device storage is unavailable. Your recording has not been saved.");
  }
}

function readIndex(): StoredDraft[] {
  const file = indexFile();
  if (!file.exists) return [];
  const parsed: unknown = JSON.parse(file.textSync());
  return Array.isArray(parsed) ? (parsed as StoredDraft[]) : [];
}

function writeIndex(drafts: StoredDraft[]) {
  const file = indexFile();
  if (!file.exists) file.create();
  file.write(JSON.stringify(drafts));
}

function hydrate(stored: StoredDraft): RecordingDraft {
  const hydrateAudio = (audio: StoredAudio): RecordingAudio => ({ uri: new File(audioDirectory(), audio.fileName).uri, mimeType: audio.mimeType, extension: audio.extension });
  return {
    ...stored,
    audio: stored.audio ? hydrateAudio(stored.audio) : null,
    clips: stored.clips?.map(clip => ({ ...clip, audio: hydrateAudio(clip.audio) })),
  };
}

export function draftClips(draft: RecordingDraft): RecordingClip[] {
  return draft.clips ?? (draft.audio ? [{ audio: draft.audio, durationSeconds: draft.durationSeconds, transcript: draft.transcript ?? "" }] : []);
}

export async function listDrafts(): Promise<RecordingDraft[]> {
  try {
    ensureStorage();
    return readIndex().map(hydrate).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    throw new Error("Your device drafts could not be loaded.");
  }
}

/** Persists the draft and returns it with its audio relocated into app storage. */
export async function saveDraft(draft: RecordingDraft): Promise<RecordingDraft> {
  ensureStorage();
  try {
    function storeAudio(audio: RecordingAudio, suffix: string): StoredAudio {
      const fileName = `${draft.id}${suffix}.${audio.extension}`;
      const target = new File(audioDirectory(), fileName);
      const source = new File(audio.uri);
      if (source.uri !== target.uri) {
        if (target.exists) target.delete();
        source.copy(target);
      }
      return { fileName, mimeType: audio.mimeType, extension: audio.extension };
    }
    const clips = draft.clips?.map((clip, index) => ({ ...clip, audio: storeAudio(clip.audio, index ? `-part-${index + 1}` : "") }));
    const storedAudio = clips?.[0]?.audio ?? (draft.audio ? storeAudio(draft.audio, "") : null);
    const stored: StoredDraft = { ...draft, audio: storedAudio, clips };
    writeIndex([stored, ...readIndex().filter((item) => item.id !== draft.id)]);
    return hydrate(stored);
  } catch {
    throw new Error("Your draft could not be saved. Device storage may be full. You can still share the audio.");
  }
}
