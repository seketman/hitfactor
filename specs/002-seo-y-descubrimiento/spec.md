# Feature Specification: SEO y descubribilidad — Nivel 1 (indexación + previews)

**Feature Branch**: `002-seo-y-descubrimiento`

**Created**: 2026-05-29

**Status**: Draft

**Input**: User description: "Mejorar la exposición de HitFactor en la web para que sea encontrado rápidamente por buscadores y otras aplicaciones."

**Scope decision**: este spec cubre exclusivamente el **Nivel 1** (quick wins técnicos sobre la landing pública). Los Niveles 2 (landings por disciplina) y 3 (abrir `/matches/[id]` al público) se evaluarán en specs posteriores como decisiones de producto separadas.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — La landing es bien indexada por buscadores (Priority: P1)

Un tirador busca en Google *"app historial tiro deportivo argentina"* o *"tracker IPSC FBI"* y aparece HitFactor en los resultados con un **título claro** (*"HitFactor — Tu historial de tiro deportivo"*), una **descripción que explica qué hace la app** y el sitio se muestra como una página web bien estructurada. Al hacer click el visitante llega a la landing.

**Why this priority**: Sin esto, nadie llega vía búsqueda orgánica. Es la base de todo SEO — si esto no funciona, los demás esfuerzos son inútiles. Es la mínima entrega valiosa.

**Independent Test**: Verificable en tres pasos: (a) `view-source:` de la página renderea `<title>`, `<meta name="description">`, `<link rel="canonical">`, y `<script type="application/ld+json">` con datos correctos; (b) Lighthouse SEO score ≥ 95; (c) Google Search Console verifica el sitio y reporta la sitemap correctamente.

**Acceptance Scenarios**:

1. **Given** un crawler de Google visita `/`, **when** lee el HTML, **then** encuentra: `<title>HitFactor — Tu historial de tiro deportivo</title>`, `<meta name="description">` con texto descriptivo en español, `<html lang="es">`, `<link rel="canonical" href="https://hitfactor.app/">` (o el dominio real del proyecto), y un bloque JSON-LD con schema `WebApplication`.

2. **Given** el bot lee la sitemap, **when** descarga `/sitemap.xml`, **then** la sitemap incluye solo URLs públicas (`/`, `/login`, `/signup`) y NO incluye rutas autenticadas (`/dashboard`, `/matches/*`, `/firearms/*`, etc.).

3. **Given** un crawler lee `/robots.txt`, **when** lo procesa, **then** ve un `Disallow` explícito para todas las rutas autenticadas y de auth-transactional (`/auth/*`, `/q/*`).

4. **Given** el sitio se valida con Lighthouse (categoría SEO), **when** corre el audit, **then** el score es ≥ 95/100.

---

### User Story 2 — Compartir el link genera un preview rico (Priority: P2)

Un tirador comparte `https://hitfactor.app` en el WhatsApp de su club, en Slack, X o LinkedIn. En el chat aparece una **tarjeta con título, descripción y una imagen on-brand** (la diana ámbar del logo + el wordmark) en lugar de un link "pelado". El receptor entiende qué es HitFactor sin entrar.

**Why this priority**: El canal real de difusión de esta app es boca a boca dentro de la comunidad — WhatsApp de clubes, grupos de Facebook, foros de tiro. Si el preview no atrae, el link se pierde en el chat. Es el segundo lever más importante después de la indexación.

