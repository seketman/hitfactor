import { describe, expect, it } from "vitest";
import { FakeSupabase } from "./helpers/supabase-mock";
import type { TypedSupabaseClient } from "@/lib/supabase/types";
import {
  deleteMatch,
  updateEntryAbsent,
  updateMatchClub,
  updateMatchMinShots,
} from "@/lib/db/matches";

/**
 * Helpers de escritura de `db/matches.ts` (#196, #197).
 *
 * Lo que se verifica acá es que **devuelvan cuántas filas tocaron**.
 * PostgREST no devuelve error cuando la RLS filtra todas las filas de un
 * UPDATE/DELETE: devuelve 200 con body vacío. Sin ese conteo, el server
 * action no puede distinguir "la base lo rechazó" de "salió bien", y
 * termina auditando y confirmando operaciones que nunca pasaron.
 *
 * El mock filtra por los mismos `.eq()` que la query real, así que un id
 * que no matchea produce el mismo resultado observable que una RLS que
 * deniega: cero filas, sin error.
 */

const ALICE = "alice-uuid";
const BOB = "bob-uuid";

function clientWithMatch(overrides: Record<string, unknown> = {}) {
  const db = new FakeSupabase();
  db.seed("matches", [
    {
      id: "match-1",
      name: "Social 4",
      region: "ARG-TFALP",
      min_shots: null,
      imported_by_user_id: ALICE,
      ...overrides,
    },
  ]);
  return { db, client: db.asClient() as unknown as TypedSupabaseClient };
}

describe("deleteMatch", () => {
  it("informa la fila borrada y la saca de la tabla", async () => {
    const { db, client } = clientWithMatch();

    const { affected, error } = await deleteMatch(client, "match-1");

    expect(error).toBeNull();
    expect(affected).toBe(1);
    expect(db.tables.matches!.rows).toHaveLength(0);
  });

  it("devuelve affected 0 sin error cuando no toca ninguna fila", async () => {
    const { db, client } = clientWithMatch();

    const { affected, error } = await deleteMatch(client, "match-inexistente");

    // Este es el caso exacto que producía el audit log falso: sin error,
    // pero sin haber borrado nada.
    expect(error).toBeNull();
    expect(affected).toBe(0);
    expect(db.tables.matches!.rows).toHaveLength(1);
  });
});

describe("updateMatchClub", () => {
  it("actualiza un match importado por OTRA persona (regresión #197)", async () => {
    // El caso del admin. La versión anterior filtraba por
    // `.eq("imported_by_user_id", userId)`, así que esto afectaba 0 filas
    // y el admin no podía completar el club de un match ajeno — aunque la
    // RLS (matches_update_admin, 0014) y canEditMatch dijeran que sí.
    const { db, client } = clientWithMatch({ imported_by_user_id: BOB });

    const { affected, error } = await updateMatchClub(
      client,
      "match-1",
      "ARG-TFABA",
    );

    expect(error).toBeNull();
    expect(affected).toBe(1);
    expect(db.tables.matches!.rows[0]!.region).toBe("ARG-TFABA");
  });

  it("acepta null para dejar el club sin especificar", async () => {
    const { db, client } = clientWithMatch();

    const { affected } = await updateMatchClub(client, "match-1", null);

    expect(affected).toBe(1);
    expect(db.tables.matches!.rows[0]!.region).toBeNull();
  });

  it("devuelve affected 0 sin error cuando no toca ninguna fila", async () => {
    const { client } = clientWithMatch();

    const { affected, error } = await updateMatchClub(client, "otro", "X");

    expect(error).toBeNull();
    expect(affected).toBe(0);
  });
});

describe("updateMatchMinShots", () => {
  it("informa la fila actualizada", async () => {
    const { db, client } = clientWithMatch();

    const { affected } = await updateMatchMinShots(client, "match-1", 45);

    expect(affected).toBe(1);
    expect(db.tables.matches!.rows[0]!.min_shots).toBe(45);
  });

  it("devuelve affected 0 sin error cuando no toca ninguna fila", async () => {
    const { client } = clientWithMatch();

    const { affected, error } = await updateMatchMinShots(client, "otro", 45);

    expect(error).toBeNull();
    expect(affected).toBe(0);
  });
});

describe("updateEntryAbsent", () => {
  it("informa la fila actualizada", async () => {
    const db = new FakeSupabase();
    db.seed("match_entries", [{ id: "entry-1", is_absent: false }]);
    const client = db.asClient() as unknown as TypedSupabaseClient;

    const { affected } = await updateEntryAbsent(client, "entry-1", true);

    expect(affected).toBe(1);
    expect(db.tables.match_entries!.rows[0]!.is_absent).toBe(true);
  });

  it("devuelve affected 0 sin error cuando no toca ninguna fila", async () => {
    const db = new FakeSupabase();
    db.seed("match_entries", [{ id: "entry-1", is_absent: false }]);
    const client = db.asClient() as unknown as TypedSupabaseClient;

    const { affected, error } = await updateEntryAbsent(client, "otra", true);

    expect(error).toBeNull();
    expect(affected).toBe(0);
  });
});
