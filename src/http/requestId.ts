const REQUEST_ID_HEADER = "X-Request-Id";

export function resolveRequestId(request: Request): string {
  const incoming = request.headers.get(REQUEST_ID_HEADER)?.trim();
  if (incoming && /^[A-Za-z0-9._-]{8,128}$/.test(incoming)) {
    return incoming;
  }
  return crypto.randomUUID();
}

export function withRequestIdHeader(headers: HeadersInit | undefined, requestId: string): Headers {
  const h = new Headers(headers);
  h.set(REQUEST_ID_HEADER, requestId);
  return h;
}
