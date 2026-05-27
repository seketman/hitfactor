import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePractiscoreHtml } from "@/lib/parsers/practiscore";

const FIXTURES = join(__dirname, "fixtures", "practiscore");
const read = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

describe("parsePractiscoreHtml — Combined match results", () => {
  const html = read("ranking-social-2026-combined.html");
  const result = parsePractiscoreHtml(html);

  it("identifies the source as combined", () => {
    expect(result.source).toBe("practiscore_combined_html");
    expect(result.discipline).toBe("ipsc");
  });

  it("extracts match name and date", () => {
    expect(result.name).toBe("1er Ranking Social 2026");
    expect(result.date).toBe("2026-03-28");
  });

  it("captures the region from the entries", () => {
    expect(result.region).toBe("ARG-TFALP");
  });

  it("returns 33 match entries (one per shooter)", () => {
    expect(result.matchEntries).toHaveLength(33);
  });

  it("first place is ALZATTO with 100%", () => {
    const first = result.matchEntries[0];
    expect(first.place).toBe(1);
    // El fixture trae "ALZATTO, Luciano PCC" — el código de división `PCC`
    // pegado al apellido es ruido del export, no parte del nombre real.
    // El parser lo descarta vía `stripNameSuffixes`.
    expect(first.shooter.fullName).toBe("ALZATTO, Luciano");
    expect(first.divisionCode).toBe("PCCO");
    expect(first.matchPercentage).toBe(100);
  });

  it("parses senior categories and member numbers", () => {
    const entry = result.matchEntries.find(
      (e) => e.shooter.fullName === "LANZILLOTTA, Daniel Ezequiel",
    );
    expect(entry).toBeDefined();
    expect(entry?.shooter.memberNumber).toBe("2821");
    expect(entry?.category).toBe("Senior");
    expect(entry?.divisionCode).toBe("PCCO");
  });

  it("does not produce stages for combined files", () => {
    expect(result.stages).toEqual([]);
  });
});

describe("parsePractiscoreHtml — Match results by division", () => {
  const html = read("tp-escopeta-2026-02-20-match.html");
  const result = parsePractiscoreHtml(html);

  it("identifies the source", () => {
    expect(result.source).toBe("practiscore_match_html");
  });

  it("extracts the match name", () => {
    expect(result.name).toBe("TP ESCOPETA 20/02/26 TFALP");
    expect(result.date).toBe("2026-02-20");
  });

  it("flattens all divisions into a single match-entries list", () => {
    // 2 (Open) + 4 (PCC) + 7 (Pistola) + 8 (Standard) + 1 (SM/DQ) = 22
    expect(result.matchEntries.length).toBeGreaterThan(15);
  });

  it("Diego Demarziani appears in division PIS with place 4", () => {
    // El header de la sección es "Match Results - Pistola" → división PIS.
    // PractiScore en este archivo deja `Div=P` en la fila, pero confiamos
    // en el título de la sección porque la columna `Div` es configurable
    // por el organizador y no es estable.
    const diego = result.matchEntries.find((e) =>
      e.shooter.fullName.toLowerCase().includes("demarziani"),
    );
    expect(diego).toBeDefined();
    expect(diego?.divisionCode).toBe("PIS");
    expect(diego?.place).toBe(4);
    expect(diego?.matchPercentage).toBeCloseTo(73.7623, 3);
    expect(diego?.matchPoints).toBeCloseTo(255.2206, 3);
    expect(diego?.powerFactor).toBe("Maj");
  });

  it("captures DQ entries with isDq=true", () => {
    const dq = result.matchEntries.find((e) => e.isDq);
    expect(dq).toBeDefined();
    expect(dq?.shooter.fullName).toBe("Guevara, Andrea");
    expect(dq?.divisionCode).toBe("SM");
  });
});

