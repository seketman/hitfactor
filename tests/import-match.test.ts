import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakeSupabase } from "./helpers/supabase-mock";
import { parsePractiscoreHtml } from "@/lib/parsers/practiscore";
import { parseFbiCsv } from "@/lib/parsers/fbi-csv";
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
          hits: null,
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
          hits: null,
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
          hits: null,
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

  it("trata el PDF de stages WinMSS como stage import aunque traiga DQs", async () => {
    // Reproduce el bug del usuario: el PDF de stages de WinMSS incluye al
    // final una página "Disqualified Shooters" con DQ entries. Antes esto
    // hacía que `parsed.matchEntries.length > 0` ruteara el archivo como
    // un overall import — creando un match nuevo con solo el DQ + stages,
    // duplicando el match real (o creando uno espurio si el overall no se
    // había importado todavía).
    const parsed = {
      discipline: "ipsc" as const,
      source: "winmss_pdf" as const,
      name: "TP ESCOPETA 20/02/26 TFALP", // mismo nombre que el match overall del beforeEach
      date: "2026-02-20",
      region: null,
      generatedBy: "WinMSS",
      // Solo una entry DQ (la página "Disqualified Shooters" del PDF de stages).
      matchEntries: [
        {
          shooter: {
            fullName: "MOLLEA, Marcelo Daniel",
            memberNumber: null,
            region: null,
          },
          divisionCode: "P",
          classification: null,
          powerFactor: null,
          category: null,
          place: 0,
          matchPoints: 0,
          matchPercentage: 0,
          totalTimeSeconds: null,
          hits: null,
          isDq: true,
        },
      ],
      stages: [
        {
          stageNumber: 1,
          name: "Stage 1",
          results: [],
        },
      ],
    };

    const result = await importParsedMatch(
      fake.asClient(),
      parsed,
      USER_ID,
      "stages.pdf",
    );

    // Debería ser un stage import: existedAlready=true (mergeó con el
    // match overall del beforeEach), no creó un match nuevo.
    expect(result.existedAlready).toBe(true);
    expect(fake.tables.matches.rows).toHaveLength(1);

    // La DQ se upserteó contra el match existente.
    const mollea = fake.tables.match_entries.rows.find(
      (e) => e.is_dq === true,
    );
    expect(mollea).toBeDefined();
  });
});

describe("importParsedMatch — Re-upload de FBI CSV agrega stages al match existente", () => {
  // Caso de uso: el usuario ya importó un CSV de FBI antes del fix que parsea
  // stages, y ahora vuelve a subir el mismo archivo. El INSERT del match
  // pega contra la unique constraint y, si trae stages, los agregamos al
  // match existente sin tocar las entries originales.
  const FBI_FIXTURES = join(__dirname, "fixtures", "fbi");
  const SOCIAL3 = readFileSync(
    join(FBI_FIXTURES, "social3-with-stages.csv"),
    "utf8",
  );

  function buildFbiSupabase(): FakeSupabase {
    const fake = new FakeSupabase();
    fake.seed("disciplines", [
      { id: 5, code: "tiro_fbi", name: "Tiro FBI", scoring_type: "points" },
    ]);
    fake.seed("divisions", [
      { id: 50, discipline_id: 5, code: "PIS", name: "Pistola" },
      { id: 51, discipline_id: 5, code: "REV", name: "Revólver" },
      { id: 52, discipline_id: 5, code: "MINI", name: "Minirifle" },
      { id: 53, discipline_id: 5, code: "PCC", name: "PCC" },
    ]);
    return fake;
  }

  it("agrega stages a un match existente cuando el INSERT de matches falla con 23505", async () => {
    const fake = buildFbiSupabase();
    const parsed = parseFbiCsv(SOCIAL3);

    // Primera carga: crea match + entries + stages. Verificamos baseline.
    const first = await importParsedMatch(
      fake.asClient(),
      parsed,
      USER_ID,
      "social3.csv",
    );
    expect(first.existedAlready).toBe(false);
    expect(first.insertedStages).toBe(parsed.stages.length);
    const matchId = first.matchId;
    const entriesBefore = fake.tables.match_entries.rows.length;
    const stagesBefore = fake.tables.stages.rows.length;

    // Simulamos que el match ya existe en DB: cualquier nuevo INSERT en
    // matches falla con la unique constraint (lo que pasaría en prod
    // porque ya está la fila).
    fake.tables.matches.insertError = {
      code: "23505",
      message: "duplicate key",
    };

    // Re-upload: debería detectar que el match es del mismo user, encontrar
    // el row existente y agregar/upsertear stages sin volver a insertar
    // entries.
    const second = await importParsedMatch(
      fake.asClient(),
      parsed,
      USER_ID,
      "social3.csv",
    );
    expect(second.existedAlready).toBe(true);
    expect(second.matchId).toBe(matchId);
    // `insertedEntries` ahora refleja "entries procesados" (upserteados) —
    // no son entries nuevos, son los que ya existían siendo actualizados.
    expect(second.insertedEntries).toBeGreaterThan(0);

    // Lo importante: la cantidad en DB no crece (upsert con onConflict).
    expect(fake.tables.match_entries.rows.length).toBe(entriesBefore);
    // No se duplican stages (ya existían).
    expect(fake.tables.stages.rows.length).toBe(stagesBefore);
  });

  it("re-upload tras editar el club mergea en el match original (no duplica)", async () => {
    // Caso real: el usuario importó el CSV con region=null (FBI no trae
    // region en el archivo), después editó el club desde la UI a "ARG-TFALP",
    // y ahora vuelve a subir el mismo CSV. La region en DB cambió pero el
    // CSV trae null — antes esto creaba un match duplicado porque la unique
    // constraint no chocaba.
    const fake = buildFbiSupabase();
    const parsed = parseFbiCsv(SOCIAL3);

    // 1. Primera carga del CSV.
    const first = await importParsedMatch(
      fake.asClient(),
      parsed,
      USER_ID,
      "social3.csv",
    );
    const matchId = first.matchId;

    // 2. Usuario edita el club desde la UI: region pasa de null a "ARG-TFALP".
    const matchRow = fake.tables.matches.rows.find((r) => r.id === matchId)!;
    matchRow.region = "ARG-TFALP";

    // 3. Re-upload del mismo CSV (parsed.region sigue siendo null).
    const second = await importParsedMatch(
      fake.asClient(),
      parsed,
      USER_ID,
      "social3.csv",
    );

    // Debería haber detectado el match existente (mismo discipline+name+date+user)
    // y mergeado en él, sin crear un duplicado.
    expect(second.existedAlready).toBe(true);
    expect(second.matchId).toBe(matchId);
    expect(fake.tables.matches.rows.length).toBe(1);
    // La region editada se conserva (no la pisamos).
    expect(matchRow.region).toBe("ARG-TFALP");
  });

  it("rechaza el re-upload si el match existente pertenece a otro usuario", async () => {
    const fake = buildFbiSupabase();
    const parsed = parseFbiCsv(SOCIAL3);

    // Primera carga la hace OTHER_USER.
    await importParsedMatch(fake.asClient(), parsed, OTHER_USER, "s.csv");
    fake.tables.matches.insertError = {
      code: "23505",
      message: "duplicate key",
    };

    // USER_ID no debería poder agregarle stages al match ajeno.
    await expect(
      importParsedMatch(fake.asClient(), parsed, USER_ID, "s.csv"),
    ).rejects.toMatchObject({
      code: "MATCH_ALREADY_EXISTS",
    });
  });
});
