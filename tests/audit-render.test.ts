import { describe, expect, it } from "vitest";
import { describeAuditEntry } from "@/lib/audit/render";
import type { AuditLogRow } from "@/lib/db/types";

function row(overrides: Partial<AuditLogRow>): AuditLogRow {
  return {
    id: 1,
    user_id: "user-1",
    action: "test",
    entity_type: null,
    entity_id: null,
    metadata: null,
    created_at: "2026-05-01T12:00:00Z",
    ...overrides,
  };
}

describe("describeAuditEntry", () => {
  it("match.import: incluye nombre, disciplina, conteos y link", () => {
    const desc = describeAuditEntry(
      row({
        action: "match.import",
        entity_id: "match-123",
        metadata: {
          match_name: "Social 4",
          discipline_name: "Tiro FBI",
          entries_count: 42,
          stages_count: 0,
        },
      }),
    );
    expect(desc.summary).toContain("Social 4");
    expect(desc.summary).toContain("Importaste");
    expect(desc.detail).toContain("Tiro FBI");
    expect(desc.detail).toContain("42 tiradores");
    expect(desc.detail).not.toContain("stages"); // 0 stages → omitido
    expect(desc.link?.href).toBe("/matches/match-123");
  });

  it("match.import con stages > 0 los menciona", () => {
    const desc = describeAuditEntry(
      row({
        action: "match.import",
        metadata: { match_name: "X", entries_count: 5, stages_count: 8 },
      }),
    );
    expect(desc.detail).toContain("8 stages");
  });

  it("match.delete: nombre y fecha", () => {
    const desc = describeAuditEntry(
      row({
        action: "match.delete",
        metadata: { match_name: "Social 3", match_date: "2026-04-19" },
      }),
    );
    expect(desc.summary).toContain("Eliminaste");
    expect(desc.summary).toContain("Social 3");
    expect(desc.detail).toBe("2026-04-19");
  });

  it("match.update_club: muestra before → after", () => {
    const desc = describeAuditEntry(
      row({
        action: "match.update_club",
        entity_id: "m-1",
        metadata: {
          match_name: "Social 4",
          before: { region: null },
          after: { region: "ARG-TFALP" },
        },
      }),
    );
    expect(desc.summary).toContain("Social 4");
    expect(desc.detail).toBe("— → ARG-TFALP");
    expect(desc.link?.href).toBe("/matches/m-1");
  });

  it("shooter.claim: muestra el nombre del shooter y match origen", () => {
    const desc = describeAuditEntry(
      row({
        action: "shooter.claim",
        metadata: {
          shooter_full_name: "Demarziani, Diego",
          match_id: "m-1",
          match_name: "TP Escopeta",
        },
      }),
    );
    expect(desc.summary).toContain("Demarziani, Diego");
    expect(desc.detail).toContain("TP Escopeta");
    expect(desc.link?.href).toBe("/matches/m-1");
  });

  it("shooter.unclaim", () => {
    const desc = describeAuditEntry(
      row({
        action: "shooter.unclaim",
        metadata: { shooter_full_name: "Demarziani Diego" },
      }),
    );
    expect(desc.summary).toContain("Quitaste la asociación");
    expect(desc.summary).toContain("Demarziani Diego");
  });

  it("firearm.create: nombre y atributos", () => {
    const desc = describeAuditEntry(
      row({
        action: "firearm.create",
        entity_id: "f-1",
        metadata: {
          name: "Glock 17",
          brand: "Glock",
          model: "17 Gen 5",
          caliber: "9x19",
        },
      }),
    );
    expect(desc.summary).toContain("Glock 17");
    expect(desc.detail).toBe("Glock · 17 Gen 5 · 9x19");
    expect(desc.link?.href).toBe("/firearms/f-1");
  });

  it("firearm.update: hace diff de campos cambiados", () => {
    const desc = describeAuditEntry(
      row({
        action: "firearm.update",
        entity_id: "f-1",
        metadata: {
          before: {
            name: "Glock 17",
            brand: "Glock",
            caliber: "9x19",
            notes: null,
          },
          after: {
            name: "Glock 17 Gen 5",
            brand: "Glock",
            caliber: "9x19",
            notes: null,
          },
        },
      }),
    );
    expect(desc.summary).toContain("Glock 17 Gen 5");
    expect(desc.detail).toContain("name");
    expect(desc.detail).toContain('"Glock 17"');
    expect(desc.detail).toContain('"Glock 17 Gen 5"');
    expect(desc.detail).not.toContain("brand"); // sin cambio
    expect(desc.detail).not.toContain("caliber"); // sin cambio
  });

  it("firearm.delete: nombre del arma borrada", () => {
    const desc = describeAuditEntry(
      row({
        action: "firearm.delete",
        metadata: { name: "Glock 17", caliber: "9x19" },
      }),
    );
    expect(desc.summary).toContain("Glock 17");
    expect(desc.detail).toContain("9x19");
  });

  it("match_firearm.set: muestra arma y tiros", () => {
    const desc = describeAuditEntry(
      row({
        action: "match_firearm.set",
        metadata: {
          match_id: "m-1",
          match_name: "Social 4",
          before: null,
          after: {
            firearm_id: "f-1",
            firearm_name: "Glock 17",
            rounds_fired: 45,
          },
        },
      }),
    );
    expect(desc.summary).toContain("Glock 17");
    expect(desc.summary).toContain("Social 4");
    expect(desc.detail).toBe("45 tiros");
    expect(desc.link?.href).toBe("/matches/m-1");
  });

  it("match_firearm.clear", () => {
    const desc = describeAuditEntry(
      row({
        action: "match_firearm.clear",
        metadata: { match_id: "m-1", match_name: "Social 4" },
      }),
    );
    expect(desc.summary).toContain("Quitaste");
    expect(desc.summary).toContain("Social 4");
    expect(desc.link?.href).toBe("/matches/m-1");
  });

  it("acción desconocida: cae al fallback con el code crudo", () => {
    const desc = describeAuditEntry(row({ action: "future.thing" }));
    expect(desc.summary).toBe("future.thing");
  });
});
