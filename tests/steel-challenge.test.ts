import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isSteelChallengeFormat,
  parseSteelChallengeHtml,
} from "@/lib/parsers/steel-challenge";
import { parseHtml } from "@/lib/parsers";

const FIXTURES = join(__dirname, "fixtures", "practiscore");
const read = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

describe("isSteelChallengeFormat", () => {
  it("detecta archivos Steel Challenge por encabezado", () => {
    const html = read("steel-2026-02-08-arma-corta.html");
    expect(isSteelChallengeFormat(html)).toBe(true);
  });

  it("no detecta como Steel los archivos IPSC match overall", () => {
    const html = read("tp-escopeta-2026-02-20-match.html");
    expect(isSteelChallengeFormat(html)).toBe(false);
  });

  it("no detecta como Steel los archivos IPSC stage", () => {
    const html = read("tp-escopeta-2026-02-20-stage1.html");
    expect(isSteelChallengeFormat(html)).toBe(false);
  });
});

describe("parseSteelChallengeHtml — Steel Challenge ARMA CORTA", () => {
  const html = read("steel-2026-02-08-arma-corta.html");
  const result = parseSteelChallengeHtml(html);

  it("identifica disciplina y source", () => {
    expect(result.discipline).toBe("steel_challenge");
    expect(result.source).toBe("practiscore_steel_html");
  });

  it("extrae nombre y fecha del match", () => {
    expect(result.name).toBe("Steel Challenge 8/2/26 ARMA CORTA");
    expect(result.date).toBe("2026-02-08");
  });

  it("incluye match_entries de las dos divisiones (PISTOLA y REVOLVER)", () => {
    const divisions = new Set(result.matchEntries.map((e) => e.divisionCode));
    expect(divisions).toEqual(new Set(["PISTOLA", "REVOLVER"]));
  });

  it("Diego Demarziani aparece en PISTOLA con tiempo total y % correctos", () => {
    const diego = result.matchEntries.find((e) =>
      e.shooter.fullName.toLowerCase().includes("demarziani"),
    );
    expect(diego).toBeDefined();
    expect(diego?.divisionCode).toBe("PISTOLA");
    expect(diego?.place).toBe(7);
    expect(diego?.totalTimeSeconds).toBeCloseTo(60.51, 2);
    expect(diego?.matchPercentage).toBeCloseTo(62.68, 2);
    expect(diego?.powerFactor).toBeNull();
    expect(diego?.matchPoints).toBe(0);
  });

  it("extrae 3 stages con sus nombres", () => {
    expect(result.stages).toHaveLength(3);
    const names = result.stages.map((s) => s.name);
    expect(names).toContain("Cancha 3");
    expect(names).toContain("Cancha 4");
    expect(names).toContain("Cancha 5");
    expect(result.stages.map((s) => s.stageNumber)).toEqual([1, 2, 3]);
  });

  it("cada stage tiene los tiempos por tirador y le calcula place + %", () => {
    const stage1 = result.stages.find((s) => s.stageNumber === 1)!;
    const pistolaResults = stage1.results.filter(
      (r) => r.divisionCode === "PISTOLA",
    );
    expect(pistolaResults.length).toBe(10);

    // Ganador del stage 1 PISTOLA es Gramigna con 11.54s
    const winner = pistolaResults.find((r) => r.place === 1)!;
    expect(winner.shooter.fullName).toBe("Gramigna, Juan");
    expect(winner.timeSeconds).toBeCloseTo(11.54, 2);
    expect(winner.stagePercentage).toBe(100);

    // Diego en stage 1 PISTOLA: 22.31s, place según ranking de tiempos
    const diego = pistolaResults.find((r) =>
      r.shooter.fullName.toLowerCase().includes("demarziani"),
    )!;
    expect(diego.timeSeconds).toBeCloseTo(22.31, 2);
    // % = 11.54 / 22.31 ≈ 51.73
    expect(diego.stagePercentage).toBeCloseTo((11.54 / 22.31) * 100, 1);
  });

  it("REVOLVER tiene 2 tiradores y se rankea por tiempo total", () => {
    const revolver = result.matchEntries.filter(
      (e) => e.divisionCode === "REVOLVER",
    );
    expect(revolver).toHaveLength(2);
    const winner = revolver.find((e) => e.place === 1)!;
    expect(winner.shooter.fullName).toBe("Lorenzo, Daniel");
    expect(winner.totalTimeSeconds).toBeCloseTo(96.37, 2);
  });
});

