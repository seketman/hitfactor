import type { AuditLogRow } from "@/lib/db/types";

/**
 * Descripción legible de una entrada del audit log.
 *
 * Pure function: convierte el row crudo (con metadata jsonb genérica) en
 * algo presentable. La página `/activity` la consume para renderizar JSX.
 */
export interface AuditDescription {
  /** Resumen principal — siempre presente. */
  summary: string;
  /** Detalle secundario — más fino, opcional. */
  detail?: string;
  /** Link al recurso afectado, si todavía existe. */
  link?: { href: string; label: string };
}

/**
 * Traductor que necesita `describeAuditEntry`.
 *
 * Es un tipo **estructural**, no el `Translator` de next-intl, y eso es a
 * propósito: este módulo no importa nada de i18n, así que sigue siendo
 * testeable pasándole una función de dos líneas.
 *
 * **Por qué se inyecta en vez de devolver claves.** Los errores de import
 * cruzan un límite de serialización —se tiran hondo en un parser, se
 * atrapan en el server action y viajan a la página como query string— y ahí
 * la app usa códigos (`UploadErrorCode`) que la UI traduce. Acá no hay tal
 * límite: `/activity` llama a esta función en el mismo server component donde
 * ya tiene su `t`. Devolver claves obligaría a inventar un formato para
 * describir frases compuestas (el `detail` es un join de partes, algunas
 * traducibles y otras datos crudos) sin ganar nada a cambio.
 */
export type AuditTranslator = (
  key: string,
  values?: Record<string, string | number>,
) => string;

type Json = Record<string, unknown>;

