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

  it("ammo.create: nombre, tipo legible y atributos", () => {
    const desc = describeAuditEntry(
      row({
        action: "ammo.create",
        entity_id: "a-1",
        metadata: {
          name: "9mm Hornady 124gr",
          type: "reload",
          caliber: "9x19",
          brand: "Hornady",
        },
      }),
    );
    expect(desc.summary).toContain("9mm Hornady 124gr");
    // "reload" se renderiza como "recarga" en español.
    expect(desc.detail).toContain("recarga");
    expect(desc.detail).toContain("9x19");
    expect(desc.detail).toContain("Hornady");
    expect(desc.link?.href).toBe("/ammo/a-1");
  });

  it("ammo.update: diff de campos cambiados", () => {
    const desc = describeAuditEntry(
      row({
        action: "ammo.update",
        entity_id: "a-1",
        metadata: {
          before: {
            name: "9mm Hornady",
            powder_charge_grains: 4.3,
            powder: "N320",
          },
          after: {
            name: "9mm Hornady",
            powder_charge_grains: 4.4,
            powder: "N320",
          },
        },
      }),
    );
    expect(desc.detail).toContain("powder_charge_grains");
    expect(desc.detail).not.toContain("powder:"); // unchanged
  });

  it("ammo.delete: nombre y atributos del borrado", () => {
    const desc = describeAuditEntry(
      row({
        action: "ammo.delete",
        metadata: {
          name: "9mm Hornady 124gr",
          type: "factory",
          caliber: "9x19",
        },
      }),
    );
    expect(desc.summary).toContain("9mm Hornady 124gr");
    expect(desc.detail).toContain("factory");
    expect(desc.detail).toContain("9x19");
  });

  it("firearm_usage.create: arma, tiros, fecha y munición", () => {
    const desc = describeAuditEntry(
      row({
        action: "firearm_usage.create",
        metadata: {
          firearm_id: "f-1",
          firearm_name: "Glock 17",
          used_on: "2026-05-12",
          rounds_fired: 150,
          ammunition_name: "Magtech 124gr",
        },
      }),
    );
    expect(desc.summary).toContain("Glock 17");
    expect(desc.detail).toContain("150 tiros");
    expect(desc.detail).toContain("2026-05-12");
    expect(desc.detail).toContain("Magtech 124gr");
    expect(desc.link?.href).toBe("/firearms/f-1");
  });

  it("firearm_usage.create sin munición: omite ese fragmento", () => {
    const desc = describeAuditEntry(
      row({
        action: "firearm_usage.create",
        metadata: {
          firearm_id: "f-1",
          firearm_name: "Glock 17",
          used_on: "2026-05-12",
          rounds_fired: 80,
          ammunition_name: null,
        },
      }),
    );
    expect(desc.detail).toContain("80 tiros");
    expect(desc.detail).not.toContain("null");
  });

  it("firearm_usage.delete: arma y datos del borrado", () => {
    const desc = describeAuditEntry(
      row({
        action: "firearm_usage.delete",
        metadata: {
          firearm_id: "f-1",
          firearm_name: "Glock 17",
          used_on: "2026-05-12",
          rounds_fired: 80,
        },
      }),
    );
    expect(desc.summary).toContain("Borraste");
    expect(desc.summary).toContain("Glock 17");
    expect(desc.detail).toContain("80 tiros");
    expect(desc.link?.href).toBe("/firearms/f-1");
  });

  it("acción desconocida: cae al fallback con el code crudo", () => {
    const desc = describeAuditEntry(row({ action: "future.thing" }));
    expect(desc.summary).toBe("future.thing");
  });
});
