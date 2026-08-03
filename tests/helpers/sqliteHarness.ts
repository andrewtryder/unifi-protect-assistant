/**
 * In-process SQLite harness (node:sqlite DatabaseSync) with a thin D1-shaped adapter
 * so production D1 call sites can run against real foreign keys and migrations.
 *
 * DatabaseSync is loaded via createRequire so Vitest/Vite does not rewrite `node:sqlite`
 * into a bare `sqlite` package import.
 */
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Env } from "../../src/types.js";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as {
  DatabaseSync: new (path: string) => SqliteDb;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const REPO_ROOT = join(__dirname, "..", "..");
export const MIGRATIONS_DIR = join(REPO_ROOT, "migrations");

/** Minimal surface of node:sqlite DatabaseSync used by the harness. */
export interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
}

export interface D1Meta {
  changes: number;
}

export interface D1RunResult {
  success: boolean;
  meta: D1Meta;
  results: unknown[];
}

export interface D1AllResult<T = unknown> {
  success: boolean;
  meta: D1Meta;
  results: T[];
}

/** Bound (or unbound) statement matching the D1 prepared-statement surface we use. */
export interface D1LikeStatement {
  bind(...args: unknown[]): D1LikeStatement;
  run(): Promise<D1RunResult>;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<D1AllResult<T>>;
  /** Internal: used by batch() */
  readonly _sql: string;
  readonly _args: unknown[];
}

export interface D1LikeDatabase {
  prepare(sql: string): D1LikeStatement;
  batch<T = unknown>(statements: D1LikeStatement[]): Promise<T[]>;
  exec(sql: string): Promise<D1RunResult>;
}

function listMigrationFiles(
  migrationsDir: string,
  predicate?: (name: string) => boolean
): string[] {
  return readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .filter((name) => (predicate ? predicate(name) : true))
    .sort();
}

/**
 * Apply SQL migration files in lexical order. Re-enables foreign_keys after each
 * file so deferred rebuilds inside migrations do not leave FKs off.
 */
export function applyMigrations(
  db: SqliteDb,
  migrationsDir: string,
  predicate?: (name: string) => boolean
): string[] {
  const files = listMigrationFiles(migrationsDir, predicate);
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    db.exec(sql);
    db.exec("PRAGMA foreign_keys = ON");
  }
  return files;
}

function openDb(): SqliteDb {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

/** Fresh in-memory DB with every migration applied (0001…latest). */
export function createMigratedDb(migrationsDir: string = MIGRATIONS_DIR): SqliteDb {
  const db = openDb();
  applyMigrations(db, migrationsDir);
  return db;
}

/** Fresh in-memory DB with migrations 0001–0007 only (before retention FK redesign). */
export function createPreMigrationDb(migrationsDir: string = MIGRATIONS_DIR): SqliteDb {
  const db = openDb();
  applyMigrations(db, migrationsDir, (name) => {
    const match = /^(\d+)/.exec(name);
    if (!match) return false;
    const n = Number(match[1]);
    return n >= 1 && n <= 7;
  });
  return db;
}

function makeStatement(db: SqliteDb, sql: string, args: unknown[] = []): D1LikeStatement {
  const runSync = (): D1RunResult => {
    const result = db.prepare(sql).run(...(args as never[]));
    return {
      success: true,
      meta: { changes: Number(result.changes ?? 0) },
      results: [],
    };
  };

  const statement: D1LikeStatement = {
    _sql: sql,
    _args: args,
    bind(...bindArgs: unknown[]) {
      return makeStatement(db, sql, bindArgs);
    },
    async run() {
      return runSync();
    },
    async first<T = unknown>() {
      const row = db.prepare(sql).get(...(args as never[]));
      return (row as T) ?? null;
    },
    async all<T = unknown>() {
      const results = db.prepare(sql).all(...(args as never[])) as T[];
      return {
        success: true,
        meta: { changes: 0 },
        results,
      };
    },
  };
  return statement;
}

/** Wrap DatabaseSync as a D1Database-compatible subset. */
export function wrapD1(db: SqliteDb): D1LikeDatabase {
  return {
    prepare(sql: string) {
      return makeStatement(db, sql, []);
    },
    async batch<T = unknown>(statements: D1LikeStatement[]): Promise<T[]> {
      const out: T[] = [];
      db.exec("BEGIN");
      try {
        for (const stmt of statements) {
          const result = db.prepare(stmt._sql).run(...(stmt._args as never[]));
          out.push({
            success: true,
            meta: { changes: Number(result.changes ?? 0) },
            results: [],
          } as T);
        }
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
      return out;
    },
    async exec(sql: string) {
      db.exec(sql);
      return { success: true, meta: { changes: 0 }, results: [] };
    },
  };
}

/** Minimal in-memory KV matching the KVNamespace methods used by this app. */
export function createMemoryKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    async get(key: string, type?: string) {
      const value = store.get(key) ?? null;
      if (value == null) return null;
      if (type === "json") {
        try {
          return JSON.parse(value);
        } catch {
          return null;
        }
      }
      return value;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list() {
      return {
        keys: [...store.keys()].map((name) => ({ name })),
        list_complete: true,
        cacheStatus: null,
      };
    },
    async getWithMetadata() {
      return { value: null, metadata: null, cacheStatus: null };
    },
  } as unknown as KVNamespace;
}

export function createTestEnv(db: SqliteDb, overrides: Partial<Env> = {}): Env {
  return {
    DB: wrapD1(db) as unknown as D1Database,
    KV: createMemoryKv(),
    TIMEZONE: "America/New_York",
    ...overrides,
  };
}

export function foreignKeyViolations(db: SqliteDb): unknown[] {
  return db.prepare("PRAGMA foreign_key_check").all();
}

export function assertForeignKeysOk(db: SqliteDb): void {
  const violations = foreignKeyViolations(db);
  if (violations.length > 0) {
    throw new Error(`PRAGMA foreign_key_check returned ${violations.length} row(s)`);
  }
}
