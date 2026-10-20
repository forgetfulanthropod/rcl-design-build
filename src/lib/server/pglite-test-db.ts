/**
 * Test-only: a fresh in-memory PGLite with every migrations/*.sql applied, the same way the
 * app's PGLite fallback and scripts/migrate.mjs do (basename-keyed _migrations). Used by the
 * server tests under node:test. Never imported by the app.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pendingMigrations } from "../../../scripts/migration-plan.mjs";
import type { Sql } from "../db.ts";

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "migrations");

export async function applyMigrations(pg: PGlite, only?: (name: string) => boolean): Promise<string[]> {
  await pg.exec("create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())");
  const done = (await pg.query<{ name: string }>("select name from _migrations")).rows.map((r) => r.name);
  const files = readdirSync(MIGRATIONS).map((name) => `/migrations/${name}`);
  const applied: string[] = [];
  for (const { name } of pendingMigrations(files, done)) {
    if (only && !only(name)) continue;
    await pg.transaction(async (tx) => {
      await tx.exec(readFileSync(join(MIGRATIONS, name), "utf8"));
      await tx.query("insert into _migrations (name) values ($1)", [name]);
    });
    applied.push(name);
  }
  return applied;
}

export function sqlFor(pg: PGlite): Sql {
  const run = async <T>(text: string, params: unknown[]) => (await pg.query<T>(text, params)).rows;
  const sql = (async <T>(strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = strings[0];
    for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1]}`;
    return run<T>(text, values);
  }) as Sql;
  sql.query = <T>(text: string, params: unknown[] = []) => run<T>(text, params);
  return sql;
}

export async function freshDb(): Promise<{ pg: PGlite; sql: Sql }> {
  const pg = new PGlite({ parsers: { 20: Number, 1082: (v: string) => v } });
  await pg.waitReady;
  await applyMigrations(pg);
  return { pg, sql: sqlFor(pg) };
}
