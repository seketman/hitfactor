import { describe, expect, it } from "vitest";
import {
  areNamesSimilar,
  buildClaimAliases,
  findClaimCandidates,
  isClaimCandidate,
  nameTokens,
  normalizeName,
} from "@/lib/import/match-claim";
import { FakeSupabase } from "./helpers/supabase-mock";

describe("normalizeName", () => {
  it("baja a minúsculas y saca puntuación", () => {
    expect(normalizeName("Demarziani, Diego")).toBe("demarziani diego");
  });

  it("colapsa espacios múltiples", () => {
    expect(normalizeName("FERRARO,  Martin   Miguel")).toBe(
      "ferraro martin miguel",
    );
  });

  it("ignora acentos", () => {
    expect(normalizeName("Pérez, José")).toBe("perez jose");
    expect(normalizeName("Núñez, Iván")).toBe("nunez ivan");
  });

  it("devuelve string vacío para input vacío", () => {
    expect(normalizeName("")).toBe("");
    expect(normalizeName("   ")).toBe("");
  });
});

describe("nameTokens", () => {
  it("devuelve tokens únicos", () => {
    expect([...nameTokens("Demarziani, Diego")]).toEqual([
      "demarziani",
      "diego",
    ]);
  });

  it("deduplica si hay tokens repetidos", () => {
    const t = nameTokens("Diego Diego");
    expect(t.size).toBe(1);
    expect(t.has("diego")).toBe(true);
  });
});

