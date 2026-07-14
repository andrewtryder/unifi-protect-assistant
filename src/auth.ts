import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { dash } from "@better-auth/infra";
import type { Env } from "./types.js";
import { isEmailAllowed } from "./auth-allowlist.js";

const DEFAULT_BASE_URL = "https://unifi-protect-assistant.mrcoffee.workers.dev";

export { isEmailAllowed, parseAllowedEmails } from "./auth-allowlist.js";

export function createAuth(env: Env, baseURL?: string) {
  const resolvedBaseURL = baseURL || env.BETTER_AUTH_URL || DEFAULT_BASE_URL;

  return betterAuth({
    appName: "UniFi Protect Assistant",
    database: env.DB,
    baseURL: resolvedBaseURL,
    secret: env.BETTER_AUTH_SECRET,
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID as string,
        clientSecret: env.GOOGLE_CLIENT_SECRET as string,
      },
    },
    plugins: [
      dash({
        apiKey: env.BETTER_AUTH_API_KEY as string,
      }),
    ],
    advanced: {
      ipAddress: {
        // Cloudflare sets the true client IP; x-forwarded-for as fallback
        ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for"],
      },
    },
    experimental: {
      joins: true,
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
