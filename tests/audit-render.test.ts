import { describe, expect, it } from "vitest";
import { createTranslator } from "use-intl";
import { describeAuditEntry, type AuditTranslator } from "@/lib/audit/render";
import { loadCatalogues } from "./helpers/catalogues";

/**
 * Se usan los traductores **reales** sobre los catálogos de todos los locales
 * de `routing`, en vez de un fake tipo `(k) => k`. Un fake haría pasar los
 * tests aunque falte una clave: next-intl devuelve `<namespace>.<clave>`
 * cuando no la encuentra, así que el assert sobre el texto final es lo único
 * que detecta un mensaje sin traducir.
 */
const CATALOGUES = loadCatalogues();

/**
 * `createTranslator` infiere las claves del JSON importado, así que su `key`
 * es una unión literal y no `string`. `AuditTranslator` acepta cualquier
 * `string` —tiene que hacerlo: `describeDiff` arma `field.<columna>` en
 * runtime— y por contravarianza el traductor concreto no es asignable al tipo
 * más ancho. El cast vive acá, una sola vez, en vez de en cada llamada.
 */
function auditTranslator(
  locale: string,
  messages: Record<string, unknown>,
): AuditTranslator {
  const translate = createTranslator({
    locale,
    messages,
    namespace: "activityLog",
  } as never) as unknown as AuditTranslator;
  return translate;
}

const t = auditTranslator("es", CATALOGUES.es!);
const tEn = auditTranslator("en", CATALOGUES.en!);
const tPt = auditTranslator("pt-BR", CATALOGUES["pt-BR"]!);
import type { AuditLogRow } from "@/lib/db/types";
import { AUDIT_ACTION } from "@/lib/audit/log-action";

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
      t,
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
      t,
    );
    expect(desc.detail).toContain("8 stages");
  });

  it("match.delete: nombre y fecha", () => {
    const desc = describeAuditEntry(
      row({
        action: "match.delete",
        metadata: { match_name: "Social 3", match_date: "2026-04-19" },
      }),
      t,
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
      t,
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
      t,
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
      t,
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
      t,
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
      t,
    );
    expect(desc.summary).toContain("Glock 17 Gen 5");
    // El nombre del campo ahora se traduce: "name" → "nombre".
    expect(desc.detail).toContain("nombre");
    expect(desc.detail).toContain('"Glock 17"');
    expect(desc.detail).toContain('"Glock 17 Gen 5"');
    expect(desc.detail).not.toContain("marca"); // sin cambio
    expect(desc.detail).not.toContain("calibre"); // sin cambio
  });

  it("firearm.delete: nombre del arma borrada", () => {
    const desc = describeAuditEntry(
      row({
        action: "firearm.delete",
        metadata: { name: "Glock 17", caliber: "9x19" },
      }),
      t,
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
      t,
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
      t,
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
      t,
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
      t,
    );
    // Los campos de munición también se traducen: el snapshot de ammo hace
    // `select("*")`, así que estos entran igual que los del arma.
    expect(desc.detail).toContain("carga de pólvora (gr)");
    expect(desc.detail).not.toContain("powder_charge_grains");
    expect(desc.detail).not.toContain("pólvora:"); // sin cambio
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
      t,
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
      t,
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
      t,
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
      t,
    );
    expect(desc.summary).toContain("Borraste");
    expect(desc.summary).toContain("Glock 17");
    expect(desc.detail).toContain("80 tiros");
    expect(desc.link?.href).toBe("/firearms/f-1");
  });

  it("acción desconocida: cae al fallback con el code crudo", () => {
    const desc = describeAuditEntry(row({ action: "future.thing" }), t);
    expect(desc.summary).toBe("future.thing");
  });
});

/**
 * Cobertura de lo que introdujo la internacionalización (#147). Los tests de
 * arriba verifican el texto en español; estos verifican que el mecanismo
 * funcione y no se rompa con datos inesperados.
 */
