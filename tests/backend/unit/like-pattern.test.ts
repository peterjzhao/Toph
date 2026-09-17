import { describe, expect, it } from "vitest";
import { escapeLikePattern } from "@/server/validation/like-pattern";

describe("escapeLikePattern", () => {
  it("escapes percent, underscore, and backslash so user input stays literal", () => {
    expect(escapeLikePattern("50%_done\\")).toBe("50\\%\\_done\\\\");
  });

  it("leaves ordinary text unchanged", () => {
    expect(escapeLikePattern("FIELD A")).toBe("FIELD A");
  });
});
