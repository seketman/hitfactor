import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guardrail sobre las policies de escritura (#195).
 *
 * `shooters_claim_self` (0001) se escribió así:
 *
 *   using       (auth.role() = 'authenticated')
 *   with check  (linked_user_id is null or linked_user_id = auth.uid())
 *
 * La confusión es fácil de cometer y difícil de ver leyendo: parece que el
 * `with check` protege, pero `using` decide **qué filas** entran al UPDATE y
 * `with check` sólo decide **cómo pueden quedar**. Con `using` en "cualquier
 * autenticado", todo usuario logueado podía editar cualquier fila de la tabla.
 *
 * El test exige que toda policy que otorgue UPDATE/DELETE (o `for all`) ate su
 * `using` a la identidad del que llama. No prueba que el predicado sea el
 * correcto —eso no lo puede saber un test de texto— pero sí que exista, que es
 * exactamente lo que faltaba.
 *
 * **Evalúa el estado final, no la historia.** Las migraciones son
 * append-only: `shooters_claim_self` y `match_entries_update_match_owner`
 * están definidas dos veces cada una (la original y su reemplazo posterior).
 * Gana la última en orden de migración, que es lo que efectivamente queda
 * en la base.
 *
 * Si una policy futura necesita legítimamente no referenciar `auth.uid()`
 * (algo como un `for all to service_role`), sumala a ALLOWLIST con el
 * porqué — la idea es que saltearlo sea una decisión consciente y visible
 * en el diff, no un descuido.
 */

const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");

/** Policies exentas, con la razón. Vacío hoy: ninguna lo necesita. */
const ALLOWLIST = new Set<string>();

/** Comandos que permiten escribir filas existentes. INSERT usa `with check`. */
const WRITE_COMMANDS = new Set(["all", "update", "delete"]);

interface Policy {
  name: string;
  table: string;
  command: string;
  /** Contenido del `using (...)`, o null si la policy no declara uno. */
  usingClause: string | null;
  /** Contenido del `with check (...)`, o null. */
  checkClause: string | null;
  /** Rol del `to <rol>`, o null si la policy no lo declara. */
  toRole: string | null;
  file: string;
}

/**
 * Devuelve el contenido del paréntesis que arranca en `openIndex`,
 * balanceando anidados. Las policies reales anidan `exists (select ...)`,
 * así que un regex no alcanza.
 */
function readBalanced(sql: string, openIndex: number): string {
  let depth = 0;
  for (let i = openIndex; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return sql.slice(openIndex + 1, i);
    }
  }
  return sql.slice(openIndex + 1);
}

function parsePolicies(sql: string, file: string): Policy[] {
  const out: Policy[] = [];
  const header =
    /create\s+policy\s+"([^"]+)"\s+on\s+([\w.]+)\s+for\s+(all|select|insert|update|delete)/gi;

  for (const m of sql.matchAll(header)) {
    const body = sql.slice(m.index! + m[0].length);
    // El cuerpo de la policy termina en el `;` de cierre.
    const end = body.indexOf(";");
    const scope = end === -1 ? body : body.slice(0, end);

    const usingMatch = /\busing\s*\(/i.exec(scope);
    const checkMatch = /\bwith\s+check\s*\(/i.exec(scope);
    out.push({
      name: m[1]!,
      table: m[2]!,
      command: m[3]!.toLowerCase(),
      usingClause: usingMatch
        ? readBalanced(scope, usingMatch.index + usingMatch[0].length - 1)
        : null,
      checkClause: checkMatch
        ? readBalanced(scope, checkMatch.index + checkMatch[0].length - 1)
        : null,
      toRole: /\bto\s+(authenticated|anon|service_role|public)\b/i
        .exec(scope)?.[1]
        ?.toLowerCase() ?? null,
      file,
    });
  }
  return out;
}

/**
 * Estado final de las policies: recorre las migraciones en orden y deja la
 * última definición de cada `tabla.policy`.
 */
function effectivePolicyMap(excludeFile?: string): Map<string, Policy> {
  const byKey = new Map<string, Policy>();

  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    if (file === excludeFile) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    for (const p of parsePolicies(sql, file)) {
      byKey.set(`${p.table}.${p.name}`, p);
    }
  }

  return byKey;
}