describe("parsePractiscoreHtml — Stage results", () => {
  const html = read("tp-escopeta-2026-02-20-stage1.html");
  const result = parsePractiscoreHtml(html);

  it("identifies the source as stage", () => {
    expect(result.source).toBe("practiscore_stage_html");
  });

  it("extracts stage 1 with stage number", () => {
    expect(result.stages).toHaveLength(1);
    const stage = result.stages[0];
    expect(stage.stageNumber).toBe(1);
    expect(stage.name).toContain("Stage 1");
  });

  it("contains results from all divisions in the stage", () => {
    const stage = result.stages[0];
    const divisions = new Set(stage.results.map((r) => r.divisionCode));
    // Secciones: Open(O), PCC, Pistola(PIS), Standard(S), Standard Manual(SM)
    expect(divisions.size).toBeGreaterThanOrEqual(4);
  });

  it("Diego Demarziani has a stage 1 result with hit factor", () => {
    const stage = result.stages[0];
    const diego = stage.results.find((r) =>
      r.shooter.fullName.toLowerCase().includes("demarziani"),
    );
    expect(diego).toBeDefined();
    expect(diego?.divisionCode).toBe("PIS");
    expect(diego?.hitFactor).toBeGreaterThan(0);
    expect(diego?.timeSeconds).toBeGreaterThan(0);
    expect(diego?.stagePercentage).toBeGreaterThan(0);
  });

  it("DQ rows do not break parsing", () => {
    const stage = result.stages[0];
    const dq = stage.results.find((r) => r.isDq);
    expect(dq).toBeDefined();
    expect(dq?.shooter.fullName).toBe("Guevara, Andrea");
    expect(dq?.hitFactor).toBeNull();
  });

  it("does not produce match entries for stage files", () => {
    expect(result.matchEntries).toEqual([]);
  });
});

describe("parsePractiscoreHtml — Stage 6 cross-check", () => {
  it("extracts stage 6 stage number", () => {
    const result = parsePractiscoreHtml(read("tp-escopeta-2026-02-20-stage6.html"));
    expect(result.stages).toHaveLength(1);
    expect(result.stages[0].stageNumber).toBe(6);
  });
});

describe("parsePractiscoreHtml — stageNumber para títulos en español", () => {
  // PractiScore para Android genera títulos de stage en el idioma del
  // device del organizador. Casos reales con "Ejercicio N" — antes
  // quedaban con stageNumber=null y `attachStagesToMatch` los filtraba
  // sin insertarlos, mientras el UI reportaba "se agregaron stages: 0".
  const stageHtml = (heading: string) => `
    <!DOCTYPE html><html><head><title>${heading}</title></head><body>
    <h3>${heading}</h3>
    <table><tr><td class="division_head"><b>Stage Results - Production</b></td></tr>
    <tr><th>Place</th><th>Name</th><th>No.</th><th>Class</th><th>Div</th><th>PF</th><th>Points</th><th>Pen</th><th>Time</th><th>Hit Factor</th><th>Stage Pts</th><th>Stage %</th></tr>
    <tr><td>1</td><td>Demarziani, Diego</td><td></td><td>U</td><td>P</td><td>Min</td><td>50</td><td>0</td><td>15.81</td><td>3.1626</td><td>50.0000</td><td>100.00%</td></tr>
    </table></body></html>`;

  it("Ejercicio N: extrae el número", () => {
    const result = parsePractiscoreHtml(
      stageHtml("Final Curso - Ejercicio 1 - 2025-07-06"),
    );
    expect(result.stages[0]?.stageNumber).toBe(1);
  });

  it("Etapa N: extrae el número", () => {
    const result = parsePractiscoreHtml(
      stageHtml("Torneo X - Etapa 3 - 2025-07-06"),
    );
    expect(result.stages[0]?.stageNumber).toBe(3);
  });

  it("Stand N: extrae el número", () => {
    const result = parsePractiscoreHtml(
      stageHtml("Torneo X - Stand 7 - 2025-07-06"),
    );
    expect(result.stages[0]?.stageNumber).toBe(7);
  });

  it("Ej. N (abreviatura con punto): extrae el número", () => {
    const result = parsePractiscoreHtml(
      stageHtml("Torneo X - Ej. 4 - 2025-07-06"),
    );
    expect(result.stages[0]?.stageNumber).toBe(4);
  });
});

