import { describe, it, expect } from "vitest";
import { BodyTooLargeError, readBodyWithLimit } from "../src/http/body.js";

describe("readBodyWithLimit", () => {
  it("rejects oversized Content-Length before reading", async () => {
    const request = new Request("https://example.com/unifi", {
      method: "POST",
      headers: { "Content-Length": "9999" },
      body: "hi",
    });
    // Node may recompute Content-Length from body; force the header for the fast-path.
    Object.defineProperty(request, "headers", {
      value: {
        get(name: string) {
          if (name.toLowerCase() === "content-length") return "9999";
          return null;
        },
      },
    });
    await expect(readBodyWithLimit(request, 100)).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it("rejects oversized streamed body even without Content-Length", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("z".repeat(200)));
        controller.close();
      },
    });
    const request = new Request("https://example.com/unifi", {
      method: "POST",
      body: stream,
      // @ts-expect-error Node fetch streaming
      duplex: "half",
    });
    await expect(readBodyWithLimit(request, 64)).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it("returns body under the limit", async () => {
    const request = new Request("https://example.com/unifi", {
      method: "POST",
      body: '{"ok":true}',
    });
    await expect(readBodyWithLimit(request, 1000)).resolves.toBe('{"ok":true}');
  });
});
