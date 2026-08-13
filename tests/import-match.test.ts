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
    { id: 17, discipline_id: 1, code: "PIS", name: "Pistola" },
  ]);
  return fake;
}

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
    expect(diegoEntry!.division_id).toBe(17); // Pistola (sección "Pistola" del fixture)
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

  it("bloquea cross-user cuando otro usuario importó el mismo torneo con region 'compatible' (una nula)", async () => {
    // Bug raíz reproducido (caso real del 3° Ranking Social 2026-05-30):
    // un usuario importó el match desde un PDF WinMSS que no tiene
    // columna region → region quedó null. Otro usuario subió después
    // el mismo torneo desde un HTML PractiScore que sí tiene region
    // → region "ARG-TFALP". La unique constraint (discipline, name,
    // date, region) con NULLS NOT DISTINCT no agarró la colisión y
    // ambos imports entraron como matches distintos.
    //
    // Nueva guarda a nivel app: si encontramos otro match del mismo
    // (discipline, name, date) y las regions son compatibles (una
    // nula, ambas nulas o iguales), rechazamos con error accionable.
    fake.seed("matches", [
      {
        id: "match-otro",
        discipline_id: 1,
        name: "TP ESCOPETA 20/02/26 TFALP",
        date: "2026-02-20",
        region: null, // otro usuario importó con region null (caso WinMSS PDF)
        imported_by_user_id: OTHER_USER,
        imported_at: "2026-02-21T10:00:00Z",
        source_type: "winmss_pdf",
        min_shots: null,
      },
    ]);

    const parsed = parsePractiscoreHtml(
      read("tp-escopeta-2026-02-20-match.html"),
    );
    // El parser extrae region del HTML — sanity check para que el caso
    // tenga sentido (region en archivo != region en DB).
    expect(parsed.region).toBeTruthy();

    await expect(
      importParsedMatch(fake.asClient(), parsed, USER_ID, "html.html"),
    ).rejects.toMatchObject({
      code: "MATCH_ALREADY_EXISTS_BY_OTHER",
    });

    // El match original sigue siendo el único — no entró duplicado.
    expect(fake.tables.matches.rows).toHaveLength(1);
  });

  it("permite cross-user cuando ambos imports tienen regions NO nulas distintas (dos torneos legítimamente distintos)", async () => {
    // Caso raro pero legítimo: dos clubes corriendo un torneo con el
    // mismo nombre + misma fecha, pero en clubes distintos. La guarda
    // NO debe disparar acá — son dos matches reales y separados.
    fake.seed("matches", [
      {
        id: "match-otra-region",
        discipline_id: 1,
        name: "TP ESCOPETA 20/02/26 TFALP",
        date: "2026-02-20",
        region: "ARG-OTRACLUB", // otra region concreta
        imported_by_user_id: OTHER_USER,
        imported_at: "2026-02-21T10:00:00Z",
        source_type: "practiscore_match_html",
        min_shots: null,
      },
    ]);

    const parsed = parsePractiscoreHtml(
      read("tp-escopeta-2026-02-20-match.html"),
    );
    expect(parsed.region).toBe("ARG-TFALP");

    const result = await importParsedMatch(
      fake.asClient(),
      parsed,
      USER_ID,
      "html.html",
    );

    // No bloqueó: insertó un segundo match.
    expect(result.existedAlready).toBe(false);
    expect(fake.tables.matches.rows).toHaveLength(2);
  });

  it("la guarda cross-user no afecta re-uploads del mismo usuario", async () => {
    // El path existente de re-upload (mismo usuario) se chequea ANTES
    // que la guarda cross-user, así que sigue funcionando idéntico.
    const parsed = parsePractiscoreHtml(
      read("tp-escopeta-2026-02-20-match.html"),
    );
    await importParsedMatch(fake.asClient(), parsed, USER_ID, "f.html");

    const result = await importParsedMatch(
      fake.asClient(),
      parsed,
      USER_ID,
      "f.html",
    );
    expect(result.existedAlready).toBe(true);
    expect(fake.tables.matches.rows).toHaveLength(1);
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
          isAbsent: false,
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
          isAbsent: false,
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
          isAbsent: false,
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
    // Quitar la división Pistola (el fixture tiene una sección "Pistola"
    // que el parser mapea a PIS).
    fake.tables.divisions.rows = fake.tables.divisions.rows.filter(
      (d) => d.code !== "PIS",
    );
    const parsed = parsePractiscoreHtml(read("tp-escopeta-2026-02-20-match.html"));

    await expect(
      importParsedMatch(fake.asClient(), parsed, USER_ID, "f.html"),
    ).rejects.toBeInstanceOf(ImportError);
  });
});

