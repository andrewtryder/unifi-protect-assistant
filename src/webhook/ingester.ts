import { Env, FaceEvent } from "../types.js";

/**
 * Inserts the raw webhook notification and normalized face events using prepared statements inside a D1 transaction.
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
): Promise<void> {
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

  // Execute all inside a transaction
  await env.DB.batch(statements);
}