function effectivePolicies(): Policy[] {
  return [...effectivePolicyMap().values()];
}

describe("policies de escritura en supabase/migrations", () => {
  it("encuentra las policies (sanity check del parser)", () => {
    const all = effectivePolicies();
    // Si el parser se rompe, todos los tests de abajo pasan vacíos.
    expect(all.length).toBeGreaterThan(15);
    expect(all.map((p) => p.name)).toContain("shooters_claim_self");
  });

  it("toda policy de UPDATE/DELETE/ALL declara un `using`", () => {
    const missing = effectivePolicies()
      .filter((p) => WRITE_COMMANDS.has(p.command))
      .filter((p) => !ALLOWLIST.has(p.name))
      .filter((p) => p.usingClause === null)
      .map((p) => `${p.name} (${p.file})`);

    expect(
      missing,
      `Sin cláusula \`using\`, la policy no restringe qué filas se escriben: ${missing.join(", ")}.`,
    ).toEqual([]);
  });

  it("el `using` de UPDATE/DELETE/ALL se ata a la identidad del caller", () => {
    const unbound = effectivePolicies()
      .filter((p) => WRITE_COMMANDS.has(p.command))
      .filter((p) => !ALLOWLIST.has(p.name))
      .filter((p) => p.usingClause !== null)
      .filter((p) => !/auth\.uid\s*\(\s*\)/i.test(p.usingClause!))
      .map((p) => `${p.name} (${p.file})`);

    expect(
      unbound,
      `El \`using\` de estas policies no referencia auth.uid(), así que aplica a filas ajenas — ` +
        `es el bug de #195. Recordá que \`with check\` NO alcanza: filtra el estado final, ` +
        `no las filas de entrada. Policies: ${unbound.join(", ")}.`,
    ).toEqual([]);
  });

  it("shooters_claim_self quedó atada al dueño (regresión de #195)", () => {
    const policy = effectivePolicies().find(
      (p) => p.name === "shooters_claim_self",
    );

    expect(policy?.file).toBe("0021_fix_shooters_claim_rls.sql");
    // Tiene que poder tocar filas libres (para claimear) y las propias, nada más.
    expect(policy?.usingClause).toMatch(/linked_user_id\s+is\s+null/i);
    expect(policy?.usingClause).toMatch(/linked_user_id\s*=\s*\(?\s*select\s+auth\.uid/i);
  });
});

/**
 * Forma canónica de las policies actuales (#207).
 *
 * `auth.role()` está deprecado y se evalúa por fila; el `to` clause se
 * evalúa antes de mirar filas. `auth.uid()` sin envolver también se
 * reevalúa por fila — es el advisory `auth_rls_initplan` de Supabase.
 *
 * **Ojo con lo que esto NO significa.** `to authenticated` no excluye a
 * los usuarios anónimos: si se habilitan los anonymous sign-ins, esos
 * usuarios reciben el rol `authenticated` igual que los permanentes, así
 * que matchean el clause exactamente como matcheaban el predicado viejo.
 * Distinguirlos requiere el claim `is_anonymous` del JWT. Ver la nota en
 * `0023_rls_to_clause_and_initplan.sql`.
 */
describe("forma canónica de las policies", () => {
  it("ninguna policy usa auth.role(), que está deprecado", () => {
    const offenders = effectivePolicies()
      .filter((p) => /auth\.role\s*\(/i.test(`${p.usingClause ?? ""} ${p.checkClause ?? ""}`))
      .map((p) => `${p.name} (${p.file})`);

    expect(
      offenders,
      `Usá el clause \`to authenticated\` en vez del predicado: ${offenders.join(", ")}.`,
    ).toEqual([]);
  });

  it("toda policy declara a qué rol aplica", () => {
    const offenders = effectivePolicies()
      .filter((p) => p.toRole === null)
      .map((p) => `${p.name} (${p.file})`);

    expect(
      offenders,
      `Sin \`to <rol>\` la policy se evalúa para todos los roles, fila por fila: ${offenders.join(", ")}.`,
    ).toEqual([]);
  });

  it("auth.uid() siempre va envuelto en un subquery", () => {
    // `(select auth.uid())` deja que el planner lo suba a un InitPlan y lo
    // llame una vez, en lugar de una vez por fila.
    const bare = /(?<!\(\s*select\s+)auth\.uid\s*\(/i;
    const offenders = effectivePolicies()
      .filter((p) => {
        const body = `${p.usingClause ?? ""} ${p.checkClause ?? ""}`;
        return bare.test(body.replace(/\(\s*select\s+auth\.uid\s*\(\s*\)\s*\)/gi, "UID"));
      })
      .map((p) => `${p.name} (${p.file})`);

    expect(
      offenders,
      `Envolvelo: \`(select auth.uid())\`. Advisory auth_rls_initplan: ${offenders.join(", ")}.`,
    ).toEqual([]);
  });
});

/**
 * El seguro del rewrite masivo de la 0023.
 *
 * Reescribir 26 policies a mano es exactamente donde se cuela un predicado
 * mal transcripto — y el modo de falla es silencioso: la migración aplica
 * sin error y alguien queda viendo datos que no le corresponden, o el app
 * deja de escribir sin razón visible.
 *
 * Esto compara cada policy contra su definición anterior, normalizando
 * **sólo** las dos transformaciones que la 0023 dice hacer. Cualquier otra
 * diferencia es un error de transcripción.
 */
describe("0023 no cambió ningún predicado", () => {
  const MIGRATION = "0023_rls_to_clause_and_initplan.sql";

  /** Aplica las dos transformaciones declaradas y aplana el formato. */
  function normalize(clause: string | null): string | null {
    if (clause === null) return null;
    return clause
      .replace(/--[^\n]*/g, " ")
      .replace(/\(\s*select\s+(auth\.uid\s*\(\s*\))\s*\)/gi, "$1")
      .replace(/auth\.role\s*\(\s*\)\s*=\s*'authenticated'/gi, "true")
      .replace(/\s+/g, " ")
      .replace(/\(\s+/g, "(")
      .replace(/\s+\)/g, ")")
      .trim()
      .toLowerCase();
  }

  const before = effectivePolicyMap(MIGRATION);
  const after = effectivePolicyMap();

  const rewritten = [...after.values()].filter((p) => p.file === MIGRATION);

  it("reescribe las policies que se esperaba (sanity check)", () => {
    // Si el parser fallara, los tests de abajo compararían un set vacío.
    expect(rewritten.length).toBeGreaterThanOrEqual(20);
  });

  it("cada policy reescrita existía antes", () => {
    const invented = rewritten
      .filter((p) => !before.has(`${p.table}.${p.name}`))
      .map((p) => p.name);

    expect(
      invented,
      `La 0023 es un rewrite, no debería crear policies nuevas: ${invented.join(", ")}.`,
    ).toEqual([]);
  });

  it.each(
    // Un caso por policy, para que el error diga cuál falló.
    [...after.values()]
      .filter((p) => p.file === MIGRATION && before.has(`${p.table}.${p.name}`))
      .map((p) => [p.name, p] as const),
  )("%s conserva su predicado", (_name, policy) => {
    const old = before.get(`${policy.table}.${policy.name}`)!;

    expect(normalize(policy.usingClause)).toBe(normalize(old.usingClause));
    expect(normalize(policy.checkClause)).toBe(normalize(old.checkClause));
    expect(policy.command).toBe(old.command);
  });
});