describe("parseHtml dispatcher", () => {
  it("delega Steel Challenge al parser correcto", () => {
    const html = read("steel-2026-02-08-arma-corta.html");
    const result = parseHtml(html);
    expect(result.discipline).toBe("steel_challenge");
  });

  it("delega IPSC match al parser correcto", () => {
    const html = read("tp-escopeta-2026-02-20-match.html");
    const result = parseHtml(html);
    expect(result.discipline).toBe("ipsc");
  });

  it("delega IPSC stage al parser correcto", () => {
    const html = read("tp-escopeta-2026-02-20-stage1.html");
    const result = parseHtml(html);
    expect(result.discipline).toBe("ipsc");
    expect(result.stages.length).toBeGreaterThan(0);
  });
});

/**
 * Resolución de división en el parser HTML (migración 0024).
 *
 * Este parser tomaba el rótulo de la sección **crudo** como
 * `divisions.code`. Funcionaba sólo porque los rótulos que había visto
 * coincidían con los codes de la base — PISTOLA, REVOLVER. Cualquier alias
 * moría ahí, que es justo lo que el registry existe para evitar (#114), y
 * el parser PDF de Steel siempre resolvió a través de él. El HTML era el
 * que faltaba; "Minirifle" → `RFRI` es el primer rótulo que lo expone.
 */
describe("parseSteelChallengeHtml — resolución de división", () => {
  /** HTML mínimo con la forma que emite PractiScore. */
  function steelHtml(sectionLabel: string, divisionColumn = "X") {
    return `<!DOCTYPE html><html><head>
<title>Steel Challenge 090826 : 2026-08-08</title></head><body>
<div>Steel Challenge 090826<br>2026-08-08<br>Match Results - By Division</div>
<table cellspacing="0">
<thead>
<tr><td class="division_head" colspan="9"><br><b>${sectionLabel}</b></td></tr>
<tr><th>Final</th><th class="stage_head">Name</th><th class="stage_head">USPSA#</th><th class="stage_head">Division</th><th class="stage_head">Time</th><th class="stage_head">%</th><th class="stage_head">1: Cancha 3</th><th class="stage_head">2: Cancha 4</th><th class="stage_head">3: Cancha 5</th></tr>
</thead>
<tbody class="zebra">
<tr><td class="score_cell">1</td><td class="nobr">Ibai, Ibai</td><td class="nobr"></td><td class="nobr">${divisionColumn}</td><td class="time_cell">27.73</td><td class="time_cell">100.00</td><td class="time_cell">7.81</td><td class="time_cell">11.42</td><td class="time_cell">8.50</td></tr>
</tbody>
</table></body></html>`;
  }

  it("mapea el rótulo 'Minirifle' al code RFRI", () => {
    const result = parseSteelChallengeHtml(steelHtml("Minirifle"));

    expect(result.matchEntries).toHaveLength(1);
    expect(result.matchEntries[0]!.divisionCode).toBe("RFRI");
  });

  it("sigue resolviendo los rótulos que ya eran code (sin regresión)", () => {
    for (const label of ["PISTOLA", "REVOLVER", "PCC"]) {
      const result = parseSteelChallengeHtml(steelHtml(label));
      expect(result.matchEntries[0]!.divisionCode).toBe(label);
    }
  });

  it("la sección manda sobre la columna Division", () => {
    // En los reportes por categoría la columna trae una sola letra ("M",
    // "P") que colisiona entre divisiones — PCC y Pistola ambas dicen "P".
    // El rótulo de la sección es el dato bueno.
    const result = parseSteelChallengeHtml(steelHtml("Minirifle", "M"));
    expect(result.matchEntries[0]!.divisionCode).toBe("RFRI");
  });

  it("una división desconocida NO se descarta: pasa normalizada", () => {
    // Descartarla perdería una división entera en silencio y el import
    // reportaría éxito habiendo importado menos de lo que traía el archivo.
    // Pasándola, `requireDivision` corta con un error que nombra el rótulo
    // y le dice al admin que lo registre como alias.
    const result = parseSteelChallengeHtml(steelHtml("Deportivo"));

    expect(result.matchEntries).toHaveLength(1);
    expect(result.matchEntries[0]!.divisionCode).toBe("DEPORTIVO");
  });
});