describe("describeAuditEntry — i18n", () => {
  it("renderiza en inglés con el mismo row", () => {
    const r = row({
      action: "match.import",
      entity_id: "m-1",
      metadata: { match_name: "Copa Social", entries_count: 12 },
    });
    expect(describeAuditEntry(r, t).summary).toBe(
      'Importaste el match "Copa Social"',
    );
    expect(describeAuditEntry(r, tEn).summary).toBe(
      'You imported the match "Copa Social"',
    );
  });

  // Los conteos usan plural ICU. Con un fake `(k) => k` esto pasaría igual;
  // con el traductor real, un `{count}` mal escrito se ve.
  it("pluraliza los conteos en todos los idiomas", () => {
    const one = row({
      action: "match.import",
      metadata: { match_name: "X", entries_count: 1, stages_count: 1 },
    });
    const many = row({
      action: "match.import",
      metadata: { match_name: "X", entries_count: 12, stages_count: 4 },
    });
    expect(describeAuditEntry(one, t).detail).toBe("1 tirador · 1 stage");
    expect(describeAuditEntry(many, t).detail).toBe("12 tiradores · 4 stages");
    expect(describeAuditEntry(one, tEn).detail).toBe("1 shooter · 1 stage");
    expect(describeAuditEntry(many, tEn).detail).toBe(
      "12 shooters · 4 stages",
    );
    expect(describeAuditEntry(one, tPt).detail).toBe("1 atirador · 1 stage");
    expect(describeAuditEntry(many, tPt).detail).toBe(
      "12 atiradores · 4 stages",
    );
  });

  /**
   * `pt-BR` puts zero in the `one` plural category; `es` and `en` put it in
   * `other`:
   *
   *     Intl.PluralRules("pt-BR").select(0) === "one"
   *     Intl.PluralRules("es").select(0)    === "other"
   *
   * So every `{count, plural, one {…} other {…}}` in the catalogue renders a
   * different branch at zero depending on the locale, and nothing else here
   * would notice. `messages-parity` cannot: its ICU walker extracts argument
   * *names* and discards branch bodies by design.
   *
   * `describeAuditEntry` reaches this — it guards `entries != null`, not
   * `entries > 0` (`lib/audit/render.ts`), unlike `stages` right below it.
   */
  it("renderiza el cero con la rama que cada idioma pide", () => {
    const zero = row({
      action: "match.import",
      metadata: { match_name: "X", entries_count: 0, stages_count: 0 },
    });
    expect(describeAuditEntry(zero, t).detail).toBe("0 tiradores");
    expect(describeAuditEntry(zero, tEn).detail).toBe("0 shooters");
    // Singular on purpose: CLDR's `one` category for Portuguese covers 0..1.
    expect(describeAuditEntry(zero, tPt).detail).toBe("0 atirador");
  });

  /**
   * El audit log es histórico: puede tener snapshots de columnas que ya no
   * existen. Un campo fuera de `DIFF_FIELD_KEYS` tiene que salir crudo, no
   * como `activityLog.field.<x>`, que es lo que devuelve next-intl cuando no
   * encuentra la clave.
   */
  it("muestra crudo un campo del diff que no tiene traducción", () => {
    const desc = describeAuditEntry(
      row({
        action: "firearm.update",
        metadata: {
          before: { columna_vieja: "a" },
          after: { columna_vieja: "b" },
        },
      }),
      t,
    );
    expect(desc.detail).toContain("columna_vieja:");
    expect(desc.detail).not.toContain("activityLog");
  });

  it("los labels de link también se traducen", () => {
    const r = row({
      action: "match.import",
      entity_id: "m-1",
      metadata: { match_name: "X" },
    });
    expect(describeAuditEntry(r, t).link?.label).toBe("Ver match");
    expect(describeAuditEntry(r, tEn).link?.label).toBe("View match");
  });

  it("una acción desconocida cae al nombre crudo", () => {
    const desc = describeAuditEntry(
      row({ action: "algo.nuevo" as never, metadata: {} }),
      t,
    );
    expect(desc.summary).toBe("algo.nuevo");
  });
});

