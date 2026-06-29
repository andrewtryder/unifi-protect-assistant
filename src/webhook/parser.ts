import { UnifiWebhookPayload, FaceEvent, Env, UnifiTrigger } from "../types.js";

/**
 * Normalizes seen timestamp to local date (YYYY-MM-DD) in the specified timezone
 */
export function getLocalDate(timestampMs: number, timezone: string): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(new Date(timestampMs));
  const year = parts.find(p => p.type === "year")?.value;
  const month = parts.find(p => p.type === "month")?.value;
  const day = parts.find(p => p.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

/**
 * Parsers UniFi Protect payloads defensively and filters according to configuration
 */
export function parseWebhookPayload(
  payload: any,
  notificationId: string,
  env: Env
): FaceEvent[] {
  const timezone = env.TIMEZONE || "America/New_York";
  const events: FaceEvent[] = [];

  if (!payload || typeof payload !== "object") return events;
  const alarm = payload.alarm;
  if (!alarm || typeof alarm !== "object") return events;

  const alarmName = String(alarm.name || "");
  const triggers = Array.isArray(alarm.triggers) ? alarm.triggers : [];
  const conditions = Array.isArray(alarm.conditions) ? alarm.conditions : [];

  // Parse filters
  const targetNames = env.TARGET_PERSON_NAMES
    ? env.TARGET_PERSON_NAMES.split(",").map(n => n.trim().toLowerCase()).filter(Boolean)
    : [];
  const targetIds = env.TARGET_PERSON_IDS
    ? env.TARGET_PERSON_IDS.split(",").map(i => i.trim().toLowerCase()).filter(Boolean)
    : [];
  const watchCameras = env.WATCH_CAMERA_IDS
    ? env.WATCH_CAMERA_IDS.split(",").map(c => c.trim().toLowerCase()).filter(Boolean)
    : [];

  for (const trigger of triggers) {
    if (!trigger || typeof trigger !== "object") continue;

    const triggerKey = String(trigger.key || "");
    // Match "face_known", "face_unknown", "face_of_interest" or any key starting with "face_"
    if (!triggerKey.startsWith("face_")) {
      continue;
    }

    const cameraId = String(trigger.device || "");
    if (watchCameras.length > 0 && !watchCameras.includes(cameraId.toLowerCase())) {
      continue;
    }

    let eventId = String(trigger.eventId || "");
    if (!eventId) continue;
    // If it's a test event ID from a mock dashboard, make it unique so multiple tests can register
    if (eventId === "testEventId") {
      eventId = `testEventId-${Date.now()}`;
    }

    const seenAtMs = Number(trigger.timestamp) || Date.now();
    const localDate = getLocalDate(seenAtMs, timezone);

    // Extract person name and person ID
    const personName = String(trigger.value || trigger.group?.name || "Unknown");
    
    // Find matching person ID from condition if source matches triggerKey and value is set
    let personId = "";
    const matchingCondition = conditions.find((c: any) => c.condition?.source === triggerKey);
    if (matchingCondition && matchingCondition.condition?.value) {
      personId = String(matchingCondition.condition.value);
    }

    // Determine a person key
    // If person ID is present, use it. Otherwise, use person name.
    const personKey = personId ? `id:${personId}` : `name:${personName.toLowerCase().replace(/\s+/g, "_")}`;

    // Filter checks
    const hasNameFilter = targetNames.length > 0;
    const hasIdFilter = targetIds.length > 0;

    const nameMatches = hasNameFilter && targetNames.includes(personName.toLowerCase());
    const idMatches = hasIdFilter && personId && targetIds.includes(personId.toLowerCase());

    // If either filter is configured, the event must match at least one of the active filters
    if ((hasNameFilter || hasIdFilter) && !nameMatches && !idMatches) {
      continue;
    }

    // Extract image if present. UniFi Protect webhooks typically send standard key "image" inside trigger or alarm
    const triggerImage = String(trigger.image || payload.image || alarm.image || "");
    const imageBase64 = triggerImage.startsWith("data:") || /^[A-Za-z0-9+/=]+$/.test(triggerImage) ? triggerImage : undefined;

    events.push({
      id: crypto.randomUUID(),
      notification_id: notificationId,
      event_id: eventId,
      seen_at_ms: seenAtMs,
      local_date: localDate,
      person_key: personKey,
      person_name: personName,
      person_id: personId,
      trigger_key: triggerKey,
      camera_id: cameraId,
      alarm_name: alarmName,
      raw_trigger_json: JSON.stringify(trigger),
      image_base64: imageBase64,
    });
  }

  return events;
}
