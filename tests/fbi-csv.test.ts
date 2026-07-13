import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isFbiCsvFormat, parseFbiCsv } from "@/lib/parsers/fbi-csv";
import { parseFile } from "@/lib/parsers";

const FIXTURES = join(__dirname, "fixtures", "fbi");
const read = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

const SOCIAL4 = read("social4.csv");
const SOCIAL3 = read("social3-with-stages.csv");

describe("isFbiCsvFormat", () => {
  it("detecta CSV con headers FBI", () => {
    expect(isFbiCsvFormat(SOCIAL4)).toBe(true);
  });

  it("rechaza HTML aunque tenga la palabra 'Tirador'", () => {
    const html = "<html><body><table><tr><th>Tirador</th></tr></table></body></html>";
    expect(isFbiCsvFormat(html)).toBe(false);
  });

  it("rechaza CSV con headers distintos", () => {
    const csv = "Name,Score\nFoo,100\n";
    expect(isFbiCsvFormat(csv)).toBe(false);
  });
});

describe("parseFbiCsv — Social 4", () => {
  const parsed = parseFbiCsv(SOCIAL4);

  it("identifica disciplina y source", () => {
    expect(parsed.discipline).toBe("tiro_fbi");
    expect(parsed.source).toBe("fbi_csv");
  });

  it("extrae nombre y fecha del título", () => {
    expect(parsed.name).toBe("Social 4");
    expect(parsed.date).toBe("2026-05-03");
  });

  it("ignora filas sin Tirador", () => {
    // El fixture tiene varias filas vacías al final; deben descartarse.
    expect(parsed.matchEntries.length).toBeGreaterThan(0);
    expect(parsed.matchEntries.length).toBeLessThan(50);
  });

  it("mapea Disciplina del CSV a códigos de división", () => {
    const codes = new Set(parsed.matchEntries.map((e) => e.divisionCode));
    // El fixture tiene Minirifle y PCC.
    expect(codes.has("MINI")).toBe(true);
    expect(codes.has("PCC")).toBe(true);
  });

  it("mapea Classic a CLASSIC (división extendida de TFALP)", () => {
    // CSV sintético chico: 2 filas en Classic. Sin esta entrada el parser
    // saltaba la división como "desconocida" y perdía los entries.
    const csv = [
      "Social X - 14/06/26",
      "Tirador,Club,Categoría,Disciplina,Impactos,Puntos",
      "Foo Bar,TFALP,,Classic,39,170",
      "Baz Qux,TFALP,,Classic,37,150",
    ].join("\n");
    const result = parseFbiCsv(csv);
    expect(result.matchEntries).toHaveLength(2);
    expect(result.matchEntries.every((e) => e.divisionCode === "CLASSIC")).toBe(
      true,
    );
  });

  it("mapea Optic a OPTIC (división extendida de TFALP)", () => {
    // Caso real (Social 6 - 12/07/26): el club corre una división "Optic"
    // (pistola con óptica). Sin la entrada en el registry, el parser
    // descartaba esas filas EN SILENCIO y se perdían tiradores.
    const csv = [
      "Social X - 12/07/26",
      "Tirador,Club,Categoría,Disciplina,Impactos,Puntos",
      "Trezza Ulises,TFALP,A,Optic,40,198",
      "Amigo Cristian,TFALP,B,Optic,28,110",
    ].join("\n");
    const result = parseFbiCsv(csv);
    expect(result.matchEntries).toHaveLength(2);
    expect(result.matchEntries.every((e) => e.divisionCode === "OPTIC")).toBe(
      true,
    );
    // Rankea dentro de la división (hits-based: más impactos gana).
    expect(result.matchEntries[0]?.shooter.fullName).toBe("Trezza Ulises");
    expect(result.matchEntries[0]?.place).toBe(1);
    expect(result.warnings).toBeUndefined();
  });

  it("avisa (no descarta en silencio) las filas con división desconocida", () => {
    const csv = [
      "Social X - 12/07/26",
      "Tirador,Club,Categoría,Disciplina,Impactos,Puntos",
      "Foo Bar,TFALP,B,Pistola,30,120",
      "Baz Qux,TFALP,B,Bazooka,10,40",
      "Qux Quux,TFALP,B,Bazooka,12,45",
    ].join("\n");
    const result = parseFbiCsv(csv);
    // La fila válida entra; las dos desconocidas se descartan…
    expect(result.matchEntries).toHaveLength(1);
    expect(result.matchEntries[0]?.divisionCode).toBe("PIS");
    // …pero ahora quedan reportadas en `warnings` (antes se perdían mudas).
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings?.[0]).toContain("Bazooka");
    expect(result.warnings?.[0]).toContain("2");
  });

  it("preserva nombres con coma embebida (CSV con comillas)", () => {
    const names = parsed.matchEntries.map((e) => e.shooter.fullName);
    expect(names).toContain("Mariperisena, Matías");
    expect(names).toContain("Pinola, Emilio");
  });

  it("guarda Categoría tal cual viene", () => {
    const matias = parsed.matchEntries.find(
      (e) =>
        e.shooter.fullName === "Mariperisena, Matías" &&
        e.divisionCode === "MINI",
    );
    expect(matias?.category).toBe("A");

    const pinola = parsed.matchEntries.find(
      (e) =>
        e.shooter.fullName === "Pinola, Emilio" && e.divisionCode === "MINI",
    );
    expect(pinola?.category).toBe("B");
  });

  it("usa Club como region del shooter", () => {
    const matias = parsed.matchEntries.find(
      (e) => e.shooter.fullName === "Mariperisena, Matías",
    );
    expect(matias?.shooter.region).toBe("TFALP");
  });

  it("calcula place ordenando por Puntos descendente dentro de cada división", () => {
    const minirifle = parsed.matchEntries
      .filter((e) => e.divisionCode === "MINI")
      .sort((a, b) => a.place - b.place);

    // Aceto Gaston tiene 386 puntos en Minirifle, debería ser #1.
    expect(minirifle[0]?.shooter.fullName).toBe("Aceto Gaston");
    expect(minirifle[0]?.matchPoints).toBe(386);
    expect(minirifle[0]?.place).toBe(1);

    // Mariperisena con 381 va segundo.
    expect(minirifle[1]?.shooter.fullName).toBe("Mariperisena, Matías");
    expect(minirifle[1]?.matchPoints).toBe(381);
    expect(minirifle[1]?.place).toBe(2);
  });

  it("calcula matchPercentage relativo al ganador de la división", () => {
    const minirifle = parsed.matchEntries
      .filter((e) => e.divisionCode === "MINI")
      .sort((a, b) => a.place - b.place);

    expect(minirifle[0]?.matchPercentage).toBe(100);
    // Mariperisena: 381 / 386 = ~98.7%
    expect(minirifle[1]?.matchPercentage).toBeCloseTo((381 / 386) * 100, 4);
  });

  it("ignora puntaje y tiempos: matchPoints = puntos, totalTimeSeconds = null", () => {
    const aceto = parsed.matchEntries.find(
      (e) => e.shooter.fullName === "Aceto Gaston" && e.divisionCode === "MINI",
    );
    expect(aceto?.matchPoints).toBe(386);
    expect(aceto?.totalTimeSeconds).toBeNull();
    expect(aceto?.powerFactor).toBeNull();
    expect(aceto?.classification).toBeNull();
    expect(aceto?.isDq).toBe(false);
  });

  it("popula hits con la columna Impactos del CSV (criterio primario de ranking FBI)", () => {
    // Cada entry FBI debe traer hits >= 0 desde la columna Impactos.
    for (const e of parsed.matchEntries) {
      expect(e.hits).not.toBeNull();
      expect(e.hits).toBeGreaterThanOrEqual(0);
      // FBI: 40 disparos puntuables máx por match (8 stages × 5).
      expect(e.hits).toBeLessThanOrEqual(40);
    }
  });

  it("ordena el ranking por hits DESC, puntos DESC (no por puntos solo)", () => {
    // Por cada división, dentro de los no-DQ, los entries en orden de place
    // deben respetar: hits[i] >= hits[i+1], con desempate por puntos DESC.
    const byDiv = new Map<string, typeof parsed.matchEntries>();
    for (const e of parsed.matchEntries) {
      if (e.isDq) continue;
      const list = byDiv.get(e.divisionCode) ?? [];
      list.push(e);
      byDiv.set(e.divisionCode, list);
    }
    for (const [, list] of byDiv) {
      list.sort((a, b) => a.place - b.place);
      for (let i = 1; i < list.length; i++) {
        const prev = list[i - 1]!;
        const curr = list[i]!;
        const prevH = prev.hits ?? 0;
        const currH = curr.hits ?? 0;
        if (prevH === currH) {
          // Mismo hits → puntos del anterior >= puntos del actual.
          expect(prev.matchPoints).toBeGreaterThanOrEqual(curr.matchPoints);
        } else {
          // Hits distintos → hits del anterior > hits del actual.
          expect(prevH).toBeGreaterThan(currH);
        }
      }
    }
  });

  it("places por división son contiguos desde 1", () => {
    const byDivision = new Map<string, number[]>();
    for (const e of parsed.matchEntries) {
      const list = byDivision.get(e.divisionCode) ?? [];
      list.push(e.place);
      byDivision.set(e.divisionCode, list);
    }
    for (const [, places] of byDivision) {
      const sorted = [...places].sort((a, b) => a - b);
      expect(sorted[0]).toBe(1);
      // Sin gaps
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i]).toBe(sorted[i - 1]! + 1);
      }
    }
  });
});

