import type { Env } from "../types.js";
import {
  AccessAuthError,
  authenticateAccessRequest,
  tryLocalAuthBypass,
  type AccessIdentity,
} from "./cloudflareAccess.js";
import { htmlResponse, jsonResponse } from "../http/responses.js";
import { withRequestIdHeader } from "../http/requestId.js";
import { renderAccessDenied } from "../ui/accessDenied.js";

export type AuthGate = { ok: true; identity: AccessIdentity } | { ok: false; response: Response };

/**
 * Cloudflare Access gate for dashboard HTML/JSON routes.
 * Edge Access is defense-in-depth; this still validates JWT + ALLOWED_EMAILS.
 */
export async function requireAccessAuth(
  request: Request,
  env: Env,
  mode: "html" | "json",
  requestId: string
): Promise<AuthGate> {
  try {
    let identity: AccessIdentity;
    try {
      identity = await authenticateAccessRequest(request, env);
    } catch (err) {
      if (
        err instanceof AccessAuthError &&
        err.failureClass === "MISSING_ASSERTION" &&
        env.ALLOW_LOCAL_AUTH_BYPASS?.trim().toLowerCase() === "true"
      ) {
        const bypass = tryLocalAuthBypass(request, env);
        if (bypass) identity = bypass;
        else throw err;
      } else {
        throw err;
      }
    }

    return { ok: true, identity };
  } catch (err) {
    const failureClass = err instanceof AccessAuthError ? err.failureClass : "VALIDATION_FAILED";
    console.error(
      "[access]",
      requestId,
      request.method,
      new URL(request.url).pathname,
      failureClass
    );
    try {
      void env.KV.put("ops:last_access_jwt_failure_class", failureClass).catch(() => undefined);
    } catch {
      // KV unavailable in tests or degraded runtime — do not fail the auth response.
    }

    const status =
      failureClass === "EMAIL_NOT_ALLOWED" || failureClass === "CONFIG_INVALID" ? 403 : 401;

    if (mode === "json") {
      return {
        ok: false,
        response: jsonResponse(
          { error: status === 403 ? "Forbidden" : "Unauthorized" },
          { status, extra: withRequestIdHeader(undefined, requestId) }
        ),
      };
    }

    return {
      ok: false,
      response: htmlResponse(renderAccessDenied(), {
        status: 403,
        extra: withRequestIdHeader(undefined, requestId),
      }),
    };
  }
}
