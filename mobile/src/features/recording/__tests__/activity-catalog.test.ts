import { readActivityItems, saveActivityItem } from "../activity-catalog";

jest.mock("expo-file-system", () => require("./fake-file-system").createFakeFileSystem());
const fake = jest.requireMock("expo-file-system") as ReturnType<typeof import("./fake-file-system").createFakeFileSystem>;
beforeEach(() => fake.reset());

test("custom choices persist in documents, remain activity-specific and deduplicate names", () => {
  expect(readActivityItems("Planting")).toEqual([]);
  expect(saveActivityItem("Planting", "  Roma   tomato  ")).toBe("Roma tomato");
  expect(saveActivityItem("Planting", "roma tomato")).toBe("Roma tomato");
  saveActivityItem("Fertilizing", "Compost");
  // Read fresh from the document file, without relying on UI state or a module cache.
  expect(readActivityItems("Planting")).toEqual(["Roma tomato"]);
  expect(readActivityItems("Fertilizing")).toEqual(["Compost"]);
  expect(readActivityItems("Spraying")).toEqual([]);
  expect(JSON.parse(fake.files.get("file:///documents/toph-recording-preview/activity-items.json")!)).toEqual({ Planting: ["Roma tomato"], Fertilizing: ["Compost"] });
});

test("invalid entries and corrupt storage cannot overwrite saved choices", () => {
  expect(() => saveActivityItem("Planting", " ")).toThrow("Enter a name");
  expect(() => saveActivityItem("Planting", "a".repeat(121))).toThrow("120");
  saveActivityItem("Planting", "Tomato");
  const path = "file:///documents/toph-recording-preview/activity-items.json";
  fake.files.set(path, "broken");
  expect(() => readActivityItems("Planting")).toThrow("could not be loaded");
  expect(() => saveActivityItem("Planting", "Lettuce")).toThrow("could not be saved");
  expect(fake.files.get(path)).toBe("broken");
});

test("signed-in choices stay with their farm and account", () => {
  saveActivityItem("Planting", "Tomato", "farm-one:worker-one");
  saveActivityItem("Planting", "Lettuce", "farm-two:worker-one");
  expect(readActivityItems("Planting", "farm-one:worker-one")).toEqual(["Tomato"]);
  expect(readActivityItems("Planting", "farm-two:worker-one")).toEqual(["Lettuce"]);
  expect(readActivityItems("Planting", "farm-one:worker-two")).toEqual([]);
});
