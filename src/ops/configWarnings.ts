import type { Env } from "../types.js";
import { collectConfigWarnings } from "../config.js";

/**
 * Soft config warnings for the health page.
 * Hard fail-closed validation lives in parseAppConfig.
 */
export function getConfigWarnings(env: Env): string[] {
  return collectConfigWarnings(env);
}
