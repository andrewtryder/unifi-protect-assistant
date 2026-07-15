/** Max raw Base64 length for stored trigger thumbnails (~384KB binary). */
export const MAX_IMAGE_BASE64_LENGTH = 512_000;

const SAFE_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Accepts bare JPEG Base64 or a data:image/jpeg;base64, URL.
 * Returns raw Base64 only — never an arbitrary data: URL.
 */
export function normalizeJpegBase64(value: unknown): string | undefined {
  const raw = String(value ?? "").replace(/^data:image\/jpeg;base64,/i, "");

  if (!SAFE_BASE64.test(raw)) return undefined;
  if (raw.length > MAX_IMAGE_BASE64_LENGTH) return undefined;

  return raw;
}
