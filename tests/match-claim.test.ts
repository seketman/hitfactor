import { describe, expect, it } from "vitest";
import {
  areNamesSimilar,
  findClaimCandidates,
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