describe("describeAuditEntry — admin.view_as", () => {
  it("nombra a quién se miró y con qué filtro", () => {
    const d = describeAuditEntry(
      row({
        action: "admin.view_as",
        entity_type: "profile",
        entity_id: "target-1",
        metadata: {
          profile_display_name: "Someone Else",
          shooter_count: 2,
          discipline_code: "ipsc",
          division_code: "PO",
        },
      }),
      t,
    );
    expect(d.summary).toContain("Someone Else");
    expect(d.detail).toBe("ipsc · PO");
  });

  it("sin filtros dice que fue la vista consolidada", () => {
    const d = describeAuditEntry(
      row({
        action: "admin.view_as",
        metadata: {
          profile_display_name: "Someone Else",
          discipline_code: null,
          division_code: null,
        },
      }),
      t,
    );
    expect(d.detail).toBe("vista consolidada");
  });

  it("tolera una fila vieja sin display_name", () => {
    const d = describeAuditEntry(
      row({ action: "admin.view_as", metadata: {} }),
      t,
    );
    // No revienta ni deja el summary vacío: cae al nombre desconocido.
    expect(d.summary.length).toBeGreaterThan(0);
    expect(d.summary).not.toContain("activityLog.");
  });

  it("también renderiza en inglés", () => {
    const d = describeAuditEntry(
      row({
        action: "admin.view_as",
        metadata: {
          profile_display_name: "Someone Else",
          discipline_code: null,
          division_code: null,
        },
      }),
      tEn,
    );
    expect(d.summary).toContain("viewed the dashboard as");
    expect(d.detail).toBe("consolidated view");
  });
});

/**
 * `AUDIT_ACTION` lleva escrita la convención desde el principio: *"Si
 * agregás una acción nueva, sumala acá Y en `describeAuditEntry` para que
 * la pantalla /activity la muestre legible"*. Nada la verificaba.
 *
 * El costo de olvidarla es silencioso y feo: el `default` del switch
 * devuelve `row.action` crudo, así que la pantalla muestra `admin.view_as`
 * en vez de una frase. No falla nada — solo queda una fila ilegible en el
 * único lugar donde el usuario audita su propia cuenta.
 */
describe("describeAuditEntry — cobertura del catálogo", () => {
  it("toda acción de AUDIT_ACTION tiene su case (y no cae al fallback)", () => {
    const missing = Object.values(AUDIT_ACTION).filter((action) => {
      const d = describeAuditEntry(row({ action, metadata: {} }), t);
      // El fallback devuelve el código crudo como summary.
      return d.summary === action;
    });

    expect(
      missing,
      `Estas acciones no tienen case en describeAuditEntry, así que /activity ` +
        `las muestra como código crudo: ${missing.join(", ")}.`,
    ).toEqual([]);
  });

  it("ninguna acción deja escapar una clave sin traducir", () => {
    // next-intl devuelve "<namespace>.<clave>" cuando falta el mensaje, así
    // que una clave nueva sin entrada en es.json/en.json se ve como
    // "activityLog.loQueSea" en pantalla en vez de romper.
    for (const action of Object.values(AUDIT_ACTION)) {
      for (const translator of [t, tEn]) {
        const d = describeAuditEntry(row({ action, metadata: {} }), translator);
        expect(`${d.summary} ${d.detail ?? ""}`, action).not.toContain(
          "activityLog.",
        );
      }
    }
  });
});

describe("describeAuditEntry — admin.view_as sin scope registrado", () => {
  /**
   * Distinguir "consolidado" de "no sabemos". Una fila escrita por
   * `resolveImpersonation` siempre trae `discipline_code`, aunque sea null;
   * si la clave falta, la fila es anterior a #208 o vino truncada, y decir
   * "vista consolidada" sería afirmar un dato que no tenemos.
   */
  it("omite el detalle si la clave de scope no está", () => {
    const d = describeAuditEntry(
      row({
        action: "admin.view_as",
        metadata: { profile_display_name: "Someone Else" },
      }),
      t,
    );
    expect(d.detail).toBeUndefined();
  });

  it("dice consolidada solo si el scope se registró vacío", () => {
    const d = describeAuditEntry(
      row({
        action: "admin.view_as",
        metadata: {
          profile_display_name: "Someone Else",
          discipline_code: null,
          division_code: null,
        },
      }),
      t,
    );
    expect(d.detail).toBe("vista consolidada");
  });
});
