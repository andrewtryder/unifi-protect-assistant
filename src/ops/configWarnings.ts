import type { Env } from "../types.js";
import { collectConfigWarnings } from "../config.js";

export function getConfigWarnings(env: Env): string[] {
  return collectConfigWarnings(env);
}
