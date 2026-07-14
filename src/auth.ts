import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import type { Env } from "./types.js";
import { isEmailAllowed } from "./auth-allowlist.js";

const DEFAULT_BASE_URL = "https://unifi-protect-assistant.mrcoffee.workers.dev";

export { isEmailAllowed, parseAllowedEmails } from "./auth-allowlist.js";

export function createAuth(env: Env, baseURL?: string) {
  const resolvedBaseURL = baseURL || env.BETTER_AUTH_URL || DEFAULT_BASE_URL;

  return betterAuth({
    database: env.DB,
    baseURL: resolvedBaseURL,
    // Prefer dedicated signing secret; allow BETTER_AUTH_API_KEY as fallback
    secret: env.BETTER_AUTH_SECRET || env.BETTER_AUTH_API_KEY,
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID as string,
        clientSecret: env.GOOGLE_CLIENT_SECRET as string,
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (!isEmailAllowed(user.email, env)) {
              throw new APIError("BAD_REQUEST", {
                message: "Your email is not authorized to access this app",
              });
            }
            return { data: user };
          },
        },
      },
    },
  });
}

export type AppAuth = ReturnType<typeof createAuth>;
