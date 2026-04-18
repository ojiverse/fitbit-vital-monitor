import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";

const MIGRATION_PATH = resolve(
  new URL(".", import.meta.url).pathname,
  "../../../../migrations/0001_initial.sql",
);

export type FakeD1 = D1Database & { readonly _raw: Database.Database };

export function createFakeD1(): FakeD1 {
  const raw = new Database(":memory:");
  raw.exec(readFileSync(MIGRATION_PATH, "utf8"));
  const d1 = adaptDatabase(raw);
  return Object.assign(d1, { _raw: raw });
}

function adaptDatabase(raw: Database.Database): D1Database {
  const api = {
    prepare(sql: string): D1PreparedStatement {
      return buildStatement(raw, sql, []);
    },
    async batch<T = unknown>(
      statements: ReadonlyArray<D1PreparedStatement>,
    ): Promise<Array<D1Result<T>>> {
      const results: Array<D1Result<T>> = [];
      for (const stmt of statements) {
        results.push((await stmt.run<T>()) as D1Result<T>);
      }
      return results;
    },
    async exec(sql: string): Promise<D1ExecResult> {
      raw.exec(sql);
      return { count: 0, duration: 0 };
    },
    dump(): Promise<ArrayBuffer> {
      throw new Error("dump() not implemented in fake D1");
    },
    withSession(): unknown {
      throw new Error("withSession() not implemented in fake D1");
    },
  };
  return api as unknown as D1Database;
}

function buildStatement(
  raw: Database.Database,
  sql: string,
  boundParams: ReadonlyArray<unknown>,
): D1PreparedStatement {
  const apply = <T>(fn: (stmt: Database.Statement) => T): T => {
    const prepared = raw.prepare(sql);
    return fn(prepared);
  };

  const stmt: Partial<D1PreparedStatement> = {
    bind(...values: unknown[]): D1PreparedStatement {
      return buildStatement(raw, sql, [...boundParams, ...values]);
    },
    async first<T = unknown>(_column?: string): Promise<T | null> {
      return apply((s) => {
        const row = s.get(...(boundParams as unknown[]));
        return (row ?? null) as T | null;
      });
    },
    async run<T = unknown>(): Promise<D1Result<T>> {
      return apply((s) => {
        const info = s.run(...(boundParams as unknown[]));
        return {
          success: true,
          meta: {
            duration: 0,
            changes: info.changes,
            last_row_id: Number(info.lastInsertRowid),
            size_after: 0,
            rows_read: 0,
            rows_written: info.changes,
          },
          results: [] as T[],
        } as unknown as D1Result<T>;
      });
    },
    async all<T = unknown>(): Promise<D1Result<T>> {
      return apply((s) => {
        const rows = s.all(...(boundParams as unknown[])) as T[];
        return {
          success: true,
          meta: {
            duration: 0,
            changes: 0,
            last_row_id: 0,
            size_after: 0,
            rows_read: rows.length,
            rows_written: 0,
          },
          results: rows,
        } as unknown as D1Result<T>;
      });
    },
  };
  return stmt as unknown as D1PreparedStatement;
}