describe("importParsedMatch — Dedup de shooters por member_number", () => {
  // Cuando dos imports traen al mismo tirador con el mismo número de socio
  // pero el apellido tipeado distinto ("STOCKER, Oscar Alfredo" en uno,
  // "Stoker Oscar" en otro), el match por member_number los unifica en un
  // solo shooter — sin esto, cada variante de tipeo crea fila nueva y
  // fragmenta la historia del tirador.
  let fake: FakeSupabase;
  beforeEach(() => {
    fake = buildSupabase();
    // Shooter ya existente en la DB: full_name "Apellido Original" con
    // número de socio 793. Simula una importación anterior.
    fake.seed("shooters", [
      {
        id: "existing-shooter",
        full_name: "Apellido Original",
        member_number: "793",
        linked_user_id: null,
        created_at: "2026-01-01",
      },
    ]);
  });

  it("reusa el shooter existente cuando el member_number coincide, aunque el nombre venga distinto", async () => {
    const parsed = {
      discipline: "ipsc" as const,
      source: "practiscore_match_html" as const,
      name: "Match Test",
      date: "2026-05-01",
      region: null,
      generatedBy: null,
      matchEntries: [
        {
          shooter: {
            fullName: "Tipo Distinto, Oscar", // nombre completamente distinto
            memberNumber: "793", // pero MISMO número
            region: null,
          },
          divisionCode: "P",
          classification: null,
          powerFactor: "Maj" as const,
          category: null,
          place: 1,
          matchPoints: 100,
          matchPercentage: 100,
          totalTimeSeconds: null,
          hits: null,
          isDq: false,
          isAbsent: false,
        },
      ],
      stages: [],
    };

    await importParsedMatch(fake.asClient(), parsed, USER_ID, "f.html");

    // No se creó un shooter nuevo: el match_entry apunta al existente.
    const shooters = fake.tables.shooters.rows;
    expect(shooters).toHaveLength(1);
    expect(shooters[0]!.id).toBe("existing-shooter");

    const entries = fake.tables.match_entries.rows;
    expect(entries).toHaveLength(1);
    expect(entries[0]!.shooter_id).toBe("existing-shooter");
  });

  it("crea un shooter nuevo cuando el member_number no existe todavía", async () => {
    const parsed = {
      discipline: "ipsc" as const,
      source: "practiscore_match_html" as const,
      name: "Match Test",
      date: "2026-05-01",
      region: null,
      generatedBy: null,
      matchEntries: [
        {
          shooter: {
            fullName: "Nuevo Tirador",
            memberNumber: "999", // número que no existe en la DB
            region: null,
          },
          divisionCode: "P",
          classification: null,
          powerFactor: "Maj" as const,
          category: null,
          place: 1,
          matchPoints: 100,
          matchPercentage: 100,
          totalTimeSeconds: null,
          hits: null,
          isDq: false,
          isAbsent: false,
        },
      ],
      stages: [],
    };

    await importParsedMatch(fake.asClient(), parsed, USER_ID, "f.html");

    // Se creó el nuevo (existing + nuevo).
    expect(fake.tables.shooters.rows).toHaveLength(2);
    const created = fake.tables.shooters.rows.find(
      (s) => s.member_number === "999",
    );
    expect(created).toBeDefined();
    expect(created!.full_name).toBe("Nuevo Tirador");
  });

  it("sin member_number, sigue el path por nombre (no merge inseguro por homónimo)", async () => {
    const parsed = {
      discipline: "ipsc" as const,
      source: "practiscore_match_html" as const,
      name: "Match Test",
      date: "2026-05-01",
      region: null,
      generatedBy: null,
      matchEntries: [
        {
          shooter: {
            fullName: "Apellido Original", // mismo nombre que el existing
            memberNumber: null, // sin número
            region: null,
          },
          divisionCode: "P",
          classification: null,
          powerFactor: "Maj" as const,
          category: null,
          place: 1,
          matchPoints: 100,
          matchPercentage: 100,
          totalTimeSeconds: null,
          hits: null,
          isDq: false,
          isAbsent: false,
        },
      ],
      stages: [],
    };

    await importParsedMatch(fake.asClient(), parsed, USER_ID, "f.html");

    // Sin número en el parsed no podemos saber si el "Apellido Original"
    // de la DB (que tiene número 793) es la misma persona — preferimos
    // crear uno nuevo (sin número) antes que mergear dos identidades por
    // homónimo. El path por nombre dedupea solo si AMBOS coinciden en
    // (name + memberNumber).
    expect(fake.tables.shooters.rows).toHaveLength(2);
  });
});

