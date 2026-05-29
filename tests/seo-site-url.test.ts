import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { absoluteUrl, getSiteUrl } from "@/lib/seo/site-url";

const ORIGINAL = process.env.NEXT_PUBLIC_SITE_URL;

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete process.env.NEXT_PUBLIC_SITE_URL;
  } else {
    process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL;
  }
});

describe("getSiteUrl", () => {
  it("retorna el valor de NEXT_PUBLIC_SITE_URL cuando está definida", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://hitfactor.app";
    expect(getSiteUrl()).toBe("https://hitfactor.app");
  });

  it("hace fallback a http://localhost:3000 sin la var", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    expect(getSiteUrl()).toBe("http://localhost:3000");
  });

  it("hace fallback si la var está vacía o sólo espacios", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "   ";
    expect(getSiteUrl()).toBe("http://localhost:3000");
  });

  it("strip-ea el trailing slash", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://hitfactor.app/";
    expect(getSiteUrl()).toBe("https://hitfactor.app");
  });

  it("trim-ea espacios alrededor del valor", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "  https://hitfactor.app/  ";
    expect(getSiteUrl()).toBe("https://hitfactor.app");
  });
});

describe("absoluteUrl", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://hitfactor.app";
  });

  it("concatena el path relativo con un solo slash", () => {
    expect(absoluteUrl("/sitemap.xml")).toBe("https://hitfactor.app/sitemap.xml");
  });

  it("no produce doble slash si el path no empieza con /", () => {
    expect(absoluteUrl("sitemap.xml")).toBe("https://hitfactor.app/sitemap.xml");
  });

  it("la raíz devuelve el site URL con un slash final", () => {
    expect(absoluteUrl("/")).toBe("https://hitfactor.app/");
  });
});
