import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakeSupabase } from "./helpers/supabase-mock";
import { parsePractiscoreHtml } from "@/lib/parsers/practiscore";
import { importParsedMatch, ImportError } from "@/lib/import/import-match";

const FIXTURES = join(__dirname, "fixtures", "practiscore");
const read = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

const USER_ID = "user-1";
const OTHER_USER = "user-2";

function buildSupabase(): FakeSupabase {
  const fake = new FakeSupabase();
  // Seed lookup tables (lo que normalmente está en la migración inicial).
  fake.seed("disciplines", [
    { id: 1, code: "ipsc", name: "Tiro Práctico", scoring_type: "hit_factor" },
  ]);
  fake.seed("divisions", [
    { id: 10, discipline_id: 1, code: "O", name: "Open" },
    { id: 11, discipline_id: 1, code: "P", name: "Production" },
    { id: 12, discipline_id: 1, code: "PO", name: "Production Optics" },
    { id: 13, discipline_id: 1, code: "PCC", name: "PCC" },
    { id: 14, discipline_id: 1, code: "PCCO", name: "PCC Optics" },
    { id: 15, discipline_id: 1, code: "S", name: "Standard" },
    { id: 16, discipline_id: 1, code: "SM", name: "Standard Manual" },
  ]);
  return fake;
}

describe("importParsedMatch — Match overall", () => {
  let fake: FakeSupabase;
  beforeEach(() => {
    fake = buildSupabase();
  });

  it("crea match + match_entries y registra al importador", async () => {
    const parsed = parsePractiscoreHtml(read("tp-escopeta-2026-02-20-match.html"));
    const result = await importParsedMatch(
      fake.asClient(),
      parsed,
      USER_ID,
      "test.html",
    );

    expect(result.existedAlready).toBe(false);
    expect(result.matchName).toBe("TP ESCOPETA 20/02/26 TFALP");
    expect(result.matchDate).toBe("2026-02-20");
    expect(result.insertedEntries).toBeGreaterThan(0);

    const [match] = fake.tables.matches.rows;
    expect(match.imported_by_user_id).toBe(USER_ID);
    expect(match.discipline_id).toBe(1);
    expect(match.source_filename).toBe("test.html");

    // Cantidad de match_entries == cantidad de filas en el HTML
    expect(fake.tables.match_entries.rows.length).toBe(parsed.matchEntries.length);
  });

  it("crea shooters faltantes con su nombre y número de socio", async () => {
    const parsed = parsePractiscoreHtml(read("tp-escopeta-2026-02-20-match.html"));
    await importParsedMatch(fake.asClient(), parsed, USER_ID, "f.html");

    const diego = fake.tables.shooters.rows.find(
      (s) => String(s.full_name).toLowerCase().includes("demarziani"),
    );
    expect(diego).toBeDefined();
    expect(diego!.linked_user_id).toBeUndefined(); // no auto-link

    const stocker = fake.tables.shooters.rows.find(
      (s) => String(s.full_name).includes("STOCKER"),
    );
    expect(stocker?.member_number).toBe("793");
  });

  it("reusa shooter existente en vez de duplicar", async () => {
    // Pre-creamos al shooter "Demarziani, Diego"
    fake.seed("shooters", [
      {
        id: "preexisting-shooter",
        full_name: "Demarziani, Diego",
        member_number: null,
        region: null,
        linked_user_id: USER_ID, // ya claimado por nuestro user
      },
    ]);

    const parsed = parsePractiscoreHtml(read("tp-escopeta-2026-02-20-match.html"));
    await importParsedMatch(fake.asClient(), parsed, USER_ID, "f.html");

    const diegos = fake.tables.shooters.rows.filter((s) =>
      String(s.full_name).toLowerCase().includes("demarziani"),
    );
    expect(diegos).toHaveLength(1);
    expect(diegos[0].linked_user_id).toBe(USER_ID); // no se rompe el link

    const diegoEntry = fake.tables.match_entries.rows.find(
      (e) => e.shooter_id === "preexisting-shooter",
    );
    expect(diegoEntry).toBeDefined();
    expect(diegoEntry!.division_id).toBe(11); // Production
  });

  it("respeta DQs y los marca con is_dq=true", async () => {
    const parsed = parsePractiscoreHtml(read("tp-escopeta-2026-02-20-match.html"));
    await importParsedMatch(fake.asClient(), parsed, USER_ID, "f.html");

    const dqs = fake.tables.match_entries.rows.filter((e) => e.is_dq);
    expect(dqs.length).toBeGreaterThan(0);
  });

  it("falla con MATCH_ALREADY_EXISTS si la DB devuelve unique violation", async () => {
    // Simulamos la unique constraint que tira la DB real.
    fake.tables.matches = {
      rows: [],
      nextId: 1,
      insertError: { code: "23505", message: "duplicate key" },
    };
    const parsed = parsePractiscoreHtml(read("tp-escopeta-2026-02-20-match.html"));

    await expect(
      importParsedMatch(fake.asClient(), parsed, USER_ID, "f.html"),
    ).rejects.toMatchObject({
      code: "MATCH_ALREADY_EXISTS",
    });
  });

  it("no duplica shooters cuando el mismo nombre aparece en múltiples divisiones (race fix)", async () => {
    // Reproducimos el caso FBI: un mismo tirador aparece varias veces en el
    // CSV (típicamente una por cada disciplina). Antes del fix, Promise.all
    // resolvía findOrCreateShooter en paralelo y creaba shooter rows duplicados.
    fake.seed("disciplines", [
      { id: 99, code: "tiro_fbi", name: "Tiro FBI", scoring_type: "points" },
    ]);
    fake.seed("divisions", [
      { id: 901, discipline_id: 99, code: "PIS", name: "Pistola" },
      { id: 902, discipline_id: 99, code: "PCC", name: "PCC" },
      { id: 903, discipline_id: 99, code: "MINI", name: "Minirifle" },
    ]);

    const repeatedShooter = {
      fullName: "Foradori Lucas",
      memberNumber: null,
      region: "TFALP",
    };
    const parsed = {
      discipline: "tiro_fbi" as const,
      source: "fbi_csv" as const,
      name: "Test Match",
      date: "2026-05-03",
      region: null,
      stages: [],
      generatedBy: null,
      matchEntries: [
        {
          shooter: repeatedShooter,
          divisionCode: "PIS",
          classification: null,
          powerFactor: null,
          category: "A",
          place: 1,
          matchPoints: 100,
          matchPercentage: 100,
          totalTimeSeconds: null,
          isDq: false,
        },
        {
          shooter: repeatedShooter,
          divisionCode: "PCC",
          classification: null,
          powerFactor: null,
          category: "A",
          place: 2,
          matchPoints: 95,
          matchPercentage: 95,
          totalTimeSeconds: null,
          isDq: false,
        },
        {
          shooter: repeatedShooter,
          divisionCode: "MINI",
          classification: null,
          powerFactor: null,
          category: "A",
          place: 3,
          matchPoints: 90,
          matchPercentage: 90,
          totalTimeSeconds: null,
          isDq: false,
        },
      ],
    };

    await importParsedMatch(fake.asClient(), parsed, USER_ID, "fbi.csv");

    const lucas = fake.tables.shooters.rows.filter(
      (s) => String(s.full_name).toLowerCase() === "foradori lucas",
    );
    expect(lucas).toHaveLength(1);

    // Y debe tener una match_entry por división.
    const entriesForLucas = fake.tables.match_entries.rows.filter(
      (e) => e.shooter_id === lucas[0]!.id,
    );
    expect(entriesForLucas).toHaveLength(3);
  });

  it("falla con UNKNOWN_DIVISION si aparece una división no registrada", async () => {
    // Quitar la división Production
    fake.tables.divisions.rows = fake.tables.divisions.rows.filter(
      (d) => d.code !== "P",
    );
    const parsed = parsePractiscoreHtml(read("tp-escopeta-2026-02-20-match.html"));

    await expect(
      importParsedMatch(fake.asClient(), parsed, USER_ID, "f.html"),
    ).rejects.toBeInstanceOf(ImportError);
  });
});

