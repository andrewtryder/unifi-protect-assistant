import type { Env, UnifiWebhookPayload } from "../types.js";
import { parseWebhookPayload, InvalidTimestampError } from "./parser.js";
import { normalizeJpegBase64 } from "./image.js";
import { ingestWebhook } from "./ingester.js";
import { computeDeliveryKey } from "./dedupe.js";
import { secretsEqual } from "./auth.js";
import { classifyDbError, incrementCounter, setD1Error } from "../ops/kvCounters.js";
import { reportError } from "../ops/honeybadger.js";
import { parseAppConfig, ConfigValidationError } from "../config.js";
import { BodyTooLargeError, readBodyWithLimit } from "../http/body.js";
import { withRequestIdHeader } from "../http/requestId.js";
import { genericErrorResponse, jsonResponse, methodNotAllowed } from "../http/responses.js";

export async function handleUnifiWebhook(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  requestId: string
): Promise<Response> {
  if (request.method !== "POST") {
    return methodNotAllowed(["POST"]);
  }

  let config;
  try {
    config = parseAppConfig(env, { requireSecure: false });
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      console.error("[webhook] config invalid", requestId, err.details.join("; "));
    }
    return genericErrorResponse(
      503,
      "Service Unavailable",
      withRequestIdHeader(undefined, requestId)
    );
  }

  // Fail closed: WEBHOOK_SECRET required unless explicit insecure opt-in
  if (!config.webhookSecret) {
    if (!config.allowInsecureWebhooks) {
      console.error("[webhook] WEBHOOK_SECRET missing", requestId);
      return genericErrorResponse(
        503,
        "Service Unavailable",
        withRequestIdHeader(undefined, requestId)
      );
    }
  } else {
    const secretHeader = request.headers.get("X-Webhook-Secret");
    const ok = await secretsEqual(secretHeader, config.webhookSecret);
    if (!ok) {
      ctx.waitUntil(incrementCounter(env, "rejected_auth").catch(() => undefined));
      return genericErrorResponse(401, "Unauthorized", withRequestIdHeader(undefined, requestId));
    }
  }

  try {
    // Validate timezone at request entry
    Intl.DateTimeFormat(undefined, { timeZone: config.timezone });

    const receivedAtMs = Date.now();
    const clientIp = request.headers.get("CF-Connecting-IP") || "0.0.0.0";
    let rawBody: string;
    try {
      rawBody = await readBodyWithLimit(request, config.maxWebhookBodyBytes);
    } catch (err) {
      if (err instanceof BodyTooLargeError) {
        ctx.waitUntil(incrementCounter(env, "rejected_body").catch(() => undefined));
        return genericErrorResponse(
          413,
          "Payload Too Large",
          withRequestIdHeader(undefined, requestId)
        );
      }
      throw err;
    }

    let payload: UnifiWebhookPayload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      ctx.waitUntil(incrementCounter(env, "rejected_json").catch(() => undefined));
      return genericErrorResponse(400, "Invalid JSON", withRequestIdHeader(undefined, requestId));
    }

    const notificationId = crypto.randomUUID();
    let faceEvents;
    let vehicleEvents;
    try {
      ({ faceEvents, vehicleEvents } = parseWebhookPayload(payload, notificationId, env));
    } catch (err) {
      if (
        err instanceof InvalidTimestampError ||
        (err instanceof Error && err.message === "INVALID_TIMEZONE")
      ) {
        ctx.waitUntil(incrementCounter(env, "rejected_json").catch(() => undefined));
        return genericErrorResponse(
          400,
          "Invalid request",
          withRequestIdHeader(undefined, requestId)
        );
      }
      throw err;
    }

    if (faceEvents.length === 0 && vehicleEvents.length === 0) {
      ctx.waitUntil(incrementCounter(env, "zero_face_webhooks").catch(() => undefined));
    }

    const eventId = payload.alarm?.triggers?.[0]?.eventId || "N/A";
    const alarmName = payload.alarm?.name || "N/A";
    const imageBase64 = normalizeJpegBase64(
      (payload as { image?: string }).image || payload.alarm?.image || ""
    );
    const deliveryKey = await computeDeliveryKey(payload);

    const ingestResult = await ingestWebhook(
      env,
      notificationId,
      receivedAtMs,
      clientIp,
      eventId,
      alarmName,
      rawBody,
      faceEvents,
      imageBase64,
      vehicleEvents,
      deliveryKey
    );

    ctx.waitUntil(
      (async () => {
        if (ingestResult.notificationInserted) {
          await incrementCounter(env, "ingested_webhooks");
        }
        if (ingestResult.eventsAttempted > 0) {
          await incrementCounter(env, "events_attempted", ingestResult.eventsAttempted);
        }
        if (ingestResult.eventsInserted > 0) {
          await incrementCounter(env, "events_inserted", ingestResult.eventsInserted);
        }
        if (ingestResult.duplicates > 0) {
          await incrementCounter(env, "duplicates", ingestResult.duplicates);
        }
        if (ingestResult.vehiclesAttempted > 0) {
          await incrementCounter(env, "vehicles_attempted", ingestResult.vehiclesAttempted);
        }
        if (ingestResult.vehiclesInserted > 0) {
          await incrementCounter(env, "vehicles_inserted", ingestResult.vehiclesInserted);
        }
        if (ingestResult.vehicleDuplicates > 0) {
          await incrementCounter(env, "vehicle_duplicates", ingestResult.vehicleDuplicates);
        }
      })().catch(() => undefined)
    );

    return jsonResponse(
      {
        success: true,
        events_ingested: ingestResult.eventsInserted,
        events_attempted: ingestResult.eventsAttempted,
        duplicates: ingestResult.duplicates,
        vehicles_ingested: ingestResult.vehiclesInserted,
        vehicles_attempted: ingestResult.vehiclesAttempted,
        vehicle_duplicates: ingestResult.vehicleDuplicates,
      },
      { extra: withRequestIdHeader(undefined, requestId) }
    );
  } catch (err: unknown) {
    const code = classifyDbError(err);
    console.error("[webhook] ingest failed", requestId, code);
    reportError(env, ctx, err, {
      component: "webhook",
      path: "/unifi",
      request_id: requestId,
      operation: "ingestWebhook",
      error_code: code,
    });
    ctx.waitUntil(
      (async () => {
        await incrementCounter(env, "d1_failures");
        await setD1Error(env, code, "ingestWebhook");
      })().catch(() => undefined)
    );
    const status = code.startsWith("D1_") ? 503 : 500;
    return genericErrorResponse(
      status,
      "Service Unavailable",
      withRequestIdHeader(undefined, requestId)
    );
  }
}
