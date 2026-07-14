import { describe, expect, it } from "vitest";
import { isEmailAllowed, parseAllowedEmails } from "../src/auth-allowlist.js";
import type { Env } from "../src/types.js";

function envWithEmails(emails: string): Env {
  return {
    DB: {} as D1Database,
    KV: {} as KVNamespace,
    ALLOWED_EMAILS: emails,
  };
}

describe("parseAllowedEmails", () => {
  it("parses comma-separated emails case-insensitively", () => {
    expect([...parseAllowedEmails(" Alice@Example.com , bob@test.com ")].sort()).toEqual([
      "alice@example.com",
      "bob@test.com",
    ]);
  });

  it("returns empty set for blank input", () => {
    expect(parseAllowedEmails("").size).toBe(0);
    expect(parseAllowedEmails(undefined).size).toBe(0);
  });
});

describe("isEmailAllowed", () => {
  it("allows only listed emails", () => {
    const env = envWithEmails("you@gmail.com,other@example.com");
    expect(isEmailAllowed("you@gmail.com", env)).toBe(true);
    expect(isEmailAllowed("YOU@gmail.com", env)).toBe(true);
    expect(isEmailAllowed("stranger@gmail.com", env)).toBe(false);
  });

  it("denies everyone when allowlist is empty", () => {
    expect(isEmailAllowed("you@gmail.com", envWithEmails(""))).toBe(false);
  });
});
