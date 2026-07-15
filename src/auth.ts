import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { dash } from "@better-auth/infra";
import type { Env } from "./types.js";
import { isEmailAllowed } from "./auth-allowlist.js";

export { isEmailAllowed, parseAllowedEmails } from "./auth-allowlist.js";

export function createAuth(env: Env) {
  const baseURL = env.BETTER_AUTH_URL?.trim();

  if (!baseURL) {
    throw new Error("BETTER_AUTH_URL is required");
  }

  return betterAuth({
    appName: "UniFi Protect Assistant",
    database: env.DB,
    baseURL,
    trustedOrigins: [baseURL],
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
      useSecureCookies: true,
      ipAddress: {
        // Cloudflare's single original-client IP; do not fall back to X-Forwarded-For
        ipAddressHeaders: ["cf-connecting-ip"],
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