describe("importParsedMatch — Stage results", () => {
  let fake: FakeSupabase;
  beforeEach(async () => {
    fake = buildSupabase();
    // Importar primero el match overall, así existe en la "DB"
    const matchHtml = parsePractiscoreHtml(read("tp-escopeta-2026-02-20-match.html"));
    await importParsedMatch(fake.asClient(), matchHtml, USER_ID, "match.html");
  });

  it("agrega un stage al match existente y crea stage_results", async () => {
    const parsed = parsePractiscoreHtml(read("tp-escopeta-2026-02-20-stage1.html"));
    const result = await importParsedMatch(
      fake.asClient(),
      parsed,
      USER_ID,
      "stage1.html",
    );

    expect(result.existedAlready).toBe(true);
    expect(result.insertedStages).toBe(1);
    expect(result.insertedStageResults).toBeGreaterThan(0);

    const [stage] = fake.tables.stages.rows;
    expect(stage.stage_number).toBe(1);

    const stageResults = fake.tables.stage_results.rows;
    expect(stageResults.length).toBeGreaterThan(0);
    // Cada stage_result referencia un match_entry existente
    const validEntryIds = new Set(
      fake.tables.match_entries.rows.map((e) => e.id),
    );
    for (const r of stageResults) {
      expect(validEntryIds.has(r.match_entry_id as string)).toBe(true);
    }
  });

  it("falla con MATCH_NOT_FOUND si no existe el match para el stage", async () => {
    const fakeFresh = buildSupabase(); // sin match overall
    const parsed = parsePractiscoreHtml(read("tp-escopeta-2026-02-20-stage1.html"));

    await expect(
      importParsedMatch(fakeFresh.asClient(), parsed, USER_ID, "s.html"),
    ).rejects.toMatchObject({
      code: "MATCH_NOT_FOUND",
    });
  });

  it("falla con NOT_MATCH_OWNER si otro user importó el match", async () => {
    const parsed = parsePractiscoreHtml(read("tp-escopeta-2026-02-20-stage1.html"));

    await expect(
      importParsedMatch(fake.asClient(), parsed, OTHER_USER, "s.html"),
    ).rejects.toMatchObject({
      code: "NOT_MATCH_OWNER",
    });
  });

  it("re-importar el mismo stage no duplica resultados (upsert)", async () => {
    const parsed = parsePractiscoreHtml(read("tp-escopeta-2026-02-20-stage1.html"));
    await importParsedMatch(fake.asClient(), parsed, USER_ID, "s.html");
    const firstCount = fake.tables.stage_results.rows.length;

    await importParsedMatch(fake.asClient(), parsed, USER_ID, "s.html");
    const secondCount = fake.tables.stage_results.rows.length;

    expect(secondCount).toBe(firstCount);
  });
});
