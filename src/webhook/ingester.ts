import { Env, FaceEvent, VehicleEvent } from "../types.js";

export interface IngestResult {
  notificationInserted: boolean;
  notificationId: string;
  eventsAttempted: number;
  eventsInserted: number;
  duplicates: number;
  vehiclesAttempted: number;
  vehiclesInserted: number;
  vehicleDuplicates: number;
}

/**
 * Inserts the raw webhook notification plus face and vehicle events.
 * - Parent uses ON CONFLICT(delivery_key) DO NOTHING for exact duplicate deliveries.
 * - Children use ON CONFLICT(event_id) DO NOTHING (does not suppress integrity errors).
 * Duplicate counts come from D1 meta.changes.
 */
export async function ingestWebhook(
  env: Env,
  notificationId: string,
  receivedAtMs: number,
  sourceIp: string,
  eventId: string,
  alarmName: string,
  rawPayload: string,
  faceEvents: FaceEvent[],
  imageBase64: string | undefined,
  vehicleEvents: VehicleEvent[],
  deliveryKey: string
): Promise<IngestResult> {
  const parentResult = await env.DB.prepare(
    `
    INSERT INTO webhook_notifications (
      id, received_at_ms, source_ip, event_id, alarm_name, payload_json, image_base64, delivery_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(delivery_key) DO NOTHING
  `
  )
    .bind(
      notificationId,
      receivedAtMs,
      sourceIp,
      eventId,
      alarmName,
      rawPayload,
      imageBase64 || null,
      deliveryKey
    )
    .run();

  const notificationInserted = (parentResult.meta?.changes ?? 0) > 0;
  let canonicalId = notificationId;

  if (!notificationInserted) {
    const row = await env.DB.prepare(`SELECT id FROM webhook_notifications WHERE delivery_key = ?`)
      .bind(deliveryKey)
      .first<{ id: string }>();
    if (!row?.id) {
      throw new Error("D1_INGEST_PARENT_MISSING");
    }
    canonicalId = row.id;
  }

  const childStatements = [
    ...faceEvents.map((event) =>
      env.DB.prepare(
        `
        INSERT INTO face_events (
          id, notification_id, event_id, seen_at_ms, local_date,
          person_key, person_name, person_id, trigger_key, camera_id,
          alarm_name, raw_trigger_json, image_base64
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(event_id) DO NOTHING
      `
      ).bind(
        event.id,
        canonicalId,
        event.event_id,
        event.seen_at_ms,
        event.local_date,
        event.person_key,
        event.person_name,
        event.person_id,
        event.trigger_key,
        event.camera_id,
        event.alarm_name,
        event.raw_trigger_json,
        event.image_base64 || imageBase64 || null
      )
    ),
    ...vehicleEvents.map((event) =>
      env.DB.prepare(
        `
        INSERT INTO vehicle_events (
          id, notification_id, event_id, seen_at_ms, local_date,
          plate_key, plate_text, trigger_key, camera_id,
          alarm_name, raw_trigger_json, image_base64
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(event_id) DO NOTHING
      `
      ).bind(
        event.id,
        canonicalId,
        event.event_id,
        event.seen_at_ms,
        event.local_date,
        event.plate_key,
        event.plate_text,
        event.trigger_key,
        event.camera_id,
        event.alarm_name,
        event.raw_trigger_json,
        event.image_base64 || imageBase64 || null
      )
    ),
  ];

  let eventsInserted = 0;
  let duplicates = 0;
  let vehiclesInserted = 0;
  let vehicleDuplicates = 0;

  if (childStatements.length > 0) {
    const results = await env.DB.batch(childStatements);
    const faceEnd = faceEvents.length;
    for (let i = 0; i < faceEnd; i++) {
      const changes = results[i].meta?.changes ?? 0;
      if (changes > 0) eventsInserted += 1;
      else duplicates += 1;
    }
    for (let i = faceEnd; i < results.length; i++) {
      const changes = results[i].meta?.changes ?? 0;
      if (changes > 0) vehiclesInserted += 1;
      else vehicleDuplicates += 1;
    }
  }

  return {
    notificationInserted,
    notificationId: canonicalId,
    eventsAttempted: faceEvents.length,
    eventsInserted,
    duplicates,
    vehiclesAttempted: vehicleEvents.length,
    vehiclesInserted,
    vehicleDuplicates,
  };
}