describe("parsePractiscoreHtml — Ranking by-division", () => {
  it("returns multiple match-entries across divisions", () => {
    const html = read("ranking-social-2026-by-division.html");
    const result = parsePractiscoreHtml(html);
    expect(result.source).toBe("practiscore_match_html");
    expect(result.name).toBe("1er Ranking Social 2026");
    const divisions = new Set(result.matchEntries.map((e) => e.divisionCode));
    expect(divisions.has("PCCO")).toBe(true);
    expect(divisions.has("P")).toBe(true);
    expect(divisions.has("PO")).toBe(true);
  });
});

describe("parsePractiscoreHtml — section header overrides row Div code", () => {
  // Regresión: PractiScore deja que el organizador defina los códigos
  // cortos de división en la config del match, así que la columna `Div`
  // de las filas no es estable. Vimos archivos con `C` para Classic y `P`
  // tanto para Pcc como para Pistola dentro del mismo torneo. El parser
  // debe derivar la división del título de la sección, que sí es texto
  // humano fijo, y caer al `Div` de la fila solo cuando la sección es
  // "Combined" (un solo bloque con todas las divisiones mezcladas).
  const html = `<!DOCTYPE html><html><head>
<title>Test - 2026-05-24</title>
</head><body>
<h3>Test - 2026-05-24</h3>
<table>
<tr><td class="division_head" colspan="6"><b>Match Results - Classic</b></td></tr>
<tr><th>Place</th><th>Name</th><th>No.</th><th>Class</th><th>Div</th><th>PF</th><th>Category</th><th>Match Pts</th><th>Match %</th><th>Region</th></tr>
<tr><td>1</td><td>Foo, Alpha</td><td>1</td><td>U</td><td>C</td><td>Maj</td><td></td><td>100.0</td><td>100.0%</td><td></td></tr>
<tr><td class="division_head" colspan="6"><b>Match Results - Pcc</b></td></tr>
<tr><th>Place</th><th>Name</th><th>No.</th><th>Class</th><th>Div</th><th>PF</th><th>Category</th><th>Match Pts</th><th>Match %</th><th>Region</th></tr>
<tr><td>1</td><td>Foo, Bravo</td><td>2</td><td>U</td><td>P</td><td>Maj</td><td></td><td>100.0</td><td>100.0%</td><td></td></tr>
<tr><td class="division_head" colspan="6"><b>Match Results - Pistola</b></td></tr>
<tr><th>Place</th><th>Name</th><th>No.</th><th>Class</th><th>Div</th><th>PF</th><th>Category</th><th>Match Pts</th><th>Match %</th><th>Region</th></tr>
<tr><td>1</td><td>Foo, Charlie</td><td>3</td><td>U</td><td>P</td><td>Maj</td><td></td><td>100.0</td><td>100.0%</td><td></td></tr>
<tr><td class="division_head" colspan="6"><b>Match Results - Open</b></td></tr>
<tr><th>Place</th><th>Name</th><th>No.</th><th>Class</th><th>Div</th><th>PF</th><th>Category</th><th>Match Pts</th><th>Match %</th><th>Region</th></tr>
<tr><td>1</td><td>Foo, Delta</td><td>4</td><td>U</td><td>O</td><td>Maj</td><td></td><td>100.0</td><td>100.0%</td><td></td></tr>
</table>
</body></html>`;
  const result = parsePractiscoreHtml(html);
  const byName = (name: string) =>
    result.matchEntries.find((e) => e.shooter.fullName === name);

  it("mapea 'Classic' a 'CL' aunque la fila diga Div=C", () => {
    expect(byName("Foo, Alpha")?.divisionCode).toBe("CL");
  });

  it("mapea 'Pcc' a 'PCC' aunque la fila diga Div=P", () => {
    expect(byName("Foo, Bravo")?.divisionCode).toBe("PCC");
  });

  it("mapea 'Pistola' a 'PIS' aunque la fila diga Div=P", () => {
    expect(byName("Foo, Charlie")?.divisionCode).toBe("PIS");
  });

  it("respeta el Div de la fila cuando coincide con el header", () => {
    expect(byName("Foo, Delta")?.divisionCode).toBe("O");
  });
});
