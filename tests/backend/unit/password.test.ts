import { describe, expect, it } from "vitest";
import { hashPassword, initialPassword, verifyPassword } from "@/server/accounts/password";

describe("account passwords", () => {
  it("stores a salted scrypt hash that only the original password verifies", async () => {
    const [first, second] = await Promise.all([hashPassword("correct horse"), hashPassword("correct horse")]);
    expect(first).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(first).not.toBe(second);
    expect(await verifyPassword("correct horse", first)).toBe(true);
    expect(await verifyPassword("Correct horse", first)).toBe(false);
  });

  it("never verifies a missing or malformed hash", async () => {
    for (const stored of [null, undefined, "", "scrypt$zz$zz", "plain"]) expect(await verifyPassword("anything", stored)).toBe(false);
  });

  it("derives the initial password from the lowercased first name", () => {
    expect(initialPassword("Ranch Admin")).toBe("ranch");
    expect(initialPassword("  María José  Ruiz")).toBe("maría");
    expect(initialPassword("Al")).toBe("al");
  });
});