describe("importParsedMatch — Entry duplicada en la misma división", () => {
  // Caso real (Ranking Social Junio 2026): el oficial cargó al mismo tirador
  // (socio 793) DOS veces en Production con el nombre tipeado distinto. Ambas
  // filas resuelven al mismo shooter_id (el match por nº de socio gana), así
  // que el batch de upsert tenía dos filas con la misma conflict key
  // (match_id, shooter_id, division_id) → Postgres: "ON CONFLICT DO UPDATE
  // command cannot affect row a second time". El importer ahora deduplica.
  let fake: FakeSupabase;
  beforeEach(() => {
    fake = buildSupabase();
    fake.seed("shooters", [
      {
        id: "existing-shooter",
        full_name: "TIMBERI, Jesus",
        member_number: "793",
        linked_user_id: null,
        created_at: "2026-01-01",
      },
    ]);
  });

  const entry = (name: string, place: number, pct: number) => ({
    shooter: { fullName: name, memberNumber: "793", region: null },
    divisionCode: "P",
    classification: null,
    powerFactor: "Min" as const,
    category: null,
    place,
    matchPoints: pct,
    matchPercentage: pct,
    totalTimeSeconds: null,
    hits: null,
    isDq: false,
    isAbsent: false,
  });

  it("colapsa a una sola entry por (shooter, división) y conserva el mejor resultado", async () => {
    const parsed = {
      discipline: "ipsc" as const,
      source: "practiscore_match_html" as const,
      name: "Ranking Social Junio 2026",
      date: "2026-06-27",
      region: null,
      generatedBy: null,
      // misma persona (socio 793) cargada dos veces en Production.
      matchEntries: [
        entry("TIMBERI, Jesus OP", 11, 53.9539),
        entry("TIMBERI, Jesus", 12, 52.7667),
      ],
      stages: [],
    };

    await importParsedMatch(fake.asClient(), parsed, USER_ID, "f.html");

    const entries = fake.tables.match_entries.rows;
    expect(entries).toHaveLength(1);
    expect(entries[0]!.shooter_id).toBe("existing-shooter");
    // Gana la de mayor match_% (53.95, place 11), no la última vista.
    expect(entries[0]!.match_percentage).toBeCloseTo(53.9539);
    expect(entries[0]!.place).toBe(11);
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

  /**
   * Sin ningún match de ese día el usuario no tiene nada que elegir, así
   * que el código es el que dice "importá primero el overall" y no el que
   * lista candidatos (#203). Antes era un solo código con el párrafo
   * condicional embebido en la prosa.
   */
  it("falla con MATCH_NOT_FOUND_NONE_THAT_DAY si no hay matches ese día", async () => {
    const fakeFresh = buildSupabase(); // sin match overall
    const parsed = parsePractiscoreHtml(read("tp-escopeta-2026-02-20-stage1.html"));

    await expect(
      importParsedMatch(fakeFresh.asClient(), parsed, USER_ID, "s.html"),
    ).rejects.toMatchObject({
      code: "MATCH_NOT_FOUND_NONE_THAT_DAY",
      params: { date: "2026-02-20" },
    });
  });

  // Con candidatos el mensaje los enumera, así que el code cambia y los
  // nombres viajan en `params` en vez de estar pegados en la prosa.
  it("falla con MATCH_NOT_FOUND y lista los candidatos del día", async () => {
    const fakeFresh = buildSupabase();
    // Mismo día y disciplina, pero con un nombre que no matchea el título
    // del stage — si matcheara, resolveMatchForStage lo encontraría.
    fakeFresh.seed("matches", [
      {
        id: "otro-1",
        discipline_id: 1,
        name: "Torneo Ajeno",
        date: "2026-02-20",
        imported_by_user_id: OTHER_USER,
      },
    ]);
    const parsed = parsePractiscoreHtml(read("tp-escopeta-2026-02-20-stage1.html"));

    await expect(
      importParsedMatch(fakeFresh.asClient(), parsed, USER_ID, "s.html"),
    ).rejects.toMatchObject({
      code: "MATCH_NOT_FOUND",
      params: { date: "2026-02-20", candidates: '"Torneo Ajeno"' },
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
          isAbsent: false,
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

  it("aplica min_shots del form en stage import si el match todavía no lo tiene (y no pisa un valor existente)", async () => {
    // Bug: el usuario sube el overall sin completar min_shots, después
    // sube un stage y completa min_shots=116 en el form, pero el valor
    // se ignora silenciosamente (`importStages` ni siquiera recibía
    // options). El usuario tiene que corregirlo a mano en /matches/[id].
    //
    // Fix: aplicamos el min_shots del form en stage imports también, pero
    // solo si el match aún no tiene uno seteado (preserva ediciones
    // manuales desde la página del match).
    const matchFixture = parsePractiscoreHtml(
      read("tp-escopeta-2026-02-20-match.html"),
    );
    const stageFixture = parsePractiscoreHtml(
      read("tp-escopeta-2026-02-20-stage1.html"),
    );

    const fakeFresh = buildSupabase();

    // 1. Overall sin min_shots.
    await importParsedMatch(fakeFresh.asClient(), matchFixture, USER_ID, "m.html");
    const created = fakeFresh.tables.matches.rows[0]!;
    expect(created.min_shots).toBeNull();

    // 2. Stage con min_shots=116 → el match se actualiza.
    await importParsedMatch(
      fakeFresh.asClient(),
      stageFixture,
      USER_ID,
      "s1.html",
      { minShots: 116 },
    );
    expect(fakeFresh.tables.matches.rows[0]!.min_shots).toBe(116);

    // 3. Otro stage con min_shots=200 → el match queda en 116 (no se pisa).
    await importParsedMatch(
      fakeFresh.asClient(),
      stageFixture,
      USER_ID,
      "s1-reupload.html",
      { minShots: 200 },
    );
    expect(fakeFresh.tables.matches.rows[0]!.min_shots).toBe(116);
  });

  it("stage import con mismo nombre en dos divisiones no duplica match_entry_id en el batch (bug PCC suffix)", async () => {
    // Bug raíz reproducido (caso real del 3° Ranking Social 2026-05-30):
    // Martin Celiz compite en PCC Optics como "CELIZ, Martin PCC" (sin nº
    // de socio) y en Production como "CELIZ, Martin" (con nº 2430). El
    // parser strip-ea el sufijo "PCC" así que ambas variantes llegan al
    // importer con el mismo `fullName`. El overall crea 2 match_entries
    // (cache keys distintas por el nº). Pero los archivos de stages de
    // PractiScore NO traen nº de socio, así que ambas filas comparten
    // `cacheKey` y `resolveShootersBulk` las colapsa a UN mismo shooterId.
    // El fallback "1 entry única" mandaba ambas al mismo match_entry_id
    // → `ON CONFLICT DO UPDATE command cannot affect row a second time`.
    //
    // Después del fix: el lookup pasa por (nombre normalizado, división)
    // sin shooterId como intermediario, así que cada parsed stage result
    // va al match_entry correcto.
    const fakeFresh = buildSupabase();

    const overall = {
      discipline: "ipsc" as const,
      source: "practiscore_match_html" as const,
      name: "Test Two Divs",
      date: "2026-05-30",
      region: null,
      stages: [],
      generatedBy: null,
      matchEntries: [
        // PCC Optics: sin nº (en el archivo real era "CELIZ, Martin PCC",
        // el parser ya strip-eó "PCC" antes de llegar acá).
        {
          shooter: { fullName: "CELIZ, Martin", memberNumber: null, region: null },
          divisionCode: "PCCO",
          classification: "U",
          powerFactor: "Min" as const,
          category: null,
          place: 1, matchPoints: 500, matchPercentage: 100,
          totalTimeSeconds: null, hits: null, isDq: false, isAbsent: false,
        },
        // Production: mismo tirador, con nº de socio
        {
          shooter: { fullName: "CELIZ, Martin", memberNumber: "2430", region: null },
          divisionCode: "P",
          classification: "U",
          powerFactor: "Min" as const,
          category: null,
          place: 1, matchPoints: 450, matchPercentage: 95,
          totalTimeSeconds: null, hits: null, isDq: false, isAbsent: false,
        },
      ],
    };
    await importParsedMatch(fakeFresh.asClient(), overall, USER_ID, "overall.html");
    expect(fakeFresh.tables.match_entries.rows).toHaveLength(2);

    // Stage: ambas filas SIN nº (como un stage real de PractiScore)
    const stageImport = {
      discipline: "ipsc" as const,
      source: "practiscore_stage_html" as const,
      name: "Test Two Divs - Stage 6",
      date: "2026-05-30",
      region: null,
      matchEntries: [],
      generatedBy: null,
      stages: [
        {
          stageNumber: 6,
          name: "Test Two Divs - Stage 6",
          results: [
            {
              shooter: { fullName: "CELIZ, Martin", memberNumber: null, region: null },
              divisionCode: "PCCO",
              classification: "U",
              powerFactor: "Min" as const,
              points: 58, penalties: 0, timeSeconds: 10.77, hitFactor: 5.39,
              stagePoints: 60, stagePercentage: 100, place: 1, hits: null,
              isDq: false,
            },
            {
              shooter: { fullName: "CELIZ, Martin", memberNumber: null, region: null },
              divisionCode: "P",
              classification: "U",
              powerFactor: "Min" as const,
              points: 56, penalties: 0, timeSeconds: 12.49, hitFactor: 4.48,
              stagePoints: 57.88, stagePercentage: 96.47, place: 2, hits: null,
              isDq: false,
            },
          ],
        },
      ],
    };

    const result = await importParsedMatch(
      fakeFresh.asClient(),
      stageImport,
      USER_ID,
      "stage.html",
    );

    // Dos stage_results, uno por cada match_entry de la división correcta.
    expect(result.insertedStageResults).toBe(2);
    expect(fakeFresh.tables.stage_results.rows).toHaveLength(2);

    const entryIds = new Set(
      fakeFresh.tables.stage_results.rows.map((r) => r.match_entry_id),
    );
    expect(entryIds.size).toBe(2);

    const pccoEntry = fakeFresh.tables.match_entries.rows.find(
      (e) => e.division_id === 14,
    );
    const pEntry = fakeFresh.tables.match_entries.rows.find(
      (e) => e.division_id === 11,
    );
    expect(pccoEntry).toBeDefined();
    expect(pEntry).toBeDefined();
    expect(entryIds.has(pccoEntry!.id)).toBe(true);
    expect(entryIds.has(pEntry!.id)).toBe(true);
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
    // Después de la guarda cross-user pre-INSERT, el código devuelto es
    // MATCH_ALREADY_EXISTS_BY_OTHER (más específico). El antiguo
    // MATCH_ALREADY_EXISTS sigue existiendo como fallback si una race
    // entre dos imports simultáneos llega hasta el INSERT.
    await expect(
      importParsedMatch(fake.asClient(), parsed, USER_ID, "s.csv"),
    ).rejects.toMatchObject({
      code: "MATCH_ALREADY_EXISTS_BY_OTHER",
    });
  });
});

describe("importParsedMatch — un import fallido no deja el match huérfano (#205)", () => {
  let fake: FakeSupabase;
  beforeEach(() => {
    fake = buildSupabase();
  });

  /**
   * PostgREST no da transacciones: el INSERT del match y el upsert de las
   * entries son commits separados. Si el segundo falla, la fila de `matches`
   * queda sola — un torneo vacío en la lista del usuario.
   *
   * Se simula fallando el upsert de `match_entries`, que es el primer paso
   * después del insert.
   */
  it("borra el match recién insertado si fallan las entries", async () => {
    const parsed = parsePractiscoreHtml(read("tp-escopeta-2026-02-20-match.html"));
    fake.table("match_entries").upsertError = {
      code: "57014",
      message: "statement timeout",
    };

    await expect(
      importParsedMatch(fake.asClient(), parsed, USER_ID, "test.html"),
    ).rejects.toThrow();

    expect(fake.tables.matches.rows).toHaveLength(0);
  });

  /**
   * La compensación no puede tapar el error original: ése es el que le
   * explica al usuario qué salió mal. Si `rollbackInsertedMatch` dejara
   * escapar lo suyo, el mensaje que llega sería sobre el borrado y no sobre
   * la causa.
   */
  it("propaga el error original, no uno del borrado", async () => {
    const parsed = parsePractiscoreHtml(read("tp-escopeta-2026-02-20-match.html"));
    fake.table("match_entries").upsertError = {
      code: "57014",
      message: "statement timeout",
    };

    // El motivo crudo de Postgres ya no viaja en `message` —eso iba a la
    // UI, que era el bug de #203— pero tiene que seguir existiendo en
    // `detail` para el log del server. Perderlo al dejar de mostrarlo
    // sería cambiar un bug por otro.
    await expect(
      importParsedMatch(fake.asClient(), parsed, USER_ID, "test.html"),
    ).rejects.toMatchObject({
      code: "MATCH_ENTRIES_INSERT_FAILED",
      detail: expect.stringContaining("statement timeout"),
    });
  });

  /**
   * Los shooters creados durante el intento fallido sobreviven a propósito:
   * son entidades compartidas entre torneos, no hijas de este match, y una
   * fila de tirador sin participaciones no le hace daño a nadie. El
   * reintento la reusa en vez de duplicarla.
   */
  it("conserva los shooters creados en el intento", async () => {
    const parsed = parsePractiscoreHtml(read("tp-escopeta-2026-02-20-match.html"));
    fake.table("match_entries").upsertError = {
      code: "57014",
      message: "statement timeout",
    };

    await expect(
      importParsedMatch(fake.asClient(), parsed, USER_ID, "test.html"),
    ).rejects.toThrow();

    expect(fake.tables.shooters.rows.length).toBeGreaterThan(0);
  });

  /**
   * Y el reintento tiene que quedar limpio: sin el match huérfano, vuelve a
   * tomar la rama fresca en vez de la de merge.
   */
  it("el reintento importa normalmente después de la compensación", async () => {
    const parsed = parsePractiscoreHtml(read("tp-escopeta-2026-02-20-match.html"));
    fake.table("match_entries").upsertError = {
      code: "57014",
      message: "statement timeout",
    };
    await expect(
      importParsedMatch(fake.asClient(), parsed, USER_ID, "test.html"),
    ).rejects.toThrow();

    delete fake.table("match_entries").upsertError;
    const retry = await importParsedMatch(
      fake.asClient(),
      parsed,
      USER_ID,
      "test.html",
    );

    expect(retry.existedAlready).toBe(false);
    expect(retry.insertedEntries).toBe(parsed.matchEntries.length);
    expect(fake.tables.matches.rows).toHaveLength(1);
  });

  /**
   * Si la compensación no llegó a correr —el proceso murió entre el insert
   * y el catch— el huérfano queda. El reintento igual lo cura, porque el
   * merge puebla lo mismo que la rama fresca; lo que no puede es anunciarse
   * como "ya existía", porque nunca hubo un import previo con resultados.
   */
  it("un merge contra un huérfano no se reporta como re-upload", async () => {
    const parsed = parsePractiscoreHtml(read("tp-escopeta-2026-02-20-match.html"));
    // Huérfano dejado por un import anterior: match sin entries.
    fake.seed("matches", [
      {
        id: "orphan-1",
        discipline_id: 1,
        name: parsed.name,
        date: parsed.date,
        region: parsed.region,
        imported_by_user_id: USER_ID,
        min_shots: null,
        imported_at: "2026-02-20T10:00:00Z",
      },
    ]);

    const result = await importParsedMatch(
      fake.asClient(),
      parsed,
      USER_ID,
      "test.html",
    );

    expect(result.matchId).toBe("orphan-1");
    expect(result.existedAlready).toBe(false);
    expect(result.insertedEntries).toBe(parsed.matchEntries.length);
    // No se creó un segundo match: se completó el que estaba.
    expect(fake.tables.matches.rows).toHaveLength(1);
  });
});

describe("importParsedMatch — lista de candidatos acotada (#203)", () => {
  /**
   * La lista viaja a la UI dentro de un query param. Sin tope, un día con
   * muchos torneos producía una URL enorme y un mensaje ilegible.
   *
   * Y el "…" no es cosmético: cinco nombres sin marca se leen como *todos*
   * los del día, así que alguien que no ve el suyo concluye que no está
   * importado y lo vuelve a subir. Una lista truncada presentada como
   * completa manda a la persona a hacer algo innecesario.
   */
  it("corta en 5 y marca que hay más", async () => {
    const fake = buildSupabase();
    fake.seed(
      "matches",
      Array.from({ length: 8 }, (_, i) => ({
        id: `m-${i}`,
        discipline_id: 1,
        name: `Torneo Ajeno ${i}`,
        date: "2026-02-20",
        imported_by_user_id: OTHER_USER,
      })),
    );
    const parsed = parsePractiscoreHtml(read("tp-escopeta-2026-02-20-stage1.html"));

    await expect(
      importParsedMatch(fake.asClient(), parsed, USER_ID, "s.html"),
    ).rejects.toMatchObject({
      code: "MATCH_NOT_FOUND",
      params: {
        candidates: expect.stringContaining("…"),
      },
    });
  });

  it("no marca de más cuando entran todos", async () => {
    const fake = buildSupabase();
    fake.seed("matches", [
      {
        id: "m-solo",
        discipline_id: 1,
        name: "Torneo Ajeno",
        date: "2026-02-20",
        imported_by_user_id: OTHER_USER,
      },
    ]);
    const parsed = parsePractiscoreHtml(read("tp-escopeta-2026-02-20-stage1.html"));

    await expect(
      importParsedMatch(fake.asClient(), parsed, USER_ID, "s.html"),
    ).rejects.toMatchObject({
      code: "MATCH_NOT_FOUND",
      params: { candidates: '"Torneo Ajeno"' },
    });
  });
});

describe("importParsedMatch — min_shots depends on the discipline", () => {
  /**
   * FBI is the one discipline whose round count is fixed by its own rules, so
   * the import overrides the form instead of trusting it. Nothing covered
   * that: the rule lived as a bare `discipline.code === "tiro_fbi" ? 45 : ...`
   * and every test went through IPSC, which takes the other branch.
   *
   * The literal 45 is asserted on purpose rather than `FBI_MIN_SHOTS`.
   * Comparing the code against the constant it already uses would pass no
   * matter what the constant said; 45 is the actual rule of the discipline,
   * and changing it should have to be deliberate.
   */
  const FBI_FIXTURES = join(__dirname, "fixtures", "fbi");
  const SOCIAL4 = readFileSync(join(FBI_FIXTURES, "social4.csv"), "utf8");

  it("ignores the form value on FBI and uses 45", async () => {
    const fake = buildFbiSupabase();
    const parsed = parseFbiCsv(SOCIAL4);

    await importParsedMatch(fake.asClient(), parsed, USER_ID, "social4.csv", {
      minShots: 999,
    });

    expect(fake.tables.matches.rows[0]!.min_shots).toBe(45);
  });

  it("uses 45 on FBI when the form sent nothing", async () => {
    const fake = buildFbiSupabase();
    const parsed = parseFbiCsv(SOCIAL4);

    await importParsedMatch(fake.asClient(), parsed, USER_ID, "social4.csv");

    expect(fake.tables.matches.rows[0]!.min_shots).toBe(45);
  });

  /**
   * The half of #263 that is reachable from here. Until it was fixed, an FBI
   * match whose `min_shots` had been cleared through the "edit minimum"
   * button never recovered: the next import saw a null and wrote whatever the
   * form carried, because that path never asked what discipline it was in.
   */
  it("restores the discipline's round count on a match whose min_shots was cleared", async () => {
    const fake = buildFbiSupabase();
    const parsed = parseFbiCsv(SOCIAL4);

    await importParsedMatch(fake.asClient(), parsed, USER_ID, "social4.csv");
    // Somebody blanked it from the match page.
    fake.tables.matches.rows[0]!.min_shots = null;

    await importParsedMatch(fake.asClient(), parsed, USER_ID, "social4.csv", {
      minShots: 999,
    });

    expect(fake.tables.matches.rows[0]!.min_shots).toBe(45);
  });

  /**
   * The self-heal writes whenever the stored figure disagrees, which means it
   * must not write when it agrees — and that difference is invisible in the
   * resulting row. Without counting the writes, deleting the early return
   * (making every re-import of a correct FBI match issue a redundant UPDATE)
   * passes every other test in this file unchanged.
   */
  it("does not write again when the stored value already agrees", async () => {
    const fake = buildFbiSupabase();
    const parsed = parseFbiCsv(SOCIAL4);

    await importParsedMatch(fake.asClient(), parsed, USER_ID, "social4.csv");
    expect(fake.tables.matches.rows[0]!.min_shots).toBe(45);

    const writesBefore = fake.writesTo("matches").length;
    await importParsedMatch(fake.asClient(), parsed, USER_ID, "social4.csv", {
      minShots: 999,
    });

    expect(fake.writesTo("matches")).toHaveLength(writesBefore);
    expect(fake.tables.matches.rows[0]!.min_shots).toBe(45);
  });

  it("overwrites a stored value that disagrees with the discipline", async () => {
    const fake = buildFbiSupabase();
    const parsed = parseFbiCsv(SOCIAL4);

    await importParsedMatch(fake.asClient(), parsed, USER_ID, "social4.csv");
    fake.tables.matches.rows[0]!.min_shots = 30;

    await importParsedMatch(fake.asClient(), parsed, USER_ID, "social4.csv");

    expect(fake.tables.matches.rows[0]!.min_shots).toBe(45);
  });

  /**
   * The other side of the same branch: a non-fixed discipline must keep the
   * "do not overwrite what the user set" behaviour. Repairing FBI by writing
   * whenever the stored value disagrees would, applied to everyone, undo
   * every manual correction on the match page.
   */
  it("still does not overwrite an existing value on other disciplines", async () => {
    const fake = buildSupabase();
    const parsed = parsePractiscoreHtml(
      read("tp-escopeta-2026-02-20-match.html"),
    );

    await importParsedMatch(fake.asClient(), parsed, USER_ID, "m.html", {
      minShots: 116,
    });
    await importParsedMatch(fake.asClient(), parsed, USER_ID, "m.html", {
      minShots: 200,
    });

    expect(fake.tables.matches.rows[0]!.min_shots).toBe(116);
  });

  it("takes the form value on every other discipline", async () => {
    const fake = buildSupabase();
    const parsed = parsePractiscoreHtml(
      read("tp-escopeta-2026-02-20-match.html"),
    );

    await importParsedMatch(fake.asClient(), parsed, USER_ID, "m.html", {
      minShots: 116,
    });

    expect(fake.tables.matches.rows[0]!.min_shots).toBe(116);
  });
});