function s(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function n(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function obj(v: unknown): Json | undefined {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Json)
    : undefined;
}

/** Une las partes de un detalle con el separador de la UI. */
function join(parts: Array<string | undefined>): string | undefined {
  const present = parts.filter((x): x is string => !!x);
  return present.length > 0 ? present.join(" · ") : undefined;
}

export function describeAuditEntry(
  row: AuditLogRow,
  t: AuditTranslator,
): AuditDescription {
  const m = (row.metadata ?? {}) as Json;
  const matchLink = (id: unknown) =>
    s(id) ? { href: `/matches/${id}`, label: t("linkMatch") } : undefined;
  const firearmLink = (id: unknown) =>
    s(id) ? { href: `/firearms/${id}`, label: t("linkFirearm") } : undefined;

  switch (row.action) {
    case "match.import": {
      const entries = n(m.entries_count);
      const stages = n(m.stages_count);
      return {
        summary: t("matchImport", { name: s(m.match_name) ?? t("someMatch") }),
        detail: join([
          s(m.discipline_name),
          entries != null ? t("shooterCount", { count: entries }) : undefined,
          stages != null && stages > 0
            ? t("stageCount", { count: stages })
            : undefined,
        ]),
        link: matchLink(row.entity_id),
      };
    }

    case "match.delete":
      return {
        summary: t("matchDelete", {
          name: s(m.match_name) ?? t("unknownName"),
        }),
        detail: s(m.match_date),
      };

    case "match.update_club": {
      // "—" es un símbolo, no texto: no se traduce.
      const before = s((obj(m.before) ?? {}).region) ?? "—";
      const after = s((obj(m.after) ?? {}).region) ?? "—";
      return {
        summary: t("matchUpdateClub", {
          name: s(m.match_name) ?? t("someMatch"),
        }),
        detail: `${before} → ${after}`,
        link: matchLink(row.entity_id),
      };
    }

    case "match.update_min_shots": {
      const beforeRaw = (obj(m.before) ?? {}).min_shots;
      const afterRaw = (obj(m.after) ?? {}).min_shots;
      const before =
        typeof beforeRaw === "number" ? String(beforeRaw) : t("emptyValue");
      const after =
        typeof afterRaw === "number" ? String(afterRaw) : t("emptyValue");
      return {
        summary: t("matchUpdateMinShots", {
          name: s(m.match_name) ?? t("someMatch"),
        }),
        detail: `${before} → ${after}`,
        link: matchLink(row.entity_id),
      };
    }

    case "shooter.claim": {
      const matchName = s(m.match_name);
      return {
        summary: t("shooterClaim", {
          name: s(m.shooter_full_name) ?? t("someShooter"),
        }),
        detail: matchName
          ? t("shooterClaimFrom", { name: matchName })
          : undefined,
        link: matchLink(m.match_id),
      };
    }

    case "shooter.unclaim":
      return {
        summary: t("shooterUnclaim", {
          name: s(m.shooter_full_name) ?? t("unknownName"),
        }),
      };

    case "firearm.create":
      return {
        summary: t("firearmCreate", { name: s(m.name) ?? t("unknownName") }),
        detail: join([s(m.brand), s(m.model), s(m.caliber)]),
        link: firearmLink(row.entity_id),
      };

    case "firearm.update": {
      const after = obj(m.after) ?? {};
      return {
        summary: t("firearmUpdate", {
          name: s(after.name) ?? s(m.name) ?? t("unknownName"),
        }),
        detail: describeDiff(obj(m.before), after, t),
        link: firearmLink(row.entity_id),
      };
    }

    case "firearm.delete":
      return {
        summary: t("firearmDelete", { name: s(m.name) ?? t("unknownName") }),
        detail: join([s(m.brand), s(m.model), s(m.caliber)]),
      };

    case "match_firearm.set": {
      const after = obj(m.after) ?? {};
      const firearm = s(after.firearm_name) ?? t("someFirearm");
      const rounds = n(after.rounds_fired);
      const matchName = s(m.match_name);
      return {
        summary: matchName
          ? t("matchFirearmSet", { firearm, match: matchName })
          : t("matchFirearmSetNoMatch", { firearm }),
        detail: rounds != null ? t("roundCount", { count: rounds }) : undefined,
        link: matchLink(m.match_id),
      };
    }

    case "match_firearm.clear": {
      const matchName = s(m.match_name);
      return {
        summary: matchName
          ? t("matchFirearmClear", { match: matchName })
          : t("matchFirearmClearNoMatch"),
        link: matchLink(m.match_id),
      };
    }

    case "entry.update_absent": {
      const name = s(m.shooter_full_name) ?? t("someShooter");
      const matchName = s(m.match_name);
      const becameAbsent = (obj(m.after) ?? {}).is_absent === true;
      return {
        summary: becameAbsent
          ? t("entryMarkAbsent", { name })
          : t("entryUnmarkAbsent", { name }),
        detail: matchName ? t("entryInMatch", { name: matchName }) : undefined,
        link: matchLink(m.match_id),
      };
    }

    case "ammo.create": {
      const type = s(m.type);
      return {
        summary: t("ammoCreate", { name: s(m.name) ?? t("unknownName") }),
        detail: join([
          type === "reload" || type === "factory"
            ? t(type === "reload" ? "ammoTypeReload" : "ammoTypeFactory")
            : undefined,
          s(m.caliber),
          s(m.brand),
        ]),
        link: s(row.entity_id)
          ? { href: `/ammo/${row.entity_id}`, label: t("linkAmmo") }
          : undefined,
      };
    }

    case "ammo.update": {
      const after = obj(m.after) ?? {};
      return {
        summary: t("ammoUpdate", {
          name: s(after.name) ?? s(m.name) ?? t("unknownName"),
        }),
        detail: describeDiff(obj(m.before), after, t),
        link: s(row.entity_id)
          ? { href: `/ammo/${row.entity_id}`, label: t("linkAmmo") }
          : undefined,
      };
    }

    case "ammo.delete":
      return {
        summary: t("ammoDelete", { name: s(m.name) ?? t("unknownName") }),
        detail: join([s(m.type), s(m.caliber), s(m.brand)]),
      };

    case "firearm_usage.create": {
      const rounds = n(m.rounds_fired);
      return {
        summary: t("usageCreate", {
          name: s(m.firearm_name) ?? t("someFirearm"),
        }),
        detail: join([
          rounds != null ? t("roundCount", { count: rounds }) : undefined,
          s(m.used_on),
          s(m.ammunition_name),
        ]),
        link: firearmLink(m.firearm_id),
      };
    }

    case "firearm_usage.delete": {
      const rounds = n(m.rounds_fired);
      return {
        summary: t("usageDelete", {
          name: s(m.firearm_name) ?? t("someFirearm"),
        }),
        detail: join([
          rounds != null ? t("roundCount", { count: rounds }) : undefined,
          s(m.used_on),
        ]),
        link: firearmLink(m.firearm_id),
      };
    }

    default:
      return { summary: row.action };
  }
}

/**
 * Genera un detalle textual del diff entre dos snapshots, en formato
 * "campo: viejo → nuevo · campo2: viejo → nuevo". Solo lista los campos
 * que cambiaron.
 *
 * Los nombres de campo se traducen con `field.<columna>`, pero **solo los de
 * `DIFF_FIELD_KEYS`**. Una columna fuera de esa lista se muestra cruda.
 *
 * La lista explícita no es redundante con "traducir y ver si falla": pedirle
 * a next-intl una clave inexistente devuelve `<namespace>.<clave>` —o sea
 * `activityLog.field.foo`, no `field.foo`— y encima loguea un error. No hay
 * forma limpia de detectar el faltante desde acá, y el audit log es
 * histórico: tiene que poder renderizar filas viejas con snapshots de
 * columnas que ya no existen.
 */
const DIFF_FIELD_KEYS = new Set([
  // Armas (`getFirearmAuditSnapshot`)
  "name",
  "brand",
  "model",
  "caliber",
  "notes",
  // Municiones. El snapshot de ammo hace `select("*")`, así que cualquier
  // columna de `ammunition_types` puede aparecer en un diff — no alcanza con
  // las cuatro que se muestran en el detalle del alta.
  "type",
  "bullet_type",
  "bullet_weight_grains",
  "powder",
  "powder_charge_grains",
  "power_factor",
  "power_factor_measured",
]);

function describeDiff(
  before: Json | undefined,
  after: Json,
  t: AuditTranslator,
): string | undefined {
  if (!before) return undefined;
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const parts: string[] = [];
  for (const k of keys) {
    if (before[k] === after[k]) continue;
    const name = DIFF_FIELD_KEYS.has(k) ? t(`field.${k}`) : k;
    parts.push(`${name}: ${formatVal(before[k])} → ${formatVal(after[k])}`);
  }
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function formatVal(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string") return v.length > 0 ? `"${v}"` : "—";
  return String(v);
}
