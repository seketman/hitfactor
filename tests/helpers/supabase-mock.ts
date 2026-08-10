/**
 * Mock minimalista del cliente Supabase para testear el importer sin DB real.
 *
 * Soporta las queries que el importer hace:
 *  - select / eq / ilike / is / maybeSingle / single
 *  - insert / select / single (insert con returning)
 *  - update / eq / is
 *  - upsert
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;
type WhereClause = (row: Row) => boolean;

export interface MockTable {
  rows: Row[];
  /** Si está seteado, falla todos los inserts con este código de error. */
  insertError?: { code: string; message: string };
  /**
   * Si está seteado, falla todos los upserts con este código de error.
   *
   * Existe para poder testear la compensación del import (#205): lo que hay
   * que provocar es que el match se inserte y el paso siguiente falle, y ese
   * paso siguiente escribe con `upsert`, no con `insert`.
   */
  upsertError?: { code: string; message: string };
  /** Auto-increment para columnas tipo id. */
  nextId?: number;
}

/**
 * Relaciones que el mock sabe resolver cuando la proyección pide un
 * agregado embebido tipo `match_entries(count)`.
 *
 * PostgREST devuelve esos agregados como `[{ count: n }]` dentro de cada
 * fila del padre, y `findUserMatch` los usa para saber si un match tiene
 * resultados sin pagar un segundo round-trip. El mock ignoraba la
 * proyección por completo, así que sin esto el conteo volvía siempre 0 y
 * un re-upload legítimo se veía igual que un match huérfano.
 *
 * Se declara explícito en vez de derivar la FK del nombre de la tabla:
 * "matches" → "match_id" sale bien por casualidad, y una regla que acierta
 * por casualidad falla en silencio con la próxima tabla.
 */
const EMBEDDED_COUNTS: Record<string, { childTable: string; fk: string }> = {
  match_entries: { childTable: "match_entries", fk: "match_id" },
};

export class FakeSupabase {
  tables: Record<string, MockTable> = {};

  table(name: string): MockTable {
    if (!this.tables[name]) {
      this.tables[name] = { rows: [], nextId: 1 };
    }
    return this.tables[name];
  }

  seed(name: string, rows: Row[]): void {
    this.table(name).rows.push(...rows);
  }

  asClient(): SupabaseClient {
    // Truco: devolvemos `this` casteado, exponiendo solo `from()`.
    return { from: (name: string) => this.from(name) } as unknown as SupabaseClient;
  }

  from(tableName: string) {
    const table = this.table(tableName);
    return new QueryBuilder(table, tableName, this);
  }
}

class QueryBuilder {
  private mode: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private filters: WhereClause[] = [];
  private projection?: string;
  private payload?: Row | Row[];
  private upsertConflictKey?: string[];
  private orderClauses: { col: string; asc: boolean }[] = [];
  private limitN?: number;

  constructor(
    private table: MockTable,
    private tableName: string,
    private db: FakeSupabase,
  ) {}

  select(projection?: string): this {
    this.projection = projection;
    if (this.mode === "select") this.mode = "select";
    return this;
  }

  insert(payload: Row | Row[]): this {
    this.mode = "insert";
    this.payload = payload;
    return this;
  }

  update(payload: Row): this {
    this.mode = "update";
    this.payload = payload;
    return this;
  }

  upsert(payload: Row | Row[], opts?: { onConflict?: string }): this {
    this.mode = "upsert";
    this.payload = payload;
    if (opts?.onConflict) this.upsertConflictKey = opts.onConflict.split(",");
    return this;
  }

  delete(): this {
    this.mode = "delete";
    return this;
  }

  eq(col: string, val: unknown): this {
    this.filters.push((row) => row[col] === val);
    return this;
  }

  is(col: string, val: unknown): this {
    this.filters.push((row) => row[col] === val);
    return this;
  }

  ilike(col: string, val: string): this {
    const pattern = String(val).toLowerCase();
    this.filters.push((row) =>
      String(row[col] ?? "").toLowerCase() === pattern,
    );
    return this;
  }

  in(col: string, vals: readonly unknown[]): this {
    const set = new Set(vals);
    this.filters.push((row) => set.has(row[col]));
    return this;
  }

  order(col: string, opts?: { ascending?: boolean }): this {
    this.orderClauses.push({ col, asc: opts?.ascending ?? true });
    return this;
  }

  limit(n: number): this {
    this.limitN = n;
    return this;
  }

  // --- Terminators -------------------------------------------------------

  async maybeSingle(): Promise<{ data: Row | null; error: null }> {
    const rows = this.runRead();
    return { data: rows[0] ?? null, error: null };
  }

