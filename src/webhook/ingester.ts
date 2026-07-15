import { Env, FaceEvent, VehicleEvent } from "../types.js";

export interface IngestResult {
  eventsAttempted: number;
  eventsInserted: number;
  duplicates: number;
  vehiclesAttempted: number;
  vehiclesInserted: number;
  vehicleDuplicates: number;
}

/**
 * Inserts the raw webhook notification plus face and vehicle events in one D1 batch.
 * Events use INSERT OR IGNORE (unique event_id); duplicates are counted from meta.changes.
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
  imageBase64?: string,
  vehicleEvents: VehicleEvent[] = []
): Promise<IngestResult> {
  const insertNotificationStmt = env.DB.prepare(
    `
    INSERT INTO webhook_notifications (id, received_at_ms, source_ip, event_id, alarm_name, payload_json, image_base64)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `
  ).bind(
    notificationId,
    receivedAtMs,
    sourceIp,
    eventId,
    alarmName,
    rawPayload,
    imageBase64 || null
  );

  const statements = [insertNotificationStmt];

  for (const event of faceEvents) {
    const insertEventStmt = env.DB.prepare(
      `
      INSERT OR IGNORE INTO face_events (
        id, notification_id, event_id, seen_at_ms, local_date,
        person_key, person_name, person_id, trigger_key, camera_id,
        alarm_name, raw_trigger_json, image_base64
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).bind(
      event.id,
      event.notification_id,
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
    );
    statements.push(insertEventStmt);
  }

  for (const event of vehicleEvents) {
    const insertVehicleStmt = env.DB.prepare(
      `
      INSERT OR IGNORE INTO vehicle_events (
        id, notification_id, event_id, seen_at_ms, local_date,
        plate_key, plate_text, trigger_key, camera_id,
        alarm_name, raw_trigger_json, image_base64
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).bind(
      event.id,
      event.notification_id,
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
    );
    statements.push(insertVehicleStmt);
  }

  const results = await env.DB.batch(statements);

  let eventsInserted = 0;
  let duplicates = 0;
  const faceEnd = 1 + faceEvents.length;
  for (let i = 1; i < faceEnd; i++) {
    const changes = results[i].meta?.changes ?? 0;
    if (changes > 0) eventsInserted += 1;
    else duplicates += 1;
  }

  let vehiclesInserted = 0;
  let vehicleDuplicates = 0;
  for (let i = faceEnd; i < results.length; i++) {
    const changes = results[i].meta?.changes ?? 0;
    if (changes > 0) vehiclesInserted += 1;
    else vehicleDuplicates += 1;
  }

  return {
    eventsAttempted: faceEvents.length,
    eventsInserted,
    duplicates,
    vehiclesAttempted: vehicleEvents.length,
    vehiclesInserted,
    vehicleDuplicates,
  };
}