describe("parseFbiCsv — stages (Social 3)", () => {
  const parsed = parseFbiCsv(SOCIAL3);

  it("extrae los 9 stages: Práctica + Tirada 1..8", () => {
    const numbers = parsed.stages.map((s) => s.stageNumber).sort((a, b) =>
      (a ?? 0) - (b ?? 0),
    );
    expect(numbers).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(parsed.stages[0]?.name).toBe("Práctica");
    expect(parsed.stages[1]?.name).toBe("Tirada 1");
    expect(parsed.stages[8]?.name).toBe("Tirada 8");
  });

  it("suma los 5 disparos por stage en stagePoints", () => {
    // Stoker Oscar — Tirada 4: 10+10+9+9+9 = 47
    const t4 = parsed.stages.find((s) => s.stageNumber === 4)!;
    const stoker = t4.results.find(
      (r) => r.shooter.fullName === "Stoker Oscar",
    );
    expect(stoker?.stagePoints).toBe(47);

    // Mariperisena — Tirada 2: 10+10+10+10+9 = 49
    const t2 = parsed.stages.find((s) => s.stageNumber === 2)!;
    const matias = t2.results.find(
      (r) => r.shooter.fullName === "Mariperisena, Matías",
    );
    expect(matias?.stagePoints).toBe(49);
  });

  it("cuenta hits por stage (disparos no-cero, max 5)", () => {
    // Stoker Oscar — Tirada 4: 5 disparos no-cero → hits = 5.
    const t4 = parsed.stages.find((s) => s.stageNumber === 4)!;
    const stoker = t4.results.find(
      (r) => r.shooter.fullName === "Stoker Oscar",
    );
    expect(stoker?.hits).toBe(5);

    // En general, todos los stage results de FBI tienen hits 0..5.
    for (const stage of parsed.stages) {
      for (const r of stage.results) {
        expect(r.hits).not.toBeNull();
        expect(r.hits).toBeGreaterThanOrEqual(0);
        expect(r.hits).toBeLessThanOrEqual(5);
      }
    }
  });

  it("la suma de stages T1..T8 de un shooter coincide con su matchPoints", () => {
    // Stoker Oscar tiene Puntos=330 según la planilla. Lo verificamos
    // independientemente: sumar los stage_points de T1..T8 debe dar 330.
    const stoker = parsed.matchEntries.find(
      (e) =>
        e.shooter.fullName === "Stoker Oscar" && e.divisionCode === "MINI",
    );
    expect(stoker?.matchPoints).toBe(330);

    let sum = 0;
    for (const stage of parsed.stages) {
      if (stage.stageNumber === 0) continue; // Práctica no suma
      const r = stage.results.find(
        (x) => x.shooter.fullName === "Stoker Oscar",
      );
      if (r) sum += r.stagePoints;
    }
    expect(sum).toBe(330);
  });

  it("Práctica se incluye como stage_number=0 pero NO suma al matchPoints", () => {
    const practica = parsed.stages.find((s) => s.stageNumber === 0);
    expect(practica).toBeDefined();

    // Stoker en Práctica: 9+8+8+8+0 = 33
    const stokerPractica = practica!.results.find(
      (r) => r.shooter.fullName === "Stoker Oscar",
    );
    expect(stokerPractica?.stagePoints).toBe(33);

    // Pero matchPoints sigue siendo 330 (suma sin Práctica).
    const stokerMatch = parsed.matchEntries.find(
      (e) => e.shooter.fullName === "Stoker Oscar",
    );
    expect(stokerMatch?.matchPoints).toBe(330);
  });

  it("marca isDq cuando el stage tiene marcador no-numérico (F4D)", () => {
    // Matera Daniel en PCC tiene F4D en Tirada 1.
    const t1 = parsed.stages.find((s) => s.stageNumber === 1)!;
    const matera = t1.results.find(
      (r) =>
        r.shooter.fullName === "Matera Daniel" && r.divisionCode === "PCC",
    );
    expect(matera?.isDq).toBe(true);
    expect(matera?.stagePoints).toBe(0);
  });

  it("calcula place y stagePercentage por división dentro de cada stage", () => {
    // PCC, Tirada 1: Farias=49, Pinola=17, Matera DQ.
    const t1 = parsed.stages.find((s) => s.stageNumber === 1)!;
    const pccT1 = t1.results
      .filter((r) => r.divisionCode === "PCC")
      .sort((a, b) => a.place - b.place || (a.isDq ? 1 : -1));

    const farias = pccT1.find((r) => r.shooter.fullName === "Farias Maximiliano");
    const pinola = pccT1.find((r) => r.shooter.fullName === "Pinola Emilio F");

    expect(farias?.stagePoints).toBe(49);
    expect(farias?.place).toBe(1);
    expect(farias?.stagePercentage).toBe(100);

    expect(pinola?.stagePoints).toBe(17);
    expect(pinola?.place).toBe(2);
    expect(pinola?.stagePercentage).toBeCloseTo((17 / 49) * 100, 4);
  });

  it("DQ queda con place=0 y percentage=0 al final del ranking", () => {
    const t1 = parsed.stages.find((s) => s.stageNumber === 1)!;
    const matera = t1.results.find(
      (r) =>
        r.shooter.fullName === "Matera Daniel" && r.divisionCode === "PCC",
    );
    expect(matera?.place).toBe(0);
    expect(matera?.stagePercentage).toBe(0);
  });

  it("cada stage tiene un result por shooter del match", () => {
    // Social 3 fixture tiene 6 entries totales (3 Minirifle + 3 PCC).
    // Cada stage debería tener exactamente 6 results.
    expect(parsed.matchEntries.length).toBe(6);
    for (const stage of parsed.stages) {
      expect(stage.results.length).toBe(6);
    }
  });
});

describe("parseFile — dispatcher", () => {
  it("delega CSV de FBI a parseFbiCsv", () => {
    const parsed = parseFile(SOCIAL4);
    expect(parsed.discipline).toBe("tiro_fbi");
    expect(parsed.source).toBe("fbi_csv");
  });
});
