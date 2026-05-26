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

export function describeAuditEntry(row: AuditLogRow): AuditDescription {
  const m = (row.metadata ?? {}) as Json;

  switch (row.action) {
    case "match.import": {
      const matchName = s(m.match_name) ?? "match";
      const discipline = s(m.discipline_name);
      const entries = n(m.entries_count);
      const stages = n(m.stages_count);
      const detailParts: string[] = [];
      if (discipline) detailParts.push(discipline);
      if (entries != null) detailParts.push(`${entries} tiradores`);
      if (stages != null && stages > 0) detailParts.push(`${stages} stages`);
      return {
        summary: `Importaste el match "${matchName}"`,
        detail: detailParts.length > 0 ? detailParts.join(" · ") : undefined,
        link: row.entity_id
          ? { href: `/matches/${row.entity_id}`, label: "Ver match" }
          : undefined,
      };
    }

    case "match.delete":
      return {
        summary: `Eliminaste el match "${s(m.match_name) ?? "?"}"`,
        detail: s(m.match_date),
      };

    case "match.update_club": {
      const before = s((obj(m.before) ?? {}).region) ?? "—";
      const after = s((obj(m.after) ?? {}).region) ?? "—";
      return {
        summary: `Cambiaste el club de "${s(m.match_name) ?? "un match"}"`,
        detail: `${before} → ${after}`,
        link: row.entity_id
          ? { href: `/matches/${row.entity_id}`, label: "Ver match" }
          : undefined,
      };
    }

    case "shooter.claim": {
      const name = s(m.shooter_full_name) ?? "un tirador";
      const matchName = s(m.match_name);
      return {
        summary: `Asociaste a tu cuenta el tirador "${name}"`,
        detail: matchName ? `desde "${matchName}"` : undefined,
        link: s(m.match_id)
          ? { href: `/matches/${m.match_id}`, label: "Ver match" }
          : undefined,
      };
    }

    case "shooter.unclaim":
      return {
        summary: `Quitaste la asociación del tirador "${s(m.shooter_full_name) ?? "?"}"`,
      };

    case "firearm.create": {
      const name = s(m.name) ?? "?";
      const tags = [s(m.brand), s(m.model), s(m.caliber)].filter(
        (x): x is string => !!x,
      );
      return {
        summary: `Agregaste el arma "${name}"`,
        detail: tags.length > 0 ? tags.join(" · ") : undefined,
        link: row.entity_id
          ? { href: `/firearms/${row.entity_id}`, label: "Ver arma" }
          : undefined,
      };
    }

    case "firearm.update": {
      const after = obj(m.after) ?? {};
      return {
        summary: `Editaste el arma "${s(after.name) ?? s(m.name) ?? "?"}"`,
        detail: describeDiff(obj(m.before), after),
        link: row.entity_id
          ? { href: `/firearms/${row.entity_id}`, label: "Ver arma" }
          : undefined,
      };
    }

    case "firearm.delete":
      return {
        summary: `Borraste el arma "${s(m.name) ?? "?"}"`,
        detail: [s(m.brand), s(m.model), s(m.caliber)]
          .filter((x): x is string => !!x)
          .join(" · ") || undefined,
      };

    case "match_firearm.set": {
      const after = obj(m.after) ?? {};
      const firearmName = s(after.firearm_name) ?? "un arma";
      const rounds = n(after.rounds_fired);
      const matchName = s(m.match_name);
      return {
        summary: matchName
          ? `Asignaste "${firearmName}" a "${matchName}"`
          : `Asignaste "${firearmName}" a un match`,
        detail: rounds != null ? `${rounds} tiros` : undefined,
        link: s(m.match_id)
          ? { href: `/matches/${m.match_id}`, label: "Ver match" }
          : undefined,
      };
    }

    case "match_firearm.clear": {
      const matchName = s(m.match_name);
      return {
        summary: matchName
          ? `Quitaste el arma asignada a "${matchName}"`
          : `Quitaste el arma asignada a un match`,
        link: s(m.match_id)
          ? { href: `/matches/${m.match_id}`, label: "Ver match" }
          : undefined,
      };
    }

    case "entry.update_absent": {
      const shooterName = s(m.shooter_full_name) ?? "un tirador";
      const matchName = s(m.match_name);
      const after = obj(m.after) ?? {};
      const becameAbsent = after.is_absent === true;
      return {
        summary: becameAbsent
          ? `Marcaste como ausente a "${shooterName}"`
          : `Quitaste la marca de ausente a "${shooterName}"`,
        detail: matchName ? `en "${matchName}"` : undefined,
        link: s(m.match_id)
          ? { href: `/matches/${m.match_id}`, label: "Ver match" }
          : undefined,
      };
    }

    case "ammo.create": {
      const name = s(m.name) ?? "?";
      const tags = [
        s(m.type) === "reload" ? "recarga" : s(m.type) === "factory" ? "factory" : undefined,
        s(m.caliber),
        s(m.brand),
      ].filter((x): x is string => !!x);
      return {
        summary: `Agregaste el tipo de munición "${name}"`,
        detail: tags.length > 0 ? tags.join(" · ") : undefined,
        link: row.entity_id
          ? { href: `/ammo/${row.entity_id}`, label: "Ver munición" }
          : undefined,
      };
    }

    case "ammo.update": {
      const after = obj(m.after) ?? {};
      return {
        summary: `Editaste el tipo de munición "${s(after.name) ?? s(m.name) ?? "?"}"`,
        detail: describeDiff(obj(m.before), after),
        link: row.entity_id
          ? { href: `/ammo/${row.entity_id}`, label: "Ver munición" }
          : undefined,
      };
    }

    case "ammo.delete":
      return {
        summary: `Borraste el tipo de munición "${s(m.name) ?? "?"}"`,
        detail:
          [s(m.type), s(m.caliber), s(m.brand)]
            .filter((x): x is string => !!x)
            .join(" · ") || undefined,
      };

    default:
      return { summary: row.action };
  }
}

/**
 * Genera un detalle textual del diff entre dos snapshots, en formato
 * "campo: viejo → nuevo · campo2: viejo → nuevo". Solo lista los campos
 * que cambiaron.
 */
function describeDiff(before: Json | undefined, after: Json): string | undefined {
  if (!before) return undefined;
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const parts: string[] = [];
  for (const k of keys) {
    if (before[k] === after[k]) continue;
    const b = formatVal(before[k]);
    const a = formatVal(after[k]);
    parts.push(`${k}: ${b} → ${a}`);
  }
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function formatVal(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string") return v.length > 0 ? `"${v}"` : "—";
  return String(v);
}
