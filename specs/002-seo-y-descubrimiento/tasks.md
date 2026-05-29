---
description: "Tasks for: SEO y descubribilidad — Nivel 1"
---

# Tasks: SEO y descubribilidad — Nivel 1

**Input**: Design documents from `/specs/002-seo-y-descubrimiento/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md)

**Tests**: Incluidos para el helper `site-url.ts` (lógica de fallback testeable en aislamiento). Las metadata, sitemap, robots y manifest se validan con tooling externo (Lighthouse, opengraph.xyz, curl), no con unit tests — son contratos de Next con los crawlers, no lógica propia.

**Organization**: Tareas agrupadas por user story para implementación incremental.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Puede correr en paralelo (archivos distintos, sin dependencias).
- **[Story]**: A qué user story pertenece (US1, US2, US3).

## Path Conventions

Web app (Next.js App Router). Endpoints especiales bajo `src/app/`, lógica compartida bajo `src/lib/`, tests bajo `tests/`. Paths derivados del Project Structure de [plan.md](./plan.md).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Variable de entorno y helper compartido del que dependen todas las user stories. Bloquea US1/US2/US3.

- [X] **T001** [P] Documentar la nueva variable `NEXT_PUBLIC_SITE_URL` en `docs/development.md`:
  - Sección "Variables de entorno": agregar `NEXT_PUBLIC_SITE_URL` con descripción ("URL absoluta del sitio, usada para metadata SEO, canonical, sitemap, OG. Default en local: `http://localhost:3000`.").
  - Mencionar que en Vercel se setea por environment (Production / Preview / Development).

- [X] **T002** [P] Crear `tests/seo-site-url.test.ts`:
  - `getSiteUrl()` con `NEXT_PUBLIC_SITE_URL` definida → retorna ese valor (trimmed, sin trailing slash).
  - `getSiteUrl()` sin la var → retorna `http://localhost:3000`.
  - `getSiteUrl()` con valor con trailing slash → strip-ea el slash.
  - `absoluteUrl("/foo")` → retorna `${siteUrl}/foo` correctamente sin doble slash.

- [X] **T003** Implementar `src/lib/seo/site-url.ts`:
  - Export `getSiteUrl(): string` que lee `process.env.NEXT_PUBLIC_SITE_URL`, normaliza (trim, sin trailing slash), fallback a `http://localhost:3000`.
  - Export `absoluteUrl(path: string): string` que concatena el site URL con un path relativo, garantizando un solo `/`.
  - Verificar que T002 PASA.

- [ ] **T004** Setear `NEXT_PUBLIC_SITE_URL` en Vercel (Production + Preview) con el dominio real del proyecto. (Manual, fuera del PR. Documentar el valor en el PR description como nota a Diego.)

**Checkpoint**: Helper compartido listo, var documentada, var configurada en hosting. Las user stories pueden arrancar en paralelo.

---

## Phase 2: Foundational

**Purpose**: N/A — no hay migraciones ni cambios de infra compartida.

---

## Phase 3: User Story 1 — Indexación correcta de la landing (Priority: P1) 🎯 MVP

**Goal**: La landing `/` aparece bien indexada en Google con título, descripción y datos estructurados.

**Independent Test**: `view-source:` de `/` muestra `<title>`, `<meta name="description">`, `<link rel="canonical">`, `<html lang="es">`, y un `<script type="application/ld+json">` con schema `WebApplication`. Lighthouse SEO score ≥ 95.

### Implementation for User Story 1

- [X] **T005** [US1] Modificar `src/app/layout.tsx` para agregar `metadataBase` global:
  - `export const metadata: Metadata = { metadataBase: new URL(getSiteUrl()), ... }`
  - Esto hace que todos los `og:image` relativos se resuelvan a URLs absolutas automáticamente.
  - El `lang="es"` ya existe — verificar y dejar.

- [X] **T006** [US1] Modificar `src/app/page.tsx` (la landing) extendiendo el `metadata` export existente:
  - `title`: ya existe (`"HitFactor — Tu historial de tiro deportivo"`); verificar que el formato matchea FR-001.
  - `description`: ya existe; revisar que respete Principios III (sin jerga) y VI (sin promesas de recomendación).
  - Agregar `keywords` (opcional, low signal pero gratuito): *"tiro deportivo", "IPSC", "Tiro FBI", "Steel Challenge", "historial torneos", "Argentina"*.
  - Agregar `authors: [{ name: "Seketman" }]`.
  - Agregar `alternates: { canonical: "/" }` (Next resuelve absoluto via `metadataBase`).
  - Agregar `robots: { index: true, follow: true }` explícito.

- [X] **T007** [US1] Crear un componente `<JsonLd />` server-rendered (o inline) en `src/components/seo/JsonLd.tsx`:
  - Recibe un objeto JS, lo serializa con `JSON.stringify`, lo renderea dentro de `<script type="application/ld+json">`.
  - Cuidado con XSS: no inyectar input del usuario; solo objetos definidos en código.

