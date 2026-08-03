export type ResponseKind = "html" | "json" | "text";

export interface SecurityHeaderOptions {
  kind: ResponseKind;
  /** Authenticated biometric / private pages and APIs */
  noStore?: boolean;
  /** CSP nonce for inline style/script when provided */
  nonce?: string;
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

/** CSP without unsafe-eval; scripts/styles may use nonce when supplied. */
export function buildContentSecurityPolicy(nonce?: string): string {
  const nonceSrc = nonce ? ` 'nonce-${nonce}'` : "";
  return [
    "default-src 'none'",
    `script-src 'self'${nonceSrc}`,
    `style-src 'self'${nonceSrc}`,
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
  headers.set("Content-Security-Policy", buildContentSecurityPolicy(options.nonce));
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
  init?: { status?: number; nonce?: string; noStore?: boolean; extra?: HeadersInit }
): Response {
  return new Response(body, {
    status: init?.status ?? 200,
    headers: securityHeaders({
      kind: "html",
      nonce: init?.nonce,
      noStore: init?.noStore ?? true,
      extra: init?.extra,
    }),
  });
}

export function jsonResponse(
  body: unknown,
  init?: { status?: number; nonce?: string; noStore?: boolean; extra?: HeadersInit }
): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: securityHeaders({
      kind: "json",
      nonce: init?.nonce,
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

export function newRequestNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