**Independent Test**: Verificable con tres validadores externos: (a) [opengraph.xyz](https://opengraph.xyz) muestra el preview correctamente; (b) la [Card Validator de X](https://cards-dev.twitter.com/validator) reconoce el tipo de card; (c) compartir el link en WhatsApp real muestra el preview con la imagen.

**Acceptance Scenarios**:

1. **Given** un cliente social (Facebook, WhatsApp, Slack) lee `/`, **when** parsea los meta tags, **then** encuentra: `og:title`, `og:description`, `og:url`, `og:image` (1200×630, on-brand), `og:type=website`, `og:locale=es_AR`, y los tags equivalentes `twitter:card=summary_large_image` con `twitter:image`.

2. **Given** la URL absoluta del OG image, **when** se accede, **then** devuelve un PNG de 1200×630 generado server-side por Next.js, con la marca HitFactor (diana ámbar + wordmark + tagline) visible. La imagen se ve consistente en dark/light de cualquier cliente.

3. **Given** un usuario comparte `https://hitfactor.app` en WhatsApp, **when** aparece el preview, **then** muestra título, descripción y la imagen — no un link pelado.

---

### User Story 3 — Infraestructura técnica de descubribilidad (Priority: P3)

El sitio expone los artefactos técnicos que crawlers, buscadores secundarios y agregadores esperan: `sitemap.xml`, `robots.txt`, `manifest.webmanifest`, íconos por device. Esto permite ser descubierto por Bing, DuckDuckGo, app catalogs y por "Agregar a pantalla de inicio" en iOS/Android.

**Why this priority**: Es plumbing necesario pero su impacto individual es menor que US1/US2. Son señales que múltiples consumidores procesan; conviene tenerlas pero ninguna sola mueve la aguja.

**Independent Test**: Verificable con `curl` desde la línea de comandos: cada uno de los archivos retorna 200 con el content-type correcto y contenido válido (XML, plain text, JSON respectivamente). La sitemap se puede submitear desde Search Console sin errores.

**Acceptance Scenarios**:

1. **Given** una request a `/robots.txt`, **when** se procesa, **then** retorna 200 con `Content-Type: text/plain` y contenido válido (`User-agent: *`, `Allow: /`, `Disallow:` específicos, `Sitemap:` apuntando a la URL absoluta de la sitemap).

2. **Given** una request a `/sitemap.xml`, **when** se procesa, **then** retorna 200 con `Content-Type: application/xml` y un sitemap XML válido (validado con [validator.w3.org/feed](https://validator.w3.org/feed)).

3. **Given** una request a `/manifest.webmanifest`, **when** se procesa, **then** retorna 200 con un manifest válido con `name`, `short_name`, `start_url`, `display: standalone`, `theme_color: #d97706`, `background_color`, `icons` apuntando a icons válidos.

4. **Given** un dispositivo iOS abre el sitio, **when** se busca el ícono para "Agregar a pantalla de inicio", **then** encuentra un Apple Touch Icon de 180×180.

### Edge Cases

- **Rutas auth-gated** (`/dashboard`, `/matches`, `/matches/[id]`, `/firearms`, `/ammo`, `/activity`, `/import`, `/about`): NO se incluyen en la sitemap y se Disallow-ean explícitamente en `robots.txt`. Si en el futuro se decide hacer `/matches/[id]` público (Nivel 3), eso será un spec aparte que actualice tanto las RLS como esta sitemap.
- **Rutas de auth transactional** (`/auth/callback`, `/auth/confirm`, `/auth/signout`): NO se indexan (son endpoints, no páginas). Disallow en `robots.txt` y `<meta name="robots" content="noindex">` si renderean HTML.
- **Ruta `/q/[code]`**: redirige, no es página de contenido. NO se indexa.
- **Dominio**: el spec usa `https://hitfactor.app` como placeholder. El dominio real se resuelve en `plan.md` desde una variable de entorno (típicamente `NEXT_PUBLIC_SITE_URL`). Si el dominio cambia, solo se actualiza esa variable.
- **Variantes de URL** (`http://` vs `https://`, con/sin `www`, con/sin trailing slash): la `<link rel="canonical">` apunta a la versión canónica única (`https://` sin `www`, sin trailing slash en `/`). Vercel ya hace el 301 por defecto.
- **OG image en local/preview**: la imagen se genera a partir del `NEXT_PUBLIC_SITE_URL`; en local apunta a `http://localhost:3000`. Aceptable — los crawlers reales solo procesan producción.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: La landing `/` DEBE exponer page-level `metadata` con `title`, `description`, `keywords` (opcional), `authors`, `openGraph`, `twitter`, `alternates.canonical`. Toda la prosa en **español rioplatense** (constitución Principio III).
- **FR-002**: La landing `/` DEBE incluir un bloque `<script type="application/ld+json">` con schema `WebApplication` declarando `name`, `description`, `url`, `applicationCategory`, `inLanguage: "es-AR"`, `offers.price: "0"` (es gratis), y `creator` (Seketman).
- **FR-003**: El `<html>` DEBE tener `lang="es"` (ya existe en `src/app/layout.tsx`, sólo verificar).
- **FR-004**: La landing `/` DEBE renderear `<link rel="canonical">` apuntando al `NEXT_PUBLIC_SITE_URL` + `/` (sin trailing slash adicional).
- **FR-005**: El proyecto DEBE exponer un endpoint generador de Open Graph image en `src/app/opengraph-image.tsx` que produzca un PNG 1200×630 con la marca (diana ámbar + wordmark + tagline). La imagen se genera al build/render time por Next.js, sin dependencias externas.
- **FR-006**: La landing `/` DEBE incluir Twitter Card (`twitter:card=summary_large_image`, `twitter:title`, `twitter:description`, `twitter:image`) referenciando la misma OG image.
- **FR-007**: El proyecto DEBE exponer `src/app/sitemap.ts` que genere `/sitemap.xml` con las URLs públicas: `/`, `/login`, `/signup`. Cada entrada con `lastModified`, `changeFrequency: "monthly"`, `priority` apropiado (1.0 para `/`, 0.5 para login/signup).
- **FR-008**: El proyecto DEBE exponer `src/app/robots.ts` que genere `/robots.txt` con `User-agent: *`, `Allow: /`, `Disallow: /dashboard, /matches, /firearms, /ammo, /activity, /import, /about, /auth/, /q/`, y `Sitemap:` apuntando a la URL absoluta.
- **FR-009**: El proyecto DEBE exponer `src/app/manifest.ts` que genere `/manifest.webmanifest` con `name: "HitFactor"`, `short_name: "HitFactor"`, `description`, `start_url: "/"`, `display: "standalone"`, `theme_color: "#d97706"` (el ámbar de la constitución), `background_color: "#fafaf9"` (el bg light), e `icons`.
- **FR-010**: El proyecto DEBE exponer `src/app/apple-icon.tsx` (o un asset estático) generando un Apple Touch Icon 180×180 con el motivo del logo.
- **FR-011**: Las rutas `/auth/callback`, `/auth/confirm`, `/auth/signout`, `/q/[code]` que renderean HTML transitorio DEBEN incluir `metadata: { robots: { index: false, follow: false } }` para que crawlers que pasen por accidente no los indexen.
- **FR-012**: La variable `NEXT_PUBLIC_SITE_URL` (nueva) DEBE existir y propagarse a todos los lugares donde se necesite URL absoluta (canonical, OG, sitemap, manifest, JSON-LD). Valor por defecto en local: `http://localhost:3000`; en producción: el dominio real.
- **FR-013**: Todo el copy expuesto a buscadores y previews DEBE respetar Principio III de la constitución (sin jerga, en español rioplatense). Específicamente: usar *"estadísticas"* (no *"stats"*), *"resultados"* (no *"performance"*), *"asociar a tu cuenta"* (no *"linkear"*).
- **FR-014**: La descripción NO DEBE prometer features que la app no entrega (constitución Principio VI). Específicamente: no decir *"te recomienda qué arma usar"* — la app NO recomienda, **muestra datos**.
- **FR-015**: El proyecto NO DEBE introducir dependencias externas nuevas. Toda funcionalidad usa primitivas nativas de Next.js 16 (`generateMetadata`, `MetadataRoute.Sitemap`, `MetadataRoute.Robots`, `MetadataRoute.Manifest`, `ImageResponse`).

### Key Entities

- **SiteMetadata** *(conceptual)*: el conjunto de `title`, `description`, `openGraph`, `twitter`, `canonical` y JSON-LD que se sirve por ruta. Vive como parte del `metadata` export de cada page o layout.
- **OG image**: imagen 1200×630 generada server-side por `next/og` a partir del logo. Sin assets externos.
- **`NEXT_PUBLIC_SITE_URL`**: variable de entorno que es la fuente de verdad para todas las URLs absolutas. Se documenta en `docs/development.md`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Lighthouse SEO score en `/` es **≥ 95/100** verificable en local con `npx lighthouse https://localhost:3000/ --only-categories=seo`.
- **SC-002**: [opengraph.xyz](https://opengraph.xyz) muestra preview completo (imagen + título + descripción) para la URL de producción.
- **SC-003**: Google Search Console verifica el sitio correctamente y la sitemap se procesa sin errores. *(Requiere acceso a Search Console — se hace manualmente como parte de la tarea de cierre.)*
- **SC-004**: `/robots.txt`, `/sitemap.xml` y `/manifest.webmanifest` retornan 200 con content-type correcto en producción (verificable con `curl -I`).
- **SC-005**: La OG image renderea consistentemente en preview de WhatsApp (verificación manual compartiendo la URL en un chat).
- **SC-006**: El bundle de la página `/` no aumenta más de **20 KB** netos por todos los cambios sumados (verificable con `npm run build` antes y después).

## Assumptions

- El dominio de producción ya está definido (Vercel asigna uno por defecto; si hay un dominio custom apuntando, mejor). El spec no decide el dominio — usa `NEXT_PUBLIC_SITE_URL`.
- Acceso a Google Search Console se hace **fuera** del flujo SDD (es una acción humana que requiere login del usuario). El spec contempla la verificación como tarea manual.
- El logo y la paleta ámbar existentes son la única identidad visual. No se diseña un nuevo logo para la OG image — se reutiliza la diana.
- Las landings por disciplina (Nivel 2) y la apertura de `/matches/[id]` al público (Nivel 3) son **fuera de alcance**. Si suben de prioridad, requieren spec propios (`003-...`, `004-...`).
- Los buscadores secundarios (Bing, DuckDuckGo, Yandex) se beneficiarán automáticamente de las mismas señales — no se hace optimización específica por motor.
