import { FaceEvent, VehicleEvent, Env } from "../types.js";

export interface ParsedWebhookEvents {
  faceEvents: FaceEvent[];
  vehicleEvents: VehicleEvent[];
}

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

/** Uppercase alphanumeric plate key, or plate:unknown when empty. */
export function normalizePlateKey(rawPlate: string): string {
  const normalized = rawPlate.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return normalized ? `plate:${normalized}` : "plate:unknown";
}

function uniquifyTestEventId(eventId: string): string {
  if (eventId === "testEventId") {
    return `testEventId-${Date.now()}`;
  }
  return eventId;
}

function extractImageBase64(trigger: any, payload: any, alarm: any): string | undefined {
  const triggerImage = String(trigger.image || payload.image || alarm.image || "");
  return triggerImage.startsWith("data:") || /^[A-Za-z0-9+/=]+$/.test(triggerImage)
    ? triggerImage
    : undefined;
}

/**
 * Parses UniFi Protect payloads defensively into face and license-plate events.
 */
export function parseWebhookPayload(
  payload: any,
  notificationId: string,
  env: Env
): ParsedWebhookEvents {
  const timezone = env.TIMEZONE || "America/New_York";
  const faceEvents: FaceEvent[] = [];
  const vehicleEvents: VehicleEvent[] = [];

  if (!payload || typeof payload !== "object") {
    return { faceEvents, vehicleEvents };
  }
  const alarm = payload.alarm;
  if (!alarm || typeof alarm !== "object") {
    return { faceEvents, vehicleEvents };
  }

  const alarmName = String(alarm.name || "");
  const triggers = Array.isArray(alarm.triggers) ? alarm.triggers : [];
  const conditions = Array.isArray(alarm.conditions) ? alarm.conditions : [];

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
    const isFace = triggerKey.startsWith("face_");
    const isPlate = triggerKey.startsWith("license_plate_");
    if (!isFace && !isPlate) continue;

    const cameraId = String(trigger.device || "");
    if (watchCameras.length > 0 && !watchCameras.includes(cameraId.toLowerCase())) {
      continue;
    }

    let eventId = String(trigger.eventId || "");
    if (!eventId) continue;
    eventId = uniquifyTestEventId(eventId);

    const seenAtMs = Number(trigger.timestamp) || Date.now();
    const localDate = getLocalDate(seenAtMs, timezone);
    const imageBase64 = extractImageBase64(trigger, payload, alarm);

    if (isPlate) {
      const plateText = String(trigger.value || trigger.group?.name || "").trim();
      vehicleEvents.push({
        id: crypto.randomUUID(),
        notification_id: notificationId,
        event_id: eventId,
        seen_at_ms: seenAtMs,
        local_date: localDate,
        plate_key: normalizePlateKey(plateText),
        plate_text: plateText,
        trigger_key: triggerKey,
        camera_id: cameraId,
        alarm_name: alarmName,
        raw_trigger_json: JSON.stringify(trigger),
        image_base64: imageBase64,
      });
      continue;
    }

    // Face events
    const personName = String(trigger.value || trigger.group?.name || "Unknown");

    let personId = "";
    const matchingCondition = conditions.find((c: any) => c.condition?.source === triggerKey);
    if (matchingCondition && matchingCondition.condition?.value) {
      personId = String(matchingCondition.condition.value);
    }

    const personKey = personId
      ? `id:${personId}`
      : `name:${personName.toLowerCase().replace(/\s+/g, "_")}`;

    const hasNameFilter = targetNames.length > 0;
    const hasIdFilter = targetIds.length > 0;
    const nameMatches = hasNameFilter && targetNames.includes(personName.toLowerCase());
    const idMatches = hasIdFilter && personId && targetIds.includes(personId.toLowerCase());

    if ((hasNameFilter || hasIdFilter) && !nameMatches && !idMatches) {
      continue;
    }

    faceEvents.push({
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

  return { faceEvents, vehicleEvents };
}
