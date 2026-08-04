export type ResponseKind = "html" | "json" | "text";

export interface SecurityHeaderOptions {
  kind: ResponseKind;
  /** Authenticated biometric / private pages and APIs */
  noStore?: boolean;
  /** Extra headers to merge */
  extra?: HeadersInit;
}

const PERMISSIONS_POLICY = [
  "camera=()",
  "microphone=()",
  "geolocation=()",
  "payment=()",
  "usb=()",
  "interest-cohort=()",
].join(", ");

/** Strict CSP: external assets only — no unsafe-inline / unsafe-eval / nonces. */
export function buildContentSecurityPolicy(): string {
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join("; ");
}

export function securityHeaders(options: SecurityHeaderOptions): Headers {
  const headers = new Headers(options.extra);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Permissions-Policy", PERMISSIONS_POLICY);
  headers.set("Content-Security-Policy", buildContentSecurityPolicy());
  headers.set("X-Frame-Options", "DENY");

  if (options.noStore) {
    headers.set("Cache-Control", "no-store");
  }

  if (options.kind === "html" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "text/html; charset=utf-8");
  } else if (options.kind === "json" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json; charset=utf-8");
  } else if (options.kind === "text" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "text/plain; charset=utf-8");
  }

  return headers;
}

export function htmlResponse(
  body: string,
  init?: { status?: number; noStore?: boolean; extra?: HeadersInit }
): Response {
  return new Response(body, {
    status: init?.status ?? 200,
    headers: securityHeaders({
      kind: "html",
      noStore: init?.noStore ?? true,
      extra: init?.extra,
    }),
  });
}

export function jsonResponse(
  body: unknown,
  init?: { status?: number; noStore?: boolean; extra?: HeadersInit }
): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: securityHeaders({
      kind: "json",
      noStore: init?.noStore ?? true,
      extra: init?.extra,
    }),
  });
}

export function textResponse(
  body: string,
  init?: { status?: number; extra?: HeadersInit; noStore?: boolean }
): Response {
  return new Response(body, {
    status: init?.status ?? 200,
    headers: securityHeaders({
      kind: "text",
      noStore: init?.noStore ?? false,
      extra: init?.extra,
    }),
  });
}

export function methodNotAllowed(allowed: string[]): Response {
  return textResponse("Method Not Allowed", {
    status: 405,
    extra: { Allow: allowed.join(", ") },
  });
}

/** Generic client/server errors — never include internals, SQL, secrets, or PII. */
export function genericErrorResponse(
  status: number,
  publicMessage: string,
  extra?: HeadersInit
): Response {
  return jsonResponse({ error: publicMessage }, { status, extra, noStore: true });
}