  async single(): Promise<{ data: Row | null; error: { code: string; message: string } | null }> {
    if (this.mode === "select") {
      const rows = this.runRead();
      if (rows.length === 0) {
        return {
          data: null,
          error: { code: "PGRST116", message: "No rows found" },
        };
      }
      return { data: rows[0], error: null };
    }

    if (this.mode === "insert") {
      try {
        const inserted = this.runInsert();
        return { data: inserted[0], error: null };
      } catch (e) {
        const err = e as { code?: string; message?: string };
        return {
          data: null,
          error: { code: err.code ?? "ERR", message: err.message ?? "" },
        };
      }
    }

    throw new Error(`single() no soportado para ${this.mode}`);
  }

  // Para inserts/updates sin .select().single() — promesa directa.
  then(
    onFulfilled: (v: { data: Row[] | null; error: { code: string; message: string } | null }) => unknown,
  ) {
    let result: { data: Row[] | null; error: { code: string; message: string } | null };
    try {
      if (this.mode === "insert") {
        result = { data: this.runInsert(), error: null };
      } else if (this.mode === "update") {
        result = { data: this.runUpdate(), error: null };
      } else if (this.mode === "upsert") {
        result = { data: this.runUpsert(), error: null };
      } else if (this.mode === "delete") {
        result = { data: this.runDelete(), error: null };
      } else {
        result = { data: this.runRead(), error: null };
      }
    } catch (e) {
      const err = e as { code?: string; message?: string };
      result = {
        data: null,
        error: { code: err.code ?? "ERR", message: err.message ?? "" },
      };
    }
    return Promise.resolve(onFulfilled(result));
  }

  private runRead(): Row[] {
    let rows = this.table.rows.filter((r) => this.filters.every((f) => f(r)));
    for (const o of this.orderClauses) {
      rows = [...rows].sort((a, b) => {
        const av = a[o.col] as string | number;
        const bv = b[o.col] as string | number;
        if (av === bv) return 0;
        const cmp = av > bv ? 1 : -1;
        return o.asc ? cmp : -cmp;
      });
    }
    if (this.limitN !== undefined) rows = rows.slice(0, this.limitN);
    return rows.map((r) => this.withEmbeddedCounts(r));
  }

  /**
   * Adjunta los agregados embebidos que pida la proyección, con la forma en
   * que los devuelve PostgREST: `{ match_entries: [{ count: n }] }`.
   *
   * Devuelve una copia cuando hay algo que adjuntar, para no ensuciar la
   * fila guardada en la tabla del mock — si mutara, un test que lee dos
   * veces vería el conteo de la primera lectura.
   */
  private withEmbeddedCounts(row: Row): Row {
    if (!this.projection) return row;
    let out: Row | null = null;
    for (const [name, rel] of Object.entries(EMBEDDED_COUNTS)) {
      if (!this.projection.includes(`${name}(count)`)) continue;
      const count = this.db
        .table(rel.childTable)
        .rows.filter((c) => c[rel.fk] === row.id).length;
      out ??= { ...row };
      out[name] = [{ count }];
    }
    return out ?? row;
  }

  private runInsert(): Row[] {
    if (this.table.insertError) {
      throw this.table.insertError;
    }
    const items = Array.isArray(this.payload) ? this.payload : [this.payload];
    const inserted: Row[] = [];
    for (const item of items) {
      const newRow: Row = { ...item };
      if (newRow.id === undefined) {
        newRow.id = `${this.tableName}-${this.table.nextId}`;
        this.table.nextId = (this.table.nextId ?? 1) + 1;
      }
      this.table.rows.push(newRow);
      inserted.push(newRow);
    }
    return inserted;
  }

  private runUpdate(): Row[] {
    const updated: Row[] = [];
    for (const row of this.table.rows) {
      if (this.filters.every((f) => f(row))) {
        Object.assign(row, this.payload as Row);
        updated.push(row);
      }
    }
    return updated;
  }

  private runUpsert(): Row[] {
    if (this.table.upsertError) {
      throw this.table.upsertError;
    }
    const items = Array.isArray(this.payload) ? this.payload : [this.payload];
    const result: Row[] = [];
    for (const item of items) {
      const item2 = item as Row;
      const existing = this.table.rows.find((r) =>
        (this.upsertConflictKey ?? []).every((k) => r[k] === item2[k]),
      );
      if (existing) {
        Object.assign(existing, item2);
        result.push(existing);
      } else {
        const newRow: Row = { ...item2 };
        if (newRow.id === undefined) {
          newRow.id = `${this.tableName}-${this.table.nextId}`;
          this.table.nextId = (this.table.nextId ?? 1) + 1;
        }
        this.table.rows.push(newRow);
        result.push(newRow);
      }
    }
    return result;
  }

  private runDelete(): Row[] {
    const kept: Row[] = [];
    const removed: Row[] = [];
    for (const r of this.table.rows) {
      if (this.filters.every((f) => f(r))) removed.push(r);
      else kept.push(r);
    }
    this.table.rows = kept;
    return removed;
  }
}
