import { Env, FaceEvent } from "../types.js";

export interface IngestResult {
  eventsAttempted: number;
  eventsInserted: number;
  duplicates: number;
}

/**
 * Inserts the raw webhook notification and normalized face events using prepared statements inside a D1 batch.
 * Face events use INSERT OR IGNORE (unique event_id); duplicates are counted from meta.changes.
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
  imageBase64?: string
): Promise<IngestResult> {
  const insertNotificationStmt = env.DB.prepare(`
    INSERT INTO webhook_notifications (id, received_at_ms, source_ip, event_id, alarm_name, payload_json, image_base64)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(notificationId, receivedAtMs, sourceIp, eventId, alarmName, rawPayload, imageBase64 || null);

  const statements = [insertNotificationStmt];

  for (const event of faceEvents) {
    const insertEventStmt = env.DB.prepare(`
      INSERT OR IGNORE INTO face_events (
        id, notification_id, event_id, seen_at_ms, local_date,
        person_key, person_name, person_id, trigger_key, camera_id,
        alarm_name, raw_trigger_json, image_base64
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
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

  const results = await env.DB.batch(statements);

  let eventsInserted = 0;
  let duplicates = 0;
  // results[0] is the notification insert; results[1..] are face event inserts
  for (let i = 1; i < results.length; i++) {
    const changes = results[i].meta?.changes ?? 0;
    if (changes > 0) eventsInserted += 1;
    else duplicates += 1;
  }

  return {
    eventsAttempted: faceEvents.length,
    eventsInserted,
    duplicates,
  };
}
