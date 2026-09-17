import { defaultProfile, normalizeProfile, readProfile, saveProfile } from "../recording-profile";

jest.mock("expo-file-system", () => require("./fake-file-system").createFakeFileSystem());

type Fake = ReturnType<typeof import("./fake-file-system").createFakeFileSystem>;
const fake = jest.requireMock("expo-file-system") as Fake;

beforeEach(() => fake.reset());

test("readProfile returns the default profile when nothing is stored", () => {
  expect(readProfile()).toEqual(defaultProfile);
});

test("saveProfile trims the name, persists, and reads back", () => {
  saveProfile({ name: "  Maria Lopez  ", defaultField: "FIELD C", defaultActivity: "Harvesting" });
  expect(readProfile()).toEqual({ name: "Maria Lopez", defaultField: "FIELD C", defaultActivity: "Harvesting" });
  expect(fake.files.has("file:///documents/toph-recording-preview/profile.json")).toBe(true);
});

test("saveProfile rejects invalid values with the web app's message", () => {
  expect(() => saveProfile({ name: "   ", defaultField: "FIELD A", defaultActivity: "Spraying" })).toThrow("Check your name and recording defaults.");
  expect(() => saveProfile({ name: "Ok", defaultField: "FIELD Z", defaultActivity: "Spraying" })).toThrow("Check your name and recording defaults.");
  expect(() => saveProfile({ name: "x".repeat(81), defaultField: "FIELD A", defaultActivity: "Spraying" })).toThrow("Check your name and recording defaults.");
});

test("normalizeProfile falls back per field and caps the name length", () => {
  expect(normalizeProfile({ name: "  ", defaultField: "nope", defaultActivity: 3 })).toEqual(defaultProfile);
  expect(normalizeProfile({ name: "y".repeat(100), defaultField: "FIELD B", defaultActivity: "Weeding" })).toEqual({ name: "y".repeat(80), defaultField: "FIELD B", defaultActivity: "Weeding" });
  expect(normalizeProfile("garbage")).toEqual(defaultProfile);
});

test("readProfile ignores corrupt files", () => {
  fake.directories.add("file:///documents/toph-recording-preview");
  fake.files.set("file:///documents/toph-recording-preview/profile.json", "{not json");
  expect(readProfile()).toEqual(defaultProfile);
});
