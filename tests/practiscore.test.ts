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
    expect(first.shooter.fullName).toBe("ALZATTO, Luciano PCC");
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

  it("Diego Demarziani appears in division P with place 4", () => {
    const diego = result.matchEntries.find((e) =>
      e.shooter.fullName.toLowerCase().includes("demarziani"),
    );
    expect(diego).toBeDefined();
    expect(diego?.divisionCode).toBe("P");
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
    // Open(O), PCC, P, S, SM
    expect(divisions.size).toBeGreaterThanOrEqual(4);
  });

  it("Diego Demarziani has a stage 1 result with hit factor", () => {
    const stage = result.stages[0];
    const diego = stage.results.find((r) =>
      r.shooter.fullName.toLowerCase().includes("demarziani"),
    );
    expect(diego).toBeDefined();
    expect(diego?.divisionCode).toBe("P");
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
