import { describe, expect, it } from "vitest";
import {
  areNamesSimilar,
  nameTokens,
  normalizeName,
} from "@/lib/import/match-claim";

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
