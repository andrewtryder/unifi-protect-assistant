/**
 * Privacy-safe webhook delivery idempotency key.
 *
 * Hash inputs intentionally exclude person names, plate text, images, and raw payload body.
 * Same alarm identity + trigger event IDs + alarm timestamp → same delivery key.
 * Legitimate multi-trigger notifications that share those fields are treated as one delivery;
 * distinct event_id values still insert as separate face/vehicle rows under that parent.
 */
export async function computeDeliveryKey(payload: unknown): Promise<string> {
  const alarm =
    payload && typeof payload === "object"
      ? (payload as { alarm?: Record<string, unknown>; timestamp?: unknown }).alarm
      : undefined;
  const rootTs =
    payload && typeof payload === "object"
      ? (payload as { timestamp?: unknown }).timestamp
      : undefined;

  const alarmName =
    alarm && typeof alarm === "object" && typeof alarm.name === "string" ? alarm.name : "";
  const eventPath =
    alarm && typeof alarm === "object" && typeof alarm.eventPath === "string"
      ? alarm.eventPath
      : "";
  const alarmTs =
    alarm && typeof alarm === "object" && typeof alarm.timestamp === "number"
      ? String(alarm.timestamp)
      : typeof rootTs === "number"
        ? String(rootTs)
        : "";

  const triggers =
    alarm && typeof alarm === "object" && Array.isArray(alarm.triggers) ? alarm.triggers : [];
  const eventIds = triggers
    .map((t) => {
      if (!t || typeof t !== "object") return "";
      const id = (t as { eventId?: unknown }).eventId;
      return typeof id === "string" ? id : "";
    })
    .filter(Boolean)
    .sort();

  const material = ["v1", alarmName, eventPath, alarmTs, ...eventIds].join("\n");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