describe("areNamesSimilar", () => {
  it("matchea Apellido, Nombre vs Nombre Apellido", () => {
    expect(areNamesSimilar("Diego Demarziani", "Demarziani, Diego")).toBe(true);
    expect(areNamesSimilar("Demarziani, Diego", "Diego Demarziani")).toBe(true);
  });

  it("matchea con diferencias de mayúsculas y acentos", () => {
    expect(areNamesSimilar("PÉREZ, José", "jose perez")).toBe(true);
    expect(areNamesSimilar("Núñez, Iván", "Ivan Nuñez")).toBe(true);
  });

  it("matchea cuando un nombre es subset del otro (con segundo nombre)", () => {
    // Profile dice "Diego Demarziani", el shooter en PractiScore se anotó como "Demarziani, Diego Ezequiel"
    expect(
      areNamesSimilar("Diego Demarziani", "Demarziani, Diego Ezequiel"),
    ).toBe(true);
  });

  it("no matchea cuando solo coincide un token (apellido común)", () => {
    // Evita falso positivo: si el shooter solo dice "Demarziani" no le sugerimos
    expect(areNamesSimilar("Diego Demarziani", "Demarziani")).toBe(false);
    expect(areNamesSimilar("Demarziani", "Diego Demarziani")).toBe(false);
  });

  it("no matchea nombres distintos", () => {
    expect(areNamesSimilar("Diego Demarziani", "Lopez, Daniel")).toBe(false);
    expect(areNamesSimilar("Diego Demarziani", "Diego Maradona")).toBe(false);
  });

  it("no matchea cuando solo coincide el primer nombre", () => {
    expect(areNamesSimilar("Diego Demarziani", "Diego Lopez")).toBe(false);
  });

  it("no matchea si alguno está vacío", () => {
    expect(areNamesSimilar("", "Diego Demarziani")).toBe(false);
    expect(areNamesSimilar("Diego Demarziani", "")).toBe(false);
  });

  it("ignora signos de puntuación", () => {
    // Solo iniciales: no hay 2 tokens distintos válidos -> no matchea
    expect(areNamesSimilar("D. D.", "Demarziani, Diego")).toBe(false);
  });

  it("matchea con un segundo apellido en el shooter", () => {
    expect(
      areNamesSimilar("Martin Ferraro", "FERRARO, Martin Miguel"),
    ).toBe(true);
  });

  // Tolerancia a typos de 1 caracter (Levenshtein ≤ 1) en un solo token,
  // siempre que el resto matchee exacto. Cubre los typos típicos de carga
  // manual del torneo.
  it("tolera 1 caracter de diferencia en el apellido (Demarciani vs Demarziani)", () => {
    expect(
      areNamesSimilar("Diego Demarziani", "Demarciani, Diego"),
    ).toBe(true);
  });

  it("tolera 1 caracter insertado (Stoker vs Stocker)", () => {
    expect(
      areNamesSimilar("STOCKER, Oscar Alfredo", "Stoker Oscar"),
    ).toBe(true);
  });

  it("no fuzzy-matchea tokens cortos (< 4 caracteres)", () => {
    // "Ana" vs "Ane": 1 caracter de diferencia pero el token es muy corto;
    // sin el guard el matcher dispararía falsos positivos con nombres
    // comunes de 3 letras.
    expect(areNamesSimilar("Ana Lopez", "Ane Lopez")).toBe(false);
  });

  it("no permite 2 tokens con typos en la misma comparación", () => {
    // Si dos tokens difieren a la vez, probablemente sean dos personas
    // distintas. Solo toleramos UN typo por comparación.
    expect(
      areNamesSimilar("Dieg Demarciani", "Diego Demarziani"),
    ).toBe(false);
  });

  it("sigue rechazando nombres con apellido totalmente distinto", () => {
    // Garantía de regresión: el aflojamiento por typos no debe convertir
    // el matcher en algo permisivo en general.
    expect(
      areNamesSimilar("Diego Demarziani", "Diego Lopez"),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildClaimAliases — pure function
// ---------------------------------------------------------------------------

describe("buildClaimAliases", () => {
  it("colecta nombres del profile + shooters linkeados", () => {
    const aliases = buildClaimAliases(
      { display_name: "Diego", full_name: "Diego Demarziani", member_number: null },
      [
        { full_name: "Demarziani, Diego", member_number: null },
        { full_name: "Demarziani Diego", member_number: null },
      ],
    );
    expect(aliases.names).toEqual([
      "Diego",
      "Diego Demarziani",
      "Demarziani, Diego",
      "Demarziani Diego",
    ]);
  });

  it("ignora strings vacíos del profile", () => {
    const aliases = buildClaimAliases(
      { display_name: "Diego", full_name: null, member_number: null },
      [],
    );
    expect(aliases.names).toEqual(["Diego"]);
  });

  it("colecta member_numbers del profile + shooters", () => {
    const aliases = buildClaimAliases(
      { display_name: "X", full_name: null, member_number: "12345" },
      [
        { full_name: "X", member_number: "12345" }, // duplicado
        { full_name: "Y", member_number: "67890" },
      ],
    );
    expect([...aliases.memberNumbers].sort()).toEqual(["12345", "67890"]);
  });

  it("acepta profile null", () => {
    const aliases = buildClaimAliases(null, []);
    expect(aliases.names).toEqual([]);
    expect(aliases.memberNumbers.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// isClaimCandidate — pure function
// ---------------------------------------------------------------------------

describe("isClaimCandidate", () => {
  it("BOOTSTRAP: si los aliases no son útiles (1 token), devuelve true", () => {
    // Solo "Diego" (1 token) — areNamesSimilar rechazaría todo. Sin este
    // bypass, un usuario nuevo nunca podría hacer el primer claim manual.
    const aliases = buildClaimAliases(
      { display_name: "Diego" },
      [],
    );
    expect(
      isClaimCandidate({ full_name: "Pérez, José", member_number: null }, aliases),
    ).toBe(true);
  });

  it("BOOTSTRAP: aliases vacíos también devuelven true", () => {
    const aliases = buildClaimAliases(null, []);
    expect(
      isClaimCandidate({ full_name: "Cualquiera", member_number: null }, aliases),
    ).toBe(true);
  });

  it("FILTRO ESTRICTO: aliases con >=2 tokens activan el matching", () => {
    const aliases = buildClaimAliases(
      { display_name: "Diego", full_name: "Diego Demarziani" },
      [],
    );
    // Match razonable
    expect(
      isClaimCandidate({ full_name: "Demarziani, Diego", member_number: null }, aliases),
    ).toBe(true);
    // Match con shooter sin parentesco
    expect(
      isClaimCandidate({ full_name: "Pérez, José", member_number: null }, aliases),
    ).toBe(false);
  });

  it("ALIAS DE SHOOTER LINKEADO: usa nombres ya claimados como referencia", () => {
    // Profile pobre, pero hay un shooter ya linkeado con nombre completo.
    const aliases = buildClaimAliases(
      { display_name: "Diego" },
      [{ full_name: "Demarziani, Diego D.", member_number: null }],
    );
    // "Demarziani Diego" matchea contra "Demarziani, Diego D." (alias del linkeado)
    expect(
      isClaimCandidate({ full_name: "Demarziani Diego", member_number: null }, aliases),
    ).toBe(true);
    // Un nombre no relacionado sigue rechazado
    expect(
      isClaimCandidate({ full_name: "García, Juan", member_number: null }, aliases),
    ).toBe(false);
  });

  it("MEMBER NUMBER: match exacto siempre suma", () => {
    const aliases = buildClaimAliases(
      { display_name: "X", member_number: "12345" },
      [],
    );
    expect(
      isClaimCandidate({ full_name: "Apellido Distinto", member_number: "12345" }, aliases),
    ).toBe(true);
  });

  it("MEMBER NUMBER: number distinto no genera match por sí solo", () => {
    const aliases = buildClaimAliases(
      { display_name: "Diego", full_name: "Diego Demarziani", member_number: "12345" },
      [],
    );
    expect(
      isClaimCandidate({ full_name: "Pérez, José", member_number: "99999" }, aliases),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Integration tests con mock de Supabase — bug multi-identidad y aliases.
// ---------------------------------------------------------------------------

const USER_ID = "user-1";
const MATCH_ID = "match-1";

function setupFake() {
  const fake = new FakeSupabase();
  fake.seed("profiles", [
    {
      id: USER_ID,
      display_name: "Diego",
      full_name: "Diego Demarziani",
      member_number: null,
    },
  ]);
  return fake;
}

function seedEntry(
  fake: FakeSupabase,
  shooter: {
    id: string;
    full_name: string;
    member_number?: string | null;
    linked_user_id?: string | null;
  },
  divisionCode = "PIS",
) {
  fake.seed("match_entries", [
    {
      match_id: MATCH_ID,
      divisions: { code: divisionCode },
      shooters: {
        id: shooter.id,
        full_name: shooter.full_name,
        member_number: shooter.member_number ?? null,
        linked_user_id: shooter.linked_user_id ?? null,
      },
    },
  ]);
}

describe("findClaimCandidates", () => {
  it("sugiere claim cuando el nombre del shooter coincide con el profile", async () => {
    const fake = setupFake();
    seedEntry(fake, { id: "sh-1", full_name: "Demarziani Diego" });

    const result = await findClaimCandidates(fake.asClient(), USER_ID, MATCH_ID);
    expect(result).toHaveLength(1);
    expect(result[0]?.shooterId).toBe("sh-1");
    expect(result[0]?.reason).toBe("name");
  });

  it("sigue sugiriendo aunque el usuario ya tenga otros shooters linkeados (bug FBI)", async () => {
    const fake = setupFake();
    // El usuario ya claimó su identidad de PractiScore.
    fake.seed("shooters", [
      {
        id: "sh-ipsc",
        full_name: "Demarziani, Diego D.",
        member_number: null,
        linked_user_id: USER_ID,
      },
    ]);
    // Importa un torneo FBI donde aparece como "Demarziani Diego".
    seedEntry(fake, { id: "sh-fbi", full_name: "Demarziani Diego" });

    const result = await findClaimCandidates(fake.asClient(), USER_ID, MATCH_ID);
    expect(result).toHaveLength(1);
    expect(result[0]?.shooterId).toBe("sh-fbi");
  });

  it("usa nombres de shooters ya linkeados como aliases adicionales", async () => {
    const fake = new FakeSupabase();
    // Profile mínimo: solo un display_name corto que no matchea por sí solo.
    fake.seed("profiles", [
      {
        id: USER_ID,
        display_name: "Diego",
        full_name: null,
        member_number: null,
      },
    ]);
    // Pero ya tiene un shooter linkeado con el nombre completo.
    fake.seed("shooters", [
      {
        id: "sh-ipsc",
        full_name: "Demarziani, Diego D.",
        member_number: null,
        linked_user_id: USER_ID,
      },
    ]);
    // Y aparece en un nuevo torneo con otra variante.
    seedEntry(fake, { id: "sh-fbi", full_name: "Demarziani Diego" });

    const result = await findClaimCandidates(fake.asClient(), USER_ID, MATCH_ID);
    // El profile solo ("Diego", 1 token) no alcanzaría — pero el shooter
    // linkeado aporta los apellidos para matchear.
    expect(result).toHaveLength(1);
    expect(result[0]?.shooterId).toBe("sh-fbi");
  });

  it("no sugiere shooters ya claimados por otro usuario", async () => {
    const fake = setupFake();
    seedEntry(fake, {
      id: "sh-1",
      full_name: "Demarziani Diego",
      linked_user_id: "other-user",
    });

    const result = await findClaimCandidates(fake.asClient(), USER_ID, MATCH_ID);
    expect(result).toHaveLength(0);
  });

  it("matchea por número de socio aunque el nombre no se parezca", async () => {
    const fake = new FakeSupabase();
    fake.seed("profiles", [
      {
        id: USER_ID,
        display_name: "Foo",
        full_name: null,
        member_number: "12345",
      },
    ]);
    seedEntry(fake, {
      id: "sh-1",
      full_name: "Apellido Distinto",
      member_number: "12345",
    });

    const result = await findClaimCandidates(fake.asClient(), USER_ID, MATCH_ID);
    expect(result).toHaveLength(1);
    expect(result[0]?.reason).toBe("member_number");
  });

  it("devuelve vacío si el profile está vacío y no hay shooters linkeados", async () => {
    const fake = new FakeSupabase();
    fake.seed("profiles", [
      {
        id: USER_ID,
        display_name: null,
        full_name: null,
        member_number: null,
      },
    ]);
    seedEntry(fake, { id: "sh-1", full_name: "Demarziani Diego" });

    const result = await findClaimCandidates(fake.asClient(), USER_ID, MATCH_ID);
    expect(result).toHaveLength(0);
  });
});