- [X] **T008** [US1] En `src/app/page.tsx`, incluir `<JsonLd />` con schema `WebApplication`:
  ```ts
  {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    "name": "HitFactor",
    "url": getSiteUrl(),
    "description": "<misma que metadata.description>",
    "applicationCategory": "SportsApplication",
    "inLanguage": "es-AR",
    "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" },
    "creator": { "@type": "Person", "name": "Seketman" }
  }
  ```

- [X] **T009** [US1] **Validación**: correr `npm run build` + `npm start` localmente, abrir `http://localhost:3000/`, `view-source:` y verificar manualmente que están todos los tags. Correr Lighthouse en la categoría SEO:
  ```bash
  npx --yes lighthouse http://localhost:3000/ --only-categories=seo --quiet --chrome-flags="--headless"
  ```
  Score esperado: ≥ 95.

**Checkpoint**: La landing está bien indexable. Si solo entregamos US1, ya hay valor mensurable (Lighthouse pasa, Google puede crawl-ear correctamente).

---

## Phase 4: User Story 2 — Previews ricos al compartir el link (Priority: P2)

**Goal**: Compartir el link genera tarjeta con imagen, título y descripción en WhatsApp, X, Slack, LinkedIn.

**Independent Test**: [opengraph.xyz](https://opengraph.xyz) renderea preview completo. Compartir en un WhatsApp real muestra la tarjeta con imagen.

### Implementation for User Story 2

- [X] **T010** [US2] Crear `src/app/opengraph-image.tsx`:
  - Usar `ImageResponse` de `next/og`.
  - Tamaño: 1200×630.
  - Contenido: fondo (degradé sutil del bg al surface en dark, idem en light), diana ámbar centrada (motivo del logo), wordmark "HitFactor" en Geist Sans bold, tagline *"Tu historial de tiro deportivo"*.
  - Usar la paleta de la constitución (ámbar `#d97706` para el accent).
  - Export `runtime = "nodejs"` o `"edge"` según lo que el resto del proyecto use.

- [X] **T011** [US2] Modificar el `metadata` export de `src/app/page.tsx` agregando `openGraph` y `twitter`:
  ```ts
  openGraph: {
    title: "HitFactor — Tu historial de tiro deportivo",
    description: "<misma description>",
    url: "/",  // resuelta absoluta vía metadataBase
    siteName: "HitFactor",
    locale: "es_AR",
    type: "website",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "HitFactor" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "HitFactor — Tu historial de tiro deportivo",
    description: "<misma description>",
    images: ["/opengraph-image"],
  },
  ```

- [ ] **T012** [US2] **Validación con opengraph.xyz**: deployar a Vercel preview (PR auto-deploys), pegar la URL preview en [opengraph.xyz](https://opengraph.xyz), verificar que muestra título + descripción + imagen.

- [ ] **T013** [US2] **Smoke manual**: compartir la URL preview en un WhatsApp real (al propio número personal). Verificar que aparece la tarjeta con imagen, no un link pelado.

**Checkpoint**: US1 + US2 funcionando. La feature es entregable.

---

## Phase 5: User Story 3 — Infraestructura técnica de descubribilidad (Priority: P3)

**Goal**: Sitemap, robots, manifest, apple touch icon. Las señales que los crawlers, app stores informales y "Agregar a pantalla de inicio" esperan.

**Independent Test**: `curl -I https://<site>/{robots.txt,sitemap.xml,manifest.webmanifest,apple-icon}` retorna 200 con content-type correcto.

### Implementation for User Story 3

- [X] **T014** [P] [US3] Crear `src/app/robots.ts`:
  ```ts
  import type { MetadataRoute } from "next";
  import { absoluteUrl } from "@/lib/seo/site-url";

  export default function robots(): MetadataRoute.Robots {
    return {
      rules: [{
        userAgent: "*",
        allow: ["/", "/login", "/signup"],
        disallow: ["/dashboard", "/matches", "/firearms", "/ammo",
                   "/activity", "/import", "/about", "/auth/", "/q/"],
      }],
      sitemap: absoluteUrl("/sitemap.xml"),
    };
  }
  ```

- [X] **T015** [P] [US3] Crear `src/app/sitemap.ts`:
  ```ts
  import type { MetadataRoute } from "next";
  import { absoluteUrl } from "@/lib/seo/site-url";

  export default function sitemap(): MetadataRoute.Sitemap {
    const now = new Date();
    return [
      { url: absoluteUrl("/"), lastModified: now, changeFrequency: "monthly", priority: 1.0 },
      { url: absoluteUrl("/login"), lastModified: now, changeFrequency: "monthly", priority: 0.5 },
      { url: absoluteUrl("/signup"), lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    ];
  }
  ```

- [X] **T016** [P] [US3] Crear `src/app/manifest.ts`:
  ```ts
  import type { MetadataRoute } from "next";

  export default function manifest(): MetadataRoute.Manifest {
    return {
      name: "HitFactor",
      short_name: "HitFactor",
      description: "Tu historial de tiro deportivo, en un solo lugar.",
      start_url: "/",
      display: "standalone",
      background_color: "#fafaf9",
      theme_color: "#d97706",
      icons: [
        { src: "/icon.svg", type: "image/svg+xml", sizes: "any" },
        { src: "/apple-icon", type: "image/png", sizes: "180x180" },
      ],
    };
  }
  ```

- [X] **T017** [P] [US3] Crear `src/app/apple-icon.tsx` usando `ImageResponse`:
  - Tamaño 180×180.
  - Misma diana ámbar del logo (sin wordmark).
  - Fondo `#0c0c10` (consistente con `src/app/icon.svg` actual).

- [X] **T018** [US3] Agregar `metadata.robots: { index: false, follow: false }` en las páginas que renderean HTML transitorio si aplican. Verificar el catálogo:
  - `/auth/callback/route.ts` → route handler, NO renderea → no aplica.
  - `/auth/confirm/route.ts` → route handler, NO renderea → no aplica.
  - `/auth/signout/route.ts` → route handler, NO renderea → no aplica.
  - `/q/[code]/route.ts` → route handler, NO renderea → no aplica.
  - Si en el futuro alguno empieza a renderear HTML transitorio, agregar `noindex` ahí.

- [X] **T019** [US3] **Validación con curl**:
  ```bash
  curl -I https://<site>/robots.txt
  curl -I https://<site>/sitemap.xml
  curl -I https://<site>/manifest.webmanifest
  curl https://<site>/sitemap.xml | head
  ```
  Los tres retornan 200 con `Content-Type` correcto. La sitemap XML es válida.

**Checkpoint**: Las tres user stories completas. La feature está lista.

---

## Phase N: Polish & Cross-Cutting

**Purpose**: Verificación final y submit a buscadores.

- [X] **T020** Medir bundle size delta:
  ```bash
  npm run build  # antes
  # ... aplicar cambios ...
  npm run build  # después
  # comparar tamaño de `.next/static/chunks/app/page-*.js`
  ```
  El delta total no debe exceder 20 KB netos (SC-006).

- [ ] **T021** **Submit a Google Search Console** (manual, fuera del PR):
  - Agregar la propiedad (dominio o URL prefix).
  - Verificar la propiedad (vía DNS si dominio custom, o vía meta tag si URL prefix — usar el meta tag en el `metadata` de `layout.tsx` si hace falta).
  - Submitear la sitemap (`/sitemap.xml`).

- [ ] **T022** **Submit a Bing Webmaster Tools** (manual, fuera del PR):
  - Bing tiene un import directo desde Search Console — usarlo si está disponible para ahorrar pasos.

- [X] **T023** **Code review focalizado** en Principios III y VI de la constitución:
  - Toda prosa expuesta a buscadores (description, keywords, OG title/description, manifest description) usa español plano.
  - Ninguna descripción promete recomendación / coaching.

- [X] **T024** Correr `npm test` completo — todos los tests existentes deben seguir pasando + el nuevo `seo-site-url.test.ts` pasa.

- [X] **T025** Correr `npm run build` y verificar 0 errores de TypeScript.

- [ ] **T026** Verificar Conventional Commits en cada commit (`feat(seo): ...`, `feat(metadata): ...`, `chore(env): ...`).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: Bloquea TODO. T001/T002/T003 deben completarse antes de cualquier US.
- **Phase 2 (Foundational)**: Vacía.
- **Phase 3 (US1)**: Depende de Setup (T003 helper).
- **Phase 4 (US2)**: Depende de Setup. Puede ir en paralelo a US1 (otros archivos).
- **Phase 5 (US3)**: Depende de Setup (T003). Tareas internas T014–T017 son archivos distintos → paralelas. T018 secuencial al final.
- **Phase N (Polish)**: Después de US1+US2+US3.

### Parallel Opportunities

- T001 y T002 son archivos distintos → paralelas.
- T014/T015/T016/T017 son archivos distintos → paralelas dentro de US3.
- US1 y US2 pueden ir en paralelo (devs distintos).
- T021/T022 (submits manuales) corren cuando el deploy esté arriba; no bloquean code.

---

## Implementation Strategy

### MVP First

1. Phase 1 (Setup): T001–T004.
2. Phase 3 (US1): T005–T009. **Validar con Lighthouse en local.**
3. Stop, evaluar si se necesita más antes de merge.

### Incremental Delivery

1. **US1** → indexación. Mensurable con Lighthouse y Search Console.
2. **US2** → previews ricos. Mensurable con opengraph.xyz y smoke en WhatsApp.
3. **US3** → infraestructura completa. Mensurable con `curl`.

Cada user story tiene valor independiente: si solo entregamos US1 el sitio ya queda bien indexable. US2 multiplica la difusión virally. US3 cierra los huecos.

---

## Notes

- [P] = archivos distintos, sin dependencias.
- [Story] = traceability al user story de [spec.md](./spec.md).
- La feature **no toca DB ni RLS** — es puramente metadata + endpoints especiales de Next.
- Sin nuevas dependencias externas (FR-015).
- Commit Conventional + `feat(seo)`, `chore(env)` según corresponda.
- Code review final aplica Principios III y VI de la constitución (`.specify/memory/constitution.md`).
