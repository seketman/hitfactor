# HitFactor — System Overview

Snapshot del sistema HitFactor al 2026-06-18 (post-migración 0017). Este documento documenta el **estado actual** del sistema, no aspiraciones de producto.

**Lectores típicos**:

- **Desarrollador / agente** que va a sumar una feature: lee §1–§3 para conocer dónde aterrizar (mapa de la app, recorridos típicos); §4–§9 para conocer la implementación existente (stack, arquitectura, modelo de datos, reglas).
- **Code reviewer**: salta a §6 (Modelo de datos) y §7 (Reglas de negocio) para entender invariantes.
- **Producto**: §1 (Decisiones), §2 (Navegación) y §3 (Recorridos).

**Documentos relacionados**:

- `.specify/memory/constitution.md` — principios no negociables que toda feature respeta.
- `docs/glossary.md` — términos del dominio (tirador, match, claim, hit factor, etc.).
- `specs/` — features en curso, una carpeta por feature.

---

## 1. Decisiones que la app habilita


La app no le dice al tirador qué hacer, pero le da los datos para responder estas preguntas. Para cada una, indicamos la pantalla y la métrica/dato (definiciones técnicas en §7.3 — Estadísticas — y §7.4 a §7.5 — Armas y Munición):

| Pregunta del tirador | Pantalla | Métrica / dato |
|---|---|---|
| ¿Estoy mejorando en esta disciplina? | `/dashboard/[discipline]` | `trajectorySlope` + chart *Evolución del %* |
| ¿Soy consistente o tengo días buenos y días malos? | `/dashboard` | `consistency` (stddev del Match %) + tag *sólido / normal / volátil* |
| ¿Cómo me fue en mi mejor torneo? | `/dashboard` | `bestPercentage` / `bestPlace` / `bestHits` con link al match |
| ¿En qué disciplina o división me destaco más? | `/dashboard` consolidado | `byDiscipline` / `byDivision` + `topDiscipline` / `topDivision` |
| ¿Dónde estoy parado contra mi división? | `/dashboard/[discipline]` | `avgPercentile` y `bestPercentile` (más bajo = mejor) |
| ¿Cómo me fue stage por stage en este match? | `/matches/[id]/me` | tabla de `stage_results` |
| ¿Mis penalties son altos o bajos para mi nivel? | `/dashboard/[discipline]` | `penaltyRate` con etiqueta *bajo / normal / alto* |
| ¿Vengo tirando seguido o estoy oxidado? | `/dashboard` | `cadence` (matches/mes) + `daysSinceLastMatch` |
| ¿Con qué arma vengo tirando y cuántos disparos llevo? | `/firearms/[id]` | `totalRounds`, `totalMatches`, `totalSessions`, `lastUsedDate` |
| ¿Estoy gastando más munición de la que debería? | `/dashboard/[discipline]` (FBI) o `/firearms` | `ammoEfficiency` + tier *perfect / neutral / warning / danger* |
| ¿Qué munición uso más y desde cuándo? | `/ammo/[id]` | `totalMatches`, `totalRounds`, `lastUsedDate` por tipo |
| ¿Qué fue lo último que hice (cambié, importé, asocié)? | `/activity` | audit log con narrativa legible (`describeAuditEntry`) |
| ¿Quiénes participaron del match X? | `/matches/[id]` | tabla pública del match |
| ¿Soy yo este nombre en este match? | `/matches/[id]` | botón *Soy yo* sobre cada fila no claimada |

Lo que **no** decimos explícitamente (por Principio VI de la constitución):

- *"Usá esta arma para este match"* (la decisión es del tirador, dependiente de variables que la app no conoce — clima, gusto del día, mantenimiento reciente).
- *"Estás mal, deberías hacer Y"* (la app expone síntomas, no diagnósticos).
- *"Tirá más seguido / menos seguido"* (la cadencia es un dato, no un juicio).


---

## 2. Mapa de navegación


**Rutas públicas** (sin sesión):

| Ruta | Propósito |
|---|---|
| `/` | **Landing**. Presenta la app, sus disciplinas y la biblioteca compartida. CTA principal: *Crear cuenta gratis*. |
| `/login` | Iniciar sesión (email/password + Google OAuth). Una sola tarea por pantalla. |
| `/signup` | Crear cuenta. Después del submit redirige a `/login` con instrucción de revisar el mail. |
| `/auth/confirm` | Endpoint del link en el email — verifica el OTP y crea sesión. |
| `/auth/callback` | Endpoint del PKCE de Google — intercambia code por sesión. |
| `/auth/signout` | POST para cerrar sesión y volver a `/login`. |
| `/q/[code]` | QR físico de un arma — resuelve el código corto y redirige (con `requireUser` + `returnTo`) a `/firearms/[id]`. |

**Rutas autenticadas** (bajo `(app)/layout.tsx`, con sidebar):

| Ruta | Propósito | Qué se ve |
|---|---|---|
| `/dashboard` | **Vista consolidada** — quién soy en todas las disciplinas juntas. | Saludo + KPIs cross-disciplina + historial completo + chart de evolución. |
| `/dashboard/[discipline]` | **Vista filtrada** por una disciplina específica. | Mismo layout que el consolidado pero recortado a una disciplina; la *primary metric* cambia entre `percentage` y `hits` según la disciplina. |
| `/matches` | **Biblioteca compartida** — todos los matches importados por toda la comunidad. | Listado paginado + filtros por club; subtítulo explica que se trata de un recurso compartido. |
| `/matches/[id]` | Detalle público del match — ranking completo por división. | Tabla con todos los tiradores; botón *Soy yo* en cada fila no claimada (filtrado por `isClaimCandidate`). |
| `/matches/[id]/me` | **Mi participación** en este match. | KPIs del match + resultados stage por stage + arma usada + munición. |
| `/firearms` | Catálogo del usuario. | Lista de armas con `totalRounds` y `lastUsedDate`; CTA *Agregar arma*. |
| `/firearms/[id]` | Detalle de un arma. | Datos + historial de uso (matches + sesiones manuales) + QR imprimible. |
| `/ammo` | Catálogo de tipos de munición. | Lista con `totalRounds` por tipo. |
| `/ammo/[id]` | Detalle de un tipo de munición + historial cross-arma. | Datos + en qué matches y con qué armas se usó. |
| `/import` | **Subir una planilla**. | Form de upload + nota sobre biblioteca compartida + panel de candidatos a *Soy yo* post-import. |
| `/activity` | **Mis acciones**. | Audit log paginado con narrativa legible (no IDs). |
| `/about` | Sobre HitFactor + feedback. | Créditos a Seketman + estado de los reportes propios + form (gate ≥ 3 entries). |

**El sidebar** (`AppSidebarShell`) está ordenado para reflejar la frecuencia de uso real:

1. **Disciplinas del usuario** — las que tiene `match_entries`, primer nivel para acceso rápido.
2. **Consolidado** — vista unificada cuando hay varias disciplinas.
3. **Matches** — la biblioteca compartida.
4. **Armas** y **Munición** — catálogos privados.
5. **Actividad** — log.
6. **Acerca de** + cerrar sesión.

Esa jerarquía implementa el principio de *"estadísticas primero, mantenimiento después"*: el tirador entra a ver cómo le fue, no a agregar metadata.


---

## 3. Recorridos típicos


Estos son los flujos que respaldan las decisiones de IA y de copy. Cada uno se diseña para tener **fricción mínima en el camino feliz** y **estados intermedios claros** si algo falla.

#### Journey A — Primer uso (tirador nuevo)

1. Visita `/` por recomendación de un amigo del club.
2. Lee qué hace la app, ve la maqueta del dashboard en el hero. Click en *Crear cuenta gratis*.
3. Llena email + contraseña + nombre. Submit.
4. Ve *"Te enviamos un email a X con un link de confirmación"*.
5. Click en el link del mail → `/auth/confirm?token_hash=...&type=signup` → sesión creada → redirige a `/dashboard`.
6. `/dashboard` sin claims redirige a `/matches`, donde aparece la card *Sugerencias de claim* si su nombre matchea aliases.
7. Encuentra su nombre, click en **Soy yo**. Si no aparece sugerido, busca el match manualmente y se marca ahí.
8. Vuelve a `/dashboard` — ya ve sus KPIs.

Decisiones de diseño asociadas:

- El redirect de `/dashboard` → `/matches` cuando no hay claims es deliberado: en vez de mostrar un dashboard vacío con *"no hay data"*, lo lleva a la acción que destrabar todo (asociarse a una participación).
- El bootstrap de `isClaimCandidate` (todos son candidatos si los aliases del usuario son pobres) habilita el primer claim manual sin generar sugerencias falsas.

#### Journey B — Acabo de tirar un match

1. Llega del polígono. Abre la app.
2. Va a `/matches`. Busca el torneo de hoy. Si ya alguien lo importó, lo abre y se asocia.
3. Si no está, va a `/import`, sube la planilla (PDF/HTML/CSV según el origen).
4. Post-import, la pantalla muestra *"Importado: X"* + card de candidatos a *Soy yo*.
5. Marca *Soy yo*, va a `/matches/[id]/me` y revisa cómo le fue stage por stage.
6. (Opcional) Va a `/firearms/[id]` o `/ammo/[id]` para confirmar/ajustar el arma y la munición usadas en este match.

Decisiones asociadas:

- La nota *"Si el match ya lo cargó otra persona, no hace falta volver a subirlo"* arriba del form de import evita uploads duplicados que generan `MATCH_ALREADY_EXISTS`.
- El re-upload por el mismo usuario es idempotente (UPSERT), así que si el usuario sube dos veces el mismo archivo, no rompe — el segundo solo confirma lo que ya estaba.

#### Journey C — Quiero saber cómo vengo

1. Entra a `/dashboard/[discipline]` de su disciplina principal.
2. Mira `Promedio %`, `Mejor %`, `Tendencia`, `Consistencia`. La etiqueta (*sólido* / *normal* / *volátil*) le da una lectura rápida sin tener que interpretar el número.
3. Si la `Tendencia` muestra `+1.2% por torneo` con `TrendingUp` verde, sabe que viene mejorando.
4. Mira `Tasa de penalties` para ver si está siendo prudente o agresivo.
5. Mira `byDivision` para ver si una división le sale mejor que otra.
6. Mira `Evolución del %` (chart) para ver visualmente el arco del año.

Decisiones asociadas:

- Cada KPI tiene una *hint* debajo con contexto (`sobre 19 torneos`, `mejor: top 12% (15/03/26)`) — el número solo no alcanza.
- Las cards son clicables a los matches específicos cuando aplica (ej. el `bestPlace` linkea al match donde sucedió).

#### Journey D — Quiero decidir con qué arma ir al próximo match

1. Entra a `/firearms`. Ve la lista con `totalRounds` y `lastUsedDate` de cada una.
2. Entra al detalle de cada candidata (`/firearms/[id]`). Ve su historial — qué matches, qué disciplinas, qué munición.
3. Cruza mentalmente con el detalle del match en `/matches/[id]/me` para ver cómo le fue cuando usó esa arma en torneos similares.

Decisiones asociadas:

- La app **no** muestra explícitamente *"rendimiento por arma"* — eso requeriría un cruce de tablas que el código actual no expone. La inferencia queda en manos del usuario (Principio VI de la constitución).
- Sí muestra el QR code de cada arma — útil para identificarla físicamente con un sticker.

#### Journey E — Reviso si lo que hice quedó bien

1. Entra a `/activity`.
2. Ve la última fila: *Asignaste "Glock 17" a "Social Domingo" · 45 tiros*.
3. Confirma que coincide con lo que esperaba.
4. Si algo está mal, va al recurso (link en la fila del audit) y lo corrige.

Decisiones asociadas:

- El render del audit log usa segunda persona (*"Importaste"*, *"Asociaste"*, *"Quitaste"*) y resuelve IDs a nombres en el momento del log — para que el activity sea legible años después.
- Cada fila linka al recurso afectado cuando aplica; la corrección está a un click.


---

## 4. Stack tecnológico

### 4.1 Frontend

- **Next.js 16.2.6** con **App Router** y **React Server Components** por defecto; `"use client"` solo cuando hace falta interactividad (formularios con estado local, sidebar drawer, theme switcher). Server Actions habilitadas con `bodySizeLimit: "10mb"` (override del default de 1 MB) en `next.config.ts` para soportar PDFs de WinMSS/ESS con muchas divisiones.
- **React 19.2.6** + **react-dom 19.2.6**.
- **Tailwind CSS v4** integrado vía PostCSS con el plugin `@tailwindcss/postcss`. Sin `tailwind.config.{ts,js}`: la configuración vive dentro de `src/app/globals.css` con `@import "tailwindcss"`, `@custom-variant dark (...)` y un bloque `@theme inline { ... }` que mapea los tokens CSS a utilidades (`bg-bg`, `text-fg`, `text-accent`, etc.).
- **Tipografía**: **Geist Sans** y **Geist Mono** cargadas con `next/font/google` en `src/app/layout.tsx`, expuestas como CSS vars `--font-sans` / `--font-mono`.
- **Tema claro / oscuro / sistema**: `next-themes` envuelto en `src/components/providers/ThemeProvider.tsx`, montado en el root layout. La clase `.dark` se setea sobre `<html>`; `suppressHydrationWarning` evita el warning de hidratación.
- **Iconos**: `lucide-react`.
- **Utilidades de clases**: `clsx` + `tailwind-merge` combinados en el helper `cn()` de `src/lib/utils.ts`.
- **QR**: `qrcode` para generar los stickers cortos de armas.

### 4.2 Backend / datos

- **Supabase** gestionado:
  - `@supabase/ssr` para los clientes server/browser/middleware.
  - `@supabase/supabase-js` como SDK base.
- **Postgres** en Supabase, con **RLS activa** en todas las tablas. La app nunca usa la service role key — todo el acceso a datos pasa por la sesión del usuario y `auth.uid()`.
- **RPC** (funciones SQL custom invocadas con `supabase.rpc(...)`):
  - `my_discipline_counts(p_user_id uuid)` — usada en el sidebar para los conteos por disciplina del usuario.
  - `resolve_firearm_qr_code(p_code text)` — usada en la ruta pública `/q/[code]` para resolver QRs cortos.
- **Auth** (Supabase Auth):
  - Email + password con confirmación de email obligatoria.
  - **Google OAuth** con flujo PKCE.
  - Cookies de sesión gestionadas por `@supabase/ssr`.
- **Storage**: no se usa Supabase Storage por el momento.
- **Tipos generados**: script `db:types` en `package.json` que invoca `supabase gen types typescript` con el `project-id` hardcodeado (`igsfjdhtaxsxcnxaopxu`). El alias `TypedSupabaseClient` (`src/lib/supabase/types.ts`) propaga la tipificación a todas las funciones de `src/lib/db/*`.

### 4.3 Server Actions

- Archivos `actions.ts` con la directiva `"use server"` ubicados junto a la ruta que los consume (p. ej. `src/app/(auth)/login/actions.ts`, `src/app/(app)/matches/actions.ts`).
- Entrada vía `FormData` (no JSON): cada action hace `formData.get("...")` y normaliza (`String(...).trim()`).
- Salida: **redirect** con `next/navigation`. Para errores, helper centralizado `redirectWithError(path, message)` en `src/lib/redirects.ts`. La página destino lee `searchParams.error` y muestra el mensaje en un `Alert`.
- Para "volver a donde estabas" después de una acción, `src/lib/redirects.ts` expone `isInternalAppPath(value)` (whitelist regex) y `safeBackPath(from, fallback)`, para prevenir open redirects desde campos `from` o `next`.

### 4.4 Parsers y manejo de archivos

- **PDF**: `unpdf`, cargado dinámicamente (`await import("unpdf")`) en `src/lib/parsers/pdf-extract.ts` para no inflar el bundle (~600 KB). Cubre WinMSS, FAT y otros con extracción columna/fila por coordenadas.
- **HTML**: `node-html-parser` en `src/lib/parsers/practiscore.ts` y `src/lib/parsers/steel-challenge.ts`.
- **CSV**: parser propio (`parseCsvRow`) en `src/lib/parsers/fbi-csv.ts`, sin dependencia externa.

### 4.5 Tooling

- **TypeScript** en modo estricto (`"strict": true`), `moduleResolution: "bundler"`, alias `@/* → ./src/*`, plugin `next` activado, `noEmit: true` (Next compila).
- **Vitest** + `@vitejs/plugin-react`. Config en `vitest.config.ts`: alias `@` → `src`, `environment: "node"`, `include: ["tests/**/*.test.ts", "src/**/*.test.ts"]`.
- **PostCSS** con un único plugin (`@tailwindcss/postcss`).
- **No hay ESLint ni Prettier** declarados — el formato/estilo se mantiene por convención y revisión.
- **release-please** (configurado en `.github/release-please-config.json`, `release-type: node`, `package-name: hitfactor`) automatiza el bump de versión en `package.json` a partir de **Conventional Commits**. `src/lib/version.ts` importa `package.json` para exponer `APP_VERSION` en la UI.

### 4.6 Scripts (`package.json`)

| Script | Comando | Uso |
|---|---|---|
| `dev` | `next dev` | Desarrollo local |
| `build` | `next build` | Build de producción |
| `start` | `next start` | Servir el build |
| `test` | `vitest run` | Suite completa |
| `test:watch` | `vitest` | Watch mode |
| `db:types` | `npx --yes supabase gen types typescript --project-id igsfjdhtaxsxcnxaopxu --schema public > src/lib/supabase/database.types.ts` | Regenera tipos de DB (project-id hardcodeado) |

---

## 5. Arquitectura

### 5.1 Estructura de carpetas

```
src/
├── app/
│   ├── layout.tsx              # Root layout (ThemeProvider, fonts, body)
│   ├── globals.css             # Tailwind v4 + design tokens
│   ├── page.tsx                # Landing pública en "/"
│   ├── icon.svg
│   ├── (auth)/                 # Route group público (login / signup)
│   │   ├── layout.tsx          # Redirige a /dashboard si ya hay sesión
│   │   ├── login/
│   │   ├── signup/
│   │   └── oauth.ts            # Server Action: signInWithGoogle
│   ├── (app)/                  # Route group autenticado
│   │   ├── layout.tsx          # requireUser + AppSidebar + getProfile
│   │   ├── dashboard/[discipline]/
│   │   ├── matches/[id]/
│   │   ├── firearms/[id]/
│   │   ├── ammo/
│   │   ├── activity/
│   │   ├── about/
│   │   └── import/
│   ├── auth/                   # Endpoints REST de auth (no route group)
│   │   ├── callback/route.ts   # OAuth PKCE: exchangeCodeForSession
│   │   ├── confirm/route.ts    # Email OTP: verifyOtp
│   │   └── signout/route.ts    # POST → signOut + redirect
│   └── q/[code]/route.ts       # QR corto → resolve_firearm_qr_code
├── components/                 # UI compartida
│   ├── layout/                 # AppSidebar, PageContainer, AuthLayout
│   ├── providers/              # ThemeProvider (next-themes)
│   ├── auth/, ui/, landing/, icons/
│   ├── DashboardView.tsx, MatchList.tsx, HistoryTable.tsx, …
├── lib/
│   ├── supabase/               # Clientes server/client/middleware + types
│   ├── db/                     # Data-access (profiles, matches, firearms,
│   │                           #  ammo, shooters, clubs, audit, feedback,
│   │                           #  claim-suggestions)
│   ├── parsers/                # winmss-pdf, practiscore-pdf, fat-pdf,
│   │                           #  fbi-csv, practiscore, steel-challenge,
│   │                           #  steel-challenge-pdf, shared, pdf-extract,
│   │                           #  index
│   ├── import/                 # import-match, match-claim
│   ├── stats/                  # shooter-stats
│   ├── audit/                  # log-action, render
│   ├── actions/, firearms/, types/
│   ├── clubs.ts, disciplines.ts, redirects.ts, utils.ts, version.ts
└── proxy.ts                    # Next 16: el "middleware" se llama proxy.ts
```

Convención: **Server Components por default**. `"use client"` solo en componentes con estado/efectos locales. Las páginas son async y llaman directamente a helpers de `src/lib/db/*`.

### 5.2 Layouts y route groups

- **`src/app/layout.tsx`** (root): aplica las CSS vars de Geist sobre `<html>`, monta `<body className="bg-bg text-fg ...">` y envuelve todo en `ThemeProvider`. Metadata: `title: "HitFactor"`.
- **`src/app/(auth)/layout.tsx`**: server component que llama `supabase.auth.getUser()` y, si hay sesión, `redirect("/dashboard")`. Sin sesión renderiza login/signup.
- **`src/app/(app)/layout.tsx`**: llama `requireUser()` (redirect a `/login` si no hay sesión), obtiene `getProfile(supabase, user.id)`, calcula `userName` y `memberSince`, y monta `<AppSidebar />` + `<main>`.
- **Rutas públicas**: `/`, `/login`, `/signup`, `/auth/callback`, `/auth/confirm`, `/auth/signout`, `/q/[code]`.
- **Rutas autenticadas**: todo lo que cuelga de `(app)/` — `/dashboard`, `/dashboard/[discipline]`, `/matches`, `/matches/[id]`, `/firearms`, `/firearms/[id]`, `/ammo`, `/ammo/[id]`, `/activity`, `/about`, `/import`.

### 5.3 Flujo de autenticación

**Signup con email/password** (`src/app/(auth)/signup/actions.ts`):

1. Validación de campos (`email`, `password ≥ 8`, `display_name`); errores → `redirectWithError("/signup", ...)`.
2. `supabase.auth.signUp({ email, password, options: { data: { display_name } } })`.
3. Supabase tiene **"Confirm email" obligatorio** → no devuelve sesión. La action redirige a `/login?info=<mensaje>` indicándole al usuario que revise el mail (incluyendo la casilla concreta para que un `+alias` sea evidente).

**Confirmación por email** (`src/app/auth/confirm/route.ts`):

- Las plantillas de email de Supabase se configuran para apuntar a `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup|magiclink|recovery|email_change|invite` (en vez del `/auth/v1/verify` por default de Supabase, que no setea cookies en el dominio de la app).
- El handler valida `type` contra un whitelist (`signup | magiclink | recovery | email_change | invite`) y llama `supabase.auth.verifyOtp({ type, token_hash })`. Si OK → redirect al `next` (default `/dashboard`). Si falla → `/login?error=No se pudo confirmar el email`.

**Login con email/password** (`src/app/(auth)/login/actions.ts`):

1. Lee `email`, `password` y `next` (validado con `safeBackPath`, fallback `/dashboard`).
2. `supabase.auth.signInWithPassword({ email, password })`.
3. Si el error es `email_not_confirmed` (matchea por `code` o por regex `email\s+not\s+confirmed` en el `message` como fallback de SDK), redirige a `/login?error=...` con un mensaje accionable que incluye el email a chequear.
4. Cualquier otro error → `redirectWithError("/login", error.message)`.
5. OK → `redirect(next)`.

**OAuth con Google** (`src/app/(auth)/oauth.ts` → `/auth/callback`):

1. La action `signInWithGoogle()` arma `redirectTo` como `${proto}://${host}/auth/callback` leyendo `host` y `x-forwarded-proto` de `headers()` (fallback: `http` para `localhost`, `https` en cualquier otro caso). Esto permite que funcione en local, preview de Vercel y producción sin hardcodear dominio.
2. `supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo } })` devuelve la URL del provider; se hace `redirect(data.url)`.
3. Vuelta del usuario en `/auth/callback?code=...` (`src/app/auth/callback/route.ts`): `supabase.auth.exchangeCodeForSession(code)`. Si OK → redirect a `next` (default `/dashboard`). Si falla → `/login?error=No se pudo completar la autenticación`.

**Sign-out** (`src/app/auth/signout/route.ts`): handler `POST` que llama `supabase.auth.signOut()` y devuelve 303 a `/login`.

**Por qué dos endpoints distintos** (`/auth/callback` vs `/auth/confirm`): el primero implementa el flujo PKCE de OAuth (`?code=` + `exchangeCodeForSession`); el segundo implementa el flujo OTP por email (`?token_hash=` + `verifyOtp`). Son protocolos distintos; separarlos hace cada handler simple y obvio.

### 5.4 Acceso a datos

- **Cliente Supabase server-side por request**: `createClient()` en `src/lib/supabase/server.ts` está envuelto en `cache()` de React. Dentro de un mismo request, todas las llamadas devuelven la misma instancia, lo que permite que helpers como `getProfile`, `listClubs`, etc. se deduplicen al recibir un `supabase` estable.
- **Cliente Supabase browser-side**: `createBrowserClient` en `src/lib/supabase/client.ts`, usado en pocos componentes cliente.
- **RLS** impone el patrón de ownership por `auth.uid()`: las queries de `src/lib/db/*` no incluyen filtros redundantes por `user_id` salvo donde lo necesite la query.
- **Helper `requireUser({ returnTo? })`** (`src/lib/supabase/require-user.ts`): obtiene cliente, llama `supabase.auth.getUser()`, redirige a `/login` con `?next=<returnTo>` si no hay sesión (solo si `returnTo` pasa `isInternalAppPath`, evitando open redirects — útil sobre todo para QRs físicos que apuntan a una página de arma). Devuelve `{ supabase, user }`.

### 5.5 Sesión y proxy (Next 16)

**Next 16 reemplazó `middleware.ts` por `proxy.ts`** en el build output ("Proxy (Middleware)"). En este repo, el archivo que respalda al proxy es `src/proxy.ts`:

```ts
import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
```

No existe `middleware.ts` ni en root ni en `src/` — solo `proxy.ts`.

**`updateSession(request)`** (`src/lib/supabase/middleware.ts`) instancia un `createServerClient` con un `getAll`/`setAll` que copia cookies entrantes a la request y persiste las salientes en `NextResponse`. Llama `supabase.auth.getUser()` inmediatamente después (no se debe meter código entre `createServerClient` y `getUser`): refresca tokens si están por expirar y persiste las cookies nuevas. Sin esto, los tokens podrían expirar entre navegaciones y dejar al usuario en un estado raro.

El matcher excluye assets estáticos y rutas de imagen Next; todo el resto pasa por el refresh.

### 5.6 Tema y diseño

- **Modos**: claro / oscuro / sistema, gestionados por `next-themes`. El provider setea la clase `.dark` en `<html>` (la variant Tailwind v4 se define con `@custom-variant dark (&:where(.dark, .dark *))` en `globals.css`).
- **Design tokens** (CSS vars en `src/app/globals.css`):
  - Surfaces: `--bg` (`#fafaf9` / dark `#0a0a0b`), `--surface` (`#ffffff` / `#131316`), `--surface-2` (`#f5f5f4` / `#1c1c20`), `--border` (`#e7e5e4` / `#26262c`), `--border-strong` (`#d6d3d1` / `#2f2f37`).
  - Texto: `--fg` (`#1c1917` / `#ececef`), `--fg-muted` (`#57534e` / `#a0a0a8`), `--fg-subtle` (`#78716c` / `#6b6b75`).
  - Acentos: **`--accent: #d97706`** (amber-600, "latón del casquillo") — **igual en ambos temas**; `--accent-strong: #b45309`; `--accent-soft` con alpha 0.08 (light) / 0.12 (dark).
  - Estados: `--success`, `--danger`, `--info` con valores distintos por modo.
  - `--radius: 10px`.
- Los tokens se exponen como utilidades Tailwind vía `@theme inline { --color-bg: var(--bg); ... }` → `bg-bg`, `text-fg`, `bg-surface`, `border-border`, `text-accent`, etc.
- `.font-mono` agrega `font-variant-numeric: tabular-nums` global (datos numéricos siempre alineados).

### 5.7 Convenciones de código

- **ES modules** con import paths `@/*` (alias `./src/*`).
- **Server Components por default**; `"use client"` solo en interacción local. Los Server Components son async y consumen helpers de `src/lib/db/*` directamente.
- **Server Actions** en archivos `actions.ts` colocados junto a su ruta, entrada `FormData`, salida `redirect`/`redirectWithError`.
- **Comentarios y mensajes de UI en español rioplatense** ("Iniciá sesión", "Falta el nombre", "Revisá la casilla de ..."). Comentarios largos explican el "por qué" (decisiones, gotchas de Supabase/Next).
- **Conventional Commits** obligatorios: `feat:`, `fix:`, `perf:`, `refactor:`, `docs:`, `chore:`, `test:`, `style:`, `build:`, `ci:`. Solo `feat`, `fix`, `perf`, `refactor`, `docs` aparecen en el changelog.
- **Versionado**: `package.json` es la fuente de verdad; `src/lib/version.ts` lo importa y exporta `APP_VERSION` para la UI. release-please bump-ea ambos al mergear el PR de release.
- **AGENTS.md**: Next.js de este repo tiene cambios respecto a versiones anteriores (p. ej. `proxy.ts` en vez de `middleware.ts`). Leer `node_modules/next/dist/docs/` antes de escribir código nuevo.

### 5.8 Entorno y secretos

Variables de entorno referenciadas en el código:

- **`NEXT_PUBLIC_SUPABASE_URL`** — usada en `src/lib/supabase/{server,client,middleware}.ts`.
- **`NEXT_PUBLIC_SUPABASE_ANON_KEY`** — idem.

**No se usa `SUPABASE_SERVICE_ROLE_KEY`** en ningún punto del código — todo el acceso a datos pasa por la sesión del usuario y RLS.

El `project-id` de Supabase está hardcodeado en el script `db:types` del `package.json` (`igsfjdhtaxsxcnxaopxu`), no leído de env.

### 5.9 Tests

Vitest en `environment: "node"`, alias `@` → `src`. Patterns: `tests/**/*.test.ts` (suite principal) y `src/**/*.test.ts` (co-ubicados, si los hubiera).

| Test | Cubre |
|---|---|
| `winmss-pdf.test.ts` | Extracción de PDF WinMSS / ESS |
| `practiscore-pdf.test.ts` | PDF de PractiScore (IPSC) — detección, filas overall/stage, DQ, inferencia de número de stage |
| `fat-pdf.test.ts` | PDFs de FAT (Federación Argentina de Tiro) |
| `fbi-csv.test.ts` | CSV propio de Tiro FBI |
| `practiscore.test.ts` | HTML de PractiScore (IPSC) |
| `steel-challenge.test.ts` | HTML de Steel Challenge |
| `steel-challenge-pdf.test.ts` | PDFs de Steel Challenge (PractiScore iPhone) |
| `parsers-shared.test.ts` | Utilidades transversales de parsers |
| `audit-render.test.ts` | Render de entradas del audit log |
| `shooter-stats.test.ts` | Cómputo de estadísticas del tirador |
| `import-match.test.ts` | Pipeline de import |
| `match-claim.test.ts` | Sugerencias de claim post-import |
| `stage-resolution.test.ts` | Asociación stage → match |
| `clubs.test.ts` | Resolución de region → club |
| `estimate-rounds.test.ts` | Heurística de estimación de disparos |

No hay tests E2E ni de componentes React; el dominio cubierto es lógica pura de parsing, importación, estadísticas, auditoría y resolución de clubes/stages.

---

## 6. Modelo de datos

### 6.1 Visión general

HitFactor usa un esquema Postgres (Supabase) en el schema `public` con ~16 tablas. El núcleo es un grafo `matches → stages / match_entries → stage_results` que modela los resultados de torneos importados, vinculados opcionalmente a usuarios reales vía `shooters.linked_user_id` y enriquecidos con datos privados del tirador (`firearms`, `ammunition_types`, `match_firearm_log`, `firearm_usage_log`).

Convenciones comunes:

- PKs `uuid` con `gen_random_uuid()` salvo lookups (`smallserial`) y logs (`bigserial`).
- Columnas `created_at` / `updated_at` (`timestamptz default now()`) mantenidas por el trigger genérico `public.set_updated_at()`.
- Sin soft-delete: cascade real en FKs.
- RLS activada en todas las tablas públicas.
- El catálogo de auth vive en `auth.users` (Supabase); `public.profiles` lo extiende vía FK + trigger `on_auth_user_created`.

### 6.2 Tablas

#### `public.profiles`

Extiende `auth.users` con info de perfil y preferencias del usuario.

| Columna | Tipo | Null | Default | Notas |
|---|---|---|---|---|
| id | uuid | NO | — | PK; FK a `auth.users(id)` |
| display_name | text | NO | — | Resuelto en cadena por el trigger en signup |
| full_name | text | SI | — | |
| member_number | text | SI | — | |
| default_region | text | SI | — | |
| ui_prefs | jsonb | NO | `'{}'::jsonb` | Forma libre validada en cliente; hoy `{matchesPageSize, claimSuggestionsDismissed}` |
| is_admin | boolean | NO | `false` | Bootstrap manual vía SQL UPDATE |
| created_at | timestamptz | NO | `now()` | |
| updated_at | timestamptz | NO | `now()` | Mantenido por `set_updated_at` |

- **PK**: `id`
- **FK**: `id → auth.users.id` ON DELETE CASCADE
- **Triggers**: `profiles_set_updated_at` BEFORE UPDATE

#### `public.disciplines`

Lookup de disciplinas de tiro.

| Columna | Tipo | Null | Default | Notas |
|---|---|---|---|---|
| id | smallint (smallserial) | NO | seq | |
| code | text | NO | — | |
| name | text | NO | — | |
| scoring_type | text | NO | — | `hit_factor` / `time_plus` / `points` |

- **PK**: `id`
- **Unique**: `code`

#### `public.divisions`

Lookup de divisiones por disciplina.

| Columna | Tipo | Null | Default | Notas |
|---|---|---|---|---|
| id | smallint (smallserial) | NO | seq | |
| discipline_id | smallint | NO | — | |
| code | text | NO | — | |
| name | text | NO | — | |

- **PK**: `id`
- **FK**: `discipline_id → disciplines.id` ON DELETE CASCADE
- **Unique**: `(discipline_id, code)` — permite repetir `code` entre disciplinas (ej. `PIS` en `ipsc` y `tiro_fbi`)

#### `public.shooters`

Tiradores que aparecen en los resultados. Pueden linkearse a un user real (`linked_user_id`) o ser huérfanos.

| Columna | Tipo | Null | Default | Notas |
|---|---|---|---|---|
| id | uuid | NO | `gen_random_uuid()` | |
| full_name | text | NO | — | |
| member_number | text | SI | — | |
| region | text | SI | — | |
| linked_user_id | uuid | SI | — | FK a `auth.users` |
| created_at | timestamptz | NO | `now()` | |
| updated_at | timestamptz | NO | `now()` | |

- **PK**: `id`
- **FK**: `linked_user_id → auth.users.id` ON DELETE SET NULL
- **Índices**: `shooters_full_name_idx` (GIN sobre `to_tsvector('simple', full_name)`), `shooters_member_number_idx`, `shooters_linked_user_idx`
- **Triggers**: `shooters_set_updated_at`

#### `public.matches`

Torneos importados. Datos públicos (lectura para autenticados); escritura solo del importer (más admin para algunos campos).

| Columna | Tipo | Null | Default | Notas |
|---|---|---|---|---|
| id | uuid | NO | `gen_random_uuid()` | |
| discipline_id | smallint | NO | — | |
| name | text | NO | — | |
| date | date | NO | — | |
| region | text | SI | — | Texto libre o code de `clubs` (sin FK) |
| source_type | text | NO | — | Ver dominio |
| source_filename | text | SI | — | |
| imported_by_user_id | uuid | NO | — | |
| imported_at | timestamptz | NO | `now()` | |
| import_notes | text | SI | — | |
| min_shots | int | SI | — | Disparos mínimos por reglas; FBI=45; CHECK `min_shots > 0` |
| created_at | timestamptz | NO | `now()` | |
| updated_at | timestamptz | NO | `now()` | |

- **PK**: `id`
- **FK**: `discipline_id → disciplines.id`; `imported_by_user_id → auth.users.id` ON DELETE RESTRICT
- **Unique**: `matches_unique_torneo` = `(discipline_id, name, date, region)` con `NULLS NOT DISTINCT` (dos NULL en `region` cuentan como duplicado)
- **Check**: `matches_source_type_check` (ver dominio); `min_shots IS NULL OR min_shots > 0`
- **Índices**: `matches_discipline_date_idx (discipline_id, date desc)`, `matches_importer_idx`
- **Triggers**: `matches_set_updated_at`

#### `public.stages`

Stages de un match.

| Columna | Tipo | Null | Default | Notas |
|---|---|---|---|---|
| id | uuid | NO | `gen_random_uuid()` | |
| match_id | uuid | NO | — | |
| stage_number | smallint | SI | — | |
| name | text | NO | — | |
| max_points | integer | SI | — | |
| created_at | timestamptz | NO | `now()` | |

- **PK**: `id`
- **FK**: `match_id → matches.id` ON DELETE CASCADE
- **Unique**: `(match_id, stage_number)`
- **Índices**: `stages_match_idx`

#### `public.match_entries`

Participación de un tirador en un match (resultado general).

| Columna | Tipo | Null | Default | Notas |
|---|---|---|---|---|
| id | uuid | NO | `gen_random_uuid()` | |
| match_id | uuid | NO | — | |
| shooter_id | uuid | NO | — | |
| division_id | smallint | NO | — | |
| classification | text | SI | — | |
| power_factor | text | SI | — | CHECK `'Min' \| 'Maj' \| null` |
| category | text | SI | — | |
| place | integer | NO | — | |
| match_points | numeric(10,4) | NO | `0` | |
| match_percentage | numeric(7,4) | NO | `0` | |
| total_time_seconds | numeric(8,3) | SI | — | Steel/Combat; NULL en IPSC |
| hits | smallint | SI | — | Tiro FBI; NULL en IPSC/Steel |
| is_dq | boolean | NO | `false` | |
| is_absent | boolean | NO | `false` | Anotado pero no asistió |
| created_at | timestamptz | NO | `now()` | |

- **PK**: `id`
- **FK**: `match_id → matches.id` ON DELETE CASCADE; `shooter_id → shooters.id` ON DELETE RESTRICT; `division_id → divisions.id`
- **Unique**: `(match_id, shooter_id, division_id)`
- **Índices**: `match_entries_match_idx`, `match_entries_shooter_idx`

#### `public.stage_results`

Resultado de un tirador en un stage.

| Columna | Tipo | Null | Default | Notas |
|---|---|---|---|---|
| id | uuid | NO | `gen_random_uuid()` | |
| stage_id | uuid | NO | — | |
| match_entry_id | uuid | NO | — | |
| points | numeric(10,4) | SI | — | |
| penalties | numeric(10,4) | SI | — | |
| time_seconds | numeric(8,3) | SI | — | |
| hit_factor | numeric(8,4) | SI | — | |
| stage_points | numeric(10,4) | NO | `0` | |
| stage_percentage | numeric(7,4) | NO | `0` | |
| place | integer | SI | — | |
| hits | smallint | SI | — | Tiro FBI; NULL en IPSC/Steel |
| is_dq | boolean | NO | `false` | |
| created_at | timestamptz | NO | `now()` | |

- **PK**: `id`
- **FK**: `stage_id → stages.id` ON DELETE CASCADE; `match_entry_id → match_entries.id` ON DELETE CASCADE
- **Unique**: `(stage_id, match_entry_id)`
- **Índices**: `stage_results_stage_idx`, `stage_results_match_entry_idx`

#### `public.firearms`

Catálogo privado de armas por usuario.

| Columna | Tipo | Null | Default | Notas |
|---|---|---|---|---|
| id | uuid | NO | `gen_random_uuid()` | |
| owner_user_id | uuid | NO | — | |
| name | text | NO | — | |
| brand | text | SI | — | |
| model | text | SI | — | |
| caliber | text | SI | — | |
| notes | text | SI | — | |
| qr_code | text | NO | `public.gen_firearm_qr_code()` | Código corto 6 chars alfabeto sin ambigüedades |
| created_at | timestamptz | NO | `now()` | |
| updated_at | timestamptz | NO | `now()` | |

- **PK**: `id`
- **FK**: `owner_user_id → auth.users.id` ON DELETE CASCADE
- **Unique**: `qr_code`
- **Índices**: `firearms_owner_idx`
- **Triggers**: `firearms_set_updated_at`

#### `public.match_firearm_log`

Arma + munición usada por el tirador en un `match_entry`. Relación 1:1 con `match_entries` (PK simple sobre `match_entry_id`).

| Columna | Tipo | Null | Default | Notas |
|---|---|---|---|---|
| match_entry_id | uuid | NO | — | PK |
| firearm_id | uuid | NO | — | |
| rounds_fired | integer | NO | `0` | CHECK `>= 0` |
| ammunition_type_id | uuid | SI | — | ON DELETE SET NULL preserva el historial |
| notes | text | SI | — | |
| created_at | timestamptz | NO | `now()` | |
| updated_at | timestamptz | NO | `now()` | |

- **PK**: `match_entry_id`
- **FK**: `match_entry_id → match_entries.id` ON DELETE CASCADE; `firearm_id → firearms.id` ON DELETE CASCADE; `ammunition_type_id → ammunition_types.id` ON DELETE SET NULL
- **Índices**: `match_firearm_log_firearm_idx`, `match_firearm_log_ammunition_idx`
- **Triggers**: `match_firearm_log_set_updated_at`

#### `public.ammunition_types`

Catálogo privado de tipos de munición por usuario (factory / reload).

| Columna | Tipo | Null | Default | Notas |
|---|---|---|---|---|
| id | uuid | NO | `gen_random_uuid()` | |
| owner_user_id | uuid | NO | — | |
| name | text | NO | — | |
| type | text | NO | — | CHECK `'factory' \| 'reload'` |
| caliber | text | SI | — | |
| brand | text | SI | — | |
| bullet_weight_grains | numeric(6,2) | SI | — | |
| bullet_type | text | SI | — | FMJ / HP / JSP / etc. |
| powder | text | SI | — | Solo relevante en reload |
| powder_charge_grains | numeric(6,3) | SI | — | Solo relevante en reload |
| power_factor | text | SI | — | CHECK `'Min' \| 'Maj' \| null` |
| power_factor_measured | numeric(7,2) | SI | — | Valor medido (cronógrafo) |
| notes | text | SI | — | |
| created_at | timestamptz | NO | `now()` | |
| updated_at | timestamptz | NO | `now()` | |

- **PK**: `id`
- **FK**: `owner_user_id → auth.users.id` ON DELETE CASCADE
- **Índices**: `ammunition_types_owner_idx`
- **Triggers**: `ammunition_types_set_updated_at`

#### `public.firearm_usage_log`

Log manual de uso de un arma fuera de torneos (entrenamiento / práctica).

| Columna | Tipo | Null | Default | Notas |
|---|---|---|---|---|
| id | uuid | NO | `gen_random_uuid()` | |
| firearm_id | uuid | NO | — | |
| ammunition_type_id | uuid | SI | — | |
| used_on | date | NO | — | Solo fecha, sin hora |
| rounds_fired | integer | NO | — | CHECK `> 0` (strict) |
| notes | text | SI | — | |
| created_at | timestamptz | NO | `now()` | |
| updated_at | timestamptz | NO | `now()` | |

- **PK**: `id`
- **FK**: `firearm_id → firearms.id` ON DELETE CASCADE; `ammunition_type_id → ammunition_types.id` ON DELETE SET NULL
- **Índices**: `firearm_usage_log_firearm_idx`, `firearm_usage_log_ammo_idx`
- **Triggers**: `firearm_usage_log_set_updated_at`

#### `public.clubs`

Catálogo de clubes. Alimenta el dropdown de la UI; sin FK desde `matches.region` (fallback de texto libre).

| Columna | Tipo | Null | Default | Notas |
|---|---|---|---|---|
| code | text | NO | — | PK (case-sensitive) |
| name | text | NO | — | |
| country | text | SI | — | |
| zone | text | SI | — | Zona FATP |
| created_at | timestamptz | NO | `now()` | |

- **PK**: `code`

#### `public.audit_log`

Log polimórfico de mutaciones del usuario. `metadata` jsonb varía según `action` (convenio `"entidad.verbo"`).

| Columna | Tipo | Null | Default | Notas |
|---|---|---|---|---|
| id | bigint (bigserial) | NO | seq | |
| user_id | uuid | NO | — | |
| action | text | NO | — | Ej. `shooter.claim` |
| entity_type | text | SI | — | |
| entity_id | text | SI | — | |
| metadata | jsonb | SI | — | |
| created_at | timestamptz | NO | `now()` | |

- **PK**: `id`
- **FK**: `user_id → auth.users.id` ON DELETE CASCADE
- **Índices**: `audit_log_user_recent_idx (user_id, created_at desc)`, `audit_log_entity_idx (entity_type, entity_id)`

#### `public.feedback`

Reportes de bugs y sugerencias desde `/about`. El admin actualiza vía service_role (RLS no permite UPDATE/DELETE a usuarios).

| Columna | Tipo | Null | Default | Notas |
|---|---|---|---|---|
| id | bigint (bigserial) | NO | seq | |
| user_id | uuid | NO | — | |
| type | text | NO | — | CHECK `'bug' \| 'suggestion' \| 'other'` |
| message | text | NO | — | CHECK `char_length between 10 and 4000` |
| page_url | text | SI | — | |
| status | text | NO | `'new'` | CHECK ver dominio |
| admin_note | text | SI | — | |
| created_at | timestamptz | NO | `now()` | |
| updated_at | timestamptz | NO | `now()` | |

- **PK**: `id`
- **FK**: `user_id → auth.users.id` ON DELETE CASCADE
- **Índices**: `feedback_user_recent_idx`, `feedback_status_idx (status, created_at desc)`
- **Triggers**: `feedback_updated_at_trg` (función dedicada `feedback_set_updated_at`)

### 6.3 Tipos enumerados / dominios

Modelados como CHECKs sobre `text` (no `enum` nativos, para evitar fricción de migrar enums):

- `disciplines.scoring_type` ∈ `{hit_factor, time_plus, points}` (libre por convención; no hay CHECK).
- `matches.source_type` ∈ `{practiscore_match_html, practiscore_combined_html, practiscore_stage_html, practiscore_steel_html, practiscore_pdf, winmss_pdf, fbi_csv, fat_pdf, manual}`.
- `match_entries.power_factor` ∈ `{Min, Maj, NULL}`.
- `ammunition_types.type` ∈ `{factory, reload}`.
- `ammunition_types.power_factor` ∈ `{Min, Maj, NULL}`.
- `feedback.type` ∈ `{bug, suggestion, other}`.
- `feedback.status` ∈ `{new, triaged, in_progress, done, wontdo, duplicate}` (status neutros; la UI rendea label según `(status, type)`).
- `clubs.zone` (sin CHECK, valores convencionales): `{Atlántica, Centro, Cuyo, Litoral, Metropolitana, Noreste, Noroeste, Patagónica}`.

**Seeds de la migración inicial**:

- `disciplines`: `ipsc` (hit_factor), `steel_challenge` (time_plus), `combat_solutions` (time_plus), `tiro_fbi` (points).
- `divisions` IPSC: `O, P, PO, PCC, PCCO, S, SM, CO, R, CL, MS, PIS`.
- `divisions` Steel Challenge: `PISTOLA, REVOLVER, OPEN, ROOKIE, IRON, OPTIC, PCC`.
- `divisions` Tiro FBI: `PIS, REV, MINI, PCC`.
- `clubs`: 38 clubes federados FATP (zonas Metropolitana, Atlántica, Centro, Cuyo, Litoral, Noreste, Noroeste, Patagónica).

### 6.4 Funciones y triggers

| Función | Lenguaje | Modo | search_path | Propósito |
|---|---|---|---|---|
| `public.set_updated_at()` | plpgsql | trigger | `''` | Setea `new.updated_at = now()`. Trigger BEFORE UPDATE en: `profiles`, `shooters`, `matches`, `firearms`, `match_firearm_log`, `ammunition_types`, `firearm_usage_log` |
| `public.feedback_set_updated_at()` | plpgsql | trigger | `''` | Igual al anterior, dedicada por consistencia histórica. Trigger BEFORE UPDATE en `feedback` |
| `public.handle_new_user()` | plpgsql | SECURITY DEFINER, EXECUTE revocado | `public` | Inserta row en `profiles` al registrarse user en `auth.users`. Resuelve `display_name` por cadena de fallback `display_name → full_name → name → email-prefix`. Trigger `on_auth_user_created` AFTER INSERT en `auth.users` |
| `public.my_discipline_counts(p_user_id uuid)` | sql | stable | `''` | Devuelve `(code, name, count)` agregado por disciplina para las `match_entries` de los shooters linkeados al user. Optimización del sidebar |
| `public.merge_duplicate_shooters()` | plpgsql | utilidad admin | `''` | Mergea shooters duplicados al canónico (prefiere `linked_user_id NOT NULL`, si no el más antiguo). Idempotente |
| `public.find_matches_with_internal_duplicates()` | sql | stable, EXECUTE revocado | `''` | Lista matches con entries duplicadas dentro de la misma división (mismo nombre normalizado) |
| `public.purge_match_for_reimport(p_name text, p_date date)` | plpgsql, EXECUTE revocado | `''` | Borra match con cascade y limpia shooters huérfanos sin claim. Levanta excepción si no existe |
| `public.gen_firearm_qr_code()` | plpgsql | volatile | `''` | Genera código random 6-char del alfabeto `ABCDEFGHJKMNPQRSTUVWXYZ23456789`. Usado como DEFAULT de `firearms.qr_code` |
| `public.resolve_firearm_qr_code(p_code text)` | sql | stable, SECURITY DEFINER, EXECUTE a anon+authenticated | `''` | Resuelve `code → firearm_id` para la ruta pública `/q/{code}` |

**Trigger histórico removido en 0013**: `firearms_assign_qr_code_trg` (BEFORE INSERT) reemplazado por column DEFAULT.

### 6.5 Row Level Security

RLS habilitada en todas las tablas del schema `public`. Salvo nota, la lectura para `authenticated` es lectura completa; las tablas privadas (firearms, ammunition_types, etc.) no tienen política de SELECT pública.

| Tabla | Policy | Op | Predicado |
|---|---|---|---|
| `profiles` | `profiles_select_authenticated` | SELECT | abierto a `authenticated` |
| `profiles` | `profiles_update_own` | UPDATE | `auth.uid() = id` |
| `disciplines` | `disciplines_select_all` | SELECT | `auth.role() = 'authenticated'` |
| `divisions` | `divisions_select_all` | SELECT | `auth.role() = 'authenticated'` |
| `shooters` | `shooters_select_all` | SELECT | `auth.role() = 'authenticated'` |
| `shooters` | `shooters_insert_authenticated` | INSERT | `auth.role() = 'authenticated'` |
| `shooters` | `shooters_claim_self` | UPDATE | check: `linked_user_id is null or linked_user_id = auth.uid()` |
| `matches` | `matches_select_all` | SELECT | autenticados |
| `matches` | `matches_insert_authenticated` | INSERT | `auth.uid() = imported_by_user_id` |
| `matches` | `matches_update_importer` | UPDATE | `auth.uid() = imported_by_user_id` |
| `matches` | `matches_update_admin` | UPDATE | `exists profiles p where p.id = auth.uid() and p.is_admin` (añadida en 0014 para `min_shots`) |
| `matches` | `matches_delete_importer` | DELETE | `auth.uid() = imported_by_user_id` |
| `stages` | `stages_select_all` | SELECT | autenticados |
| `stages` | `stages_insert_match_owner` | INSERT | `exists match m where m.id = match_id and m.imported_by_user_id = auth.uid()` |
| `match_entries` | `match_entries_select_all` | SELECT | autenticados |
| `match_entries` | `match_entries_insert_match_owner` | INSERT | importer del match |
| `match_entries` | `match_entries_update_match_owner` | UPDATE | OR de tres ramas (ampliado en 0008): (a) importer del match, (b) admin del sitio, (c) el propio tirador `exists shooters s where s.id = shooter_id and s.linked_user_id = auth.uid()` |
| `stage_results` | `stage_results_select_all` | SELECT | autenticados |
| `stage_results` | `stage_results_insert_match_owner` | INSERT | importer (vía stage → match) |
| `stage_results` | `stage_results_update_match_owner` | UPDATE | importer (vía stage → match) |
| `firearms` | `firearms_owner_all` | ALL | `owner_user_id = auth.uid()` |
| `match_firearm_log` | `match_firearm_log_owner_all` | ALL | dueño del firearm **y** `me.shooter_id` está linkeado a `auth.uid()` |
| `ammunition_types` | `ammunition_types_owner_all` | ALL | `owner_user_id = (select auth.uid())` |
| `firearm_usage_log` | `firearm_usage_log_owner_all` | ALL | join: el `firearm` referenciado tiene `owner_user_id = auth.uid()` |
| `clubs` | `clubs_select_authenticated` | SELECT | autenticados (escritura solo SQL editor) |
| `audit_log` | `audit_log_select_own` / `audit_log_insert_own` | SELECT/INSERT | `auth.uid() = user_id` (sin UPDATE/DELETE) |
| `feedback` | `feedback_select_own` / `feedback_insert_own` | SELECT/INSERT | `auth.uid() = user_id` (UPDATE/DELETE solo service_role) |

### 6.6 Historial de migraciones

- **0001_initial_schema.sql** — Bootstrap consolidado: helpers (`set_updated_at`), tablas `profiles, disciplines, divisions, shooters, matches, stages, match_entries, stage_results, firearms, match_firearm_log, clubs, audit_log, feedback`, seeds (disciplinas, divisiones, clubes FATP), trigger `on_auth_user_created`, función `merge_duplicate_shooters`, RLS completa.
- **0002_my_discipline_counts.sql** — Función RPC `my_discipline_counts(uuid)` para agregar conteos de `match_entries` por disciplina del user (optimización del sidebar).
- **0003_security_advisor_fixes.sql** — `ALTER FUNCTION ... SET search_path = ''` en las 4 funciones existentes; `REVOKE EXECUTE` de `handle_new_user` (SECURITY DEFINER).
- **0004_fat_pdf_source.sql** — Amplía el CHECK `matches.source_type` para incluir `'fat_pdf'`.
- **0005_profiles_admin.sql** — Agrega `profiles.is_admin boolean not null default false`.
- **0006_match_dedup_utilities.sql** — Funciones utilitarias de admin `find_matches_with_internal_duplicates()` y `purge_match_for_reimport(name, date)` con EXECUTE revocado.
- **0007_match_entries_absent.sql** — Agrega `match_entries.is_absent boolean not null default false` para distinguir "no compitió" de "compitió y le fue mal".
- **0008_match_entries_update_extended.sql** — Reemplaza la policy `match_entries_update_match_owner` por una con OR de tres ramas (importer, admin, propio tirador).
- **0009_backfill_is_absent.sql** — Backfill idempotente de `is_absent` aplicando por `source_type` las reglas de cada parser; corrige también el caso WinMSS donde ausentes habían sido marcados como `is_dq=true`.
- **0010_ammunition_types.sql** — Crea `ammunition_types` con RLS `owner_all`; agrega `match_firearm_log.ammunition_type_id` (FK ON DELETE SET NULL).
- **0011_firearm_usage_log.sql** — Crea `firearm_usage_log` (uso fuera de torneos) con `rounds_fired > 0` y RLS vía join al firearm.
- **0012_firearm_qr_codes.sql** — Agrega `firearms.qr_code` (unique), función `gen_firearm_qr_code()`, backfill con retry on collision, trigger BEFORE INSERT `firearms_assign_qr_code_trg`, y RPC público `resolve_firearm_qr_code(text)` con SECURITY DEFINER.
- **0013_firearm_qr_code_default.sql** — Drop del trigger `firearms_assign_qr_code_trg` y reemplazo por `DEFAULT public.gen_firearm_qr_code()` a nivel columna (para que `supabase gen_types` lo vea como opcional en `Insert`).
- **0014_match_min_shots.sql** — Agrega `matches.min_shots int CHECK (min_shots IS NULL OR > 0)`, backfill a 45 para todos los matches `tiro_fbi`, y la policy `matches_update_admin` (admins pueden UPDATE de cualquier match).
- **0015_steel_pdf_source.sql** — Amplía el CHECK `matches.source_type` para incluir `'practiscore_steel_pdf'` (reportes PDF de Steel Challenge generados por PractiScore iPhone).
- **0016_fbi_classic_division.sql** — Agrega la división `CLASSIC` a Tiro FBI (TFALP corre torneos FBI con esa división además de Pistola/Revólver/Minirifle/PCC).
- **0017_ipsc_classic_manual_division.sql** — Agrega la división `CM` (Classic Manual) a IPSC, usada por los torneos de escopeta exportados desde PractiScore (distinta de `CL` Classic).

---

## 7. Reglas de negocio

### 7.1 Disciplinas

Los códigos canónicos viven en `src/lib/disciplines.ts` y deben coincidir 1:1 con la columna `disciplines.code` en la DB.

| Constante | `code` | Tipo de scoring |
|---|---|---|
| `DISCIPLINE.IPSC` | `ipsc` | hit factor / puntos |
| `DISCIPLINE.STEEL` | `steel_challenge` | time-based (`time_plus`) |
| `DISCIPLINE.COMBAT` | `combat_solutions` | time-based (`time_plus`) |
| `DISCIPLINE.FBI` | `tiro_fbi` | hits-based |

Helpers:

- **`isTimeBasedDiscipline(input)`** — true si la disciplina puntúa por tiempo total. Acepta string crudo o el embed `{ code, scoring_type }` que devuelven las queries de match. Prefiere `scoring_type === "time_plus"` cuando viene seteado, para que una disciplina nueva con ese scoring_type quede detectada sin tocar el archivo. Fallback: chequea el set hardcoded `{steel_challenge, combat_solutions}`.
- **`isHitsBasedDiscipline(input)`** — true si la disciplina rankea primariamente por cantidad de impactos (`tiro_fbi`). En estas disciplinas el campo `hits` del entry/result es el criterio primario y el puntaje funciona como desempate.

Divisiones por disciplina: existen en la tabla `divisions` (con FK a `disciplines`), las usan los parsers y las queries de match, pero no hay un set hardcoded en este archivo — son data, no código.

### 7.2 Identidad del tirador (claim)

Modelo de **identidades múltiples**: un mismo usuario puede claimar N filas en `shooters` (una por cada variante con la que su nombre fue cargado en cada torneo: "Apellido, Nombre" vs "Apellido Nombre", iniciales, planillas distintas). La relación se materializa en `shooters.linked_user_id`.

Reglas del claim (`src/lib/actions/claim.ts`):

- El usuario tiene que estar autenticado (`requireUser()`).
- El shooter no debe estar claimado por **otro** usuario. La invariante se enforce-a a nivel SQL con `.update(...).is("linked_user_id", null)` — si la fila ya tiene `linked_user_id`, el update no afecta ninguna fila.
- Si el shooter ya está claimado por **el mismo** usuario, es un no-op silencioso (igual revalida paths y redirige como si fuera éxito — robusto contra doble submit).
- Si está claimado por **otro** usuario, redirige al `errorTarget` con el mensaje "Este tirador ya fue claimado por otro usuario."
- En éxito loguea `shooter.claim` con metadata `{shooter_full_name, match_id?, match_name?}` para que el activity log diga "Asociaste a tu cuenta el tirador X desde 'Social 4 - 19/04/26'".

Reglas del unclaim:

- Solo desvincula el `shooter_id` específico (no todas las identidades del usuario).
- El `.update(...).eq("linked_user_id", user.id)` garantiza que no se pueda desvincular un shooter ajeno.
- Solo loguea `shooter.unclaim` si el update afectó al menos una fila (evita registrar intentos no-op como doble submit o tentativas sobre shooters ajenos).

Flujo "Soy yo": el botón aparece en la vista pública del match para shooters no claimados que pasen el filtro `isClaimCandidate`. En el bootstrap (aliases pobres) el filtro deja pasar a todos para no bloquear el primer claim manual.

#### 7.2.1 Sugerencias de claim

Algoritmo en `src/lib/db/claim-suggestions.ts` + `src/lib/import/match-claim.ts`.

**Aliases del usuario** (`buildClaimAliases`):

- `profile.display_name`, `profile.full_name`.
- El `full_name` de **todos** los shooters ya linkeados al usuario.
- El `profile.member_number` + los `member_number` de los shooters ya linkeados (todos en un `Set<string>` con `trim()`).

**Gate `hasUsefulAliases`**: true si hay al menos un `member_number`, o si al menos un nombre tiene **≥ 2 tokens**. Con aliases pobres (display_name de 1 token, ej. solo "Diego"), `findClaimSuggestions` devuelve `[]` directamente — el matcher fuzzy exige ≥ 2 tokens y caería al modo "todo es candidato" sugiriendo cientos.

**Matching (`claimMatchReason`)**:

1. **`reason: "member_number"`** — coincidencia exacta (con `trim`) entre el `member_number` del shooter y algún alias.
2. **`reason: "name"`** — `areNamesSimilar(alias, shooter.full_name)` devuelve true.

**`areNamesSimilar`** (`claimNameKey` → minúsculas, sin acentos NFD, sin `,` ni `.`, espacios colapsados, `trim`):

- Tokeniza ambos nombres (`nameTokens`).
- El set más chico debe estar contenido en el más grande.
- **El set chico debe tener ≥ 2 tokens** (evita falsos positivos por apellido común).
- Tolerancia fuzzy: **un único** token puede diferir por Levenshtein **≤ 1** si tanto el token original como el candidato tienen ≥ `FUZZY_MIN_LEN = 4` caracteres. Cubre typos tipo "Demarciani" vs "Demarziani". Los demás tokens deben matchear exacto.

**Sugerencias finales** (`findClaimSuggestions`):

- Filtro DB: `shooters!inner` con `linked_user_id is null`, ordenado por `matches.date desc`, cap defensivo de **1000 entries** (el filtro fino con Levenshtein corre en JS).
- Cada shooter aparece **una sola vez**: el match más reciente. Claimar uno linkea todas sus entries automáticamente porque el FK va shooter → match_entry.
- Orden por fecha del match descendente.
- `limit` default = **5** (a propósito; más sugerencias hacen que la card pierda foco).

**Bootstrap especial en `isClaimCandidate`**: si los aliases NO son útiles, devuelve `true` para *todo* shooter — la vista pública del match quiere mostrar "Soy yo" en todos los shooters no claimados para habilitar el primer claim manual. Este comportamiento es deliberado y vive solo en `isClaimCandidate`; la auto-detección post-import (`findClaimCandidates` / `findClaimSuggestions`) prefiere no sugerir nada antes que sugerir 200.

### 7.3 Estadísticas del tirador

> **Mapa decisión → métrica**: la lista de preguntas concretas del tirador que cada KPI responde está en §1. Esta sección es la definición técnica.

Pure function en `src/lib/stats/shooter-stats.ts`. `computeShooterStats(entries, options)` recibe los entries y devuelve los KPIs — no hace queries.

**Dedupe por match**: si un tirador corrió 2+ divisiones del mismo torneo (ej. PO y PCCO el mismo día), cuenta como **un torneo** en las KPIs cross-match. Política de selección: gana la participación válida (no DQ, no ausente) sobre la inválida; con ambas válidas o ambas inválidas, gana mayor `matchPercentage`. `byDivision` se calcula sobre **todos** los entries (sin dedup) — ese desglose precisamente quiere ver cada división por separado.

**Filtro "scoreable"**: para todos los KPIs basados en `matchPercentage` se filtran ausentes y DQs (`!isDq && !isAbsent`) — bajaban artificialmente promedio, consistencia y trayectoria.

**Métricas a nivel match** (sobre el set scoreable, deduped por match):

- `totalMatches`: total de torneos disputados (incluye DQ).
- `scoredMatches`: total considerados para promedios (excluye DQ y ausentes).
- `avgPercentage`: promedio de Match % en torneos válidos. 0 si no hay.
- `bestPercentage`: highlight con el mejor Match %.
- `bestPlace`: highlight con el `place` numéricamente más bajo.
- `consistency`: **desvío estándar muestral** (denominador `n-1`) del Match %. Null si <2 matches válidos. Menor = más predecible.
- `trajectorySlope`: pendiente β de regresión lineal de Match % vs orden cronológico, en "% por torneo". Positivo = mejorando. Null si <2 puntos o si todos los x son iguales.
- `avgPercentile` / `bestPercentile`: percentil dentro de la división (`place/total × 100`, **más bajo = mejor**). Sólo sobre matches con `totalInDivision` conocido (pasado en `options.divisionSizes`).

**Métricas hits-based** (sólo entries con `hits != null` — actualmente FBI):

- `avgHits`, `bestHits`.
- `consistencyHits`: stddev muestral. Null si <2 matches con hits.
- `trajectoryHitsSlope`: pendiente regresión lineal de hits vs orden, en "impactos por torneo".

**Cadencia** (`computeCadence`):

- Ventana fija de **`CADENCE_WINDOW_DAYS = 90`** días.
- `matchesPerMonth = (recentCount / 90) * 30`.
- `daysSinceLastMatch`: días desde el último match (UTC midnight, no shift de timezone). Null si no hay matches.

**Eficiencia de munición** (`computeAmmoEfficiency`):

- Sólo computa sobre entries con **ambos** datos poblados: `matches.min_shots` Y `match_firearm_log.rounds_fired`. Si N=0 devuelve null (preferible esconder el tile que mostrar "0 / 0 / —").
- **No dedup por match**: si el tirador corrió Pistola y PCC del mismo FBI, gastó munición en ambas — cuentan las dos.
- **No filtra DQ/ausentes**: si registró disparos reales se respetan. Un DQ con armas registradas es data válida de consumo.
- Devuelve `{matchCount, totalExtras, totalMinShots, avgExtras}` con `extras = rounds_fired - min_shots`.

**Tiers de "disparos extra"** (`getAmmoExtrasTier`, en %):

- `0 extras` → **perfect** (verde).
- `(0%, 5%]` → **neutral** (1–2 disparos en 45 es ruido normal).
- `(5%, 15%]` → **warning** (amber).
- `> 15%` → **danger** (rojo — muchas fallas o muchos repasos).
- Negativos (rounds_fired < min_shots, físicamente raro pero posible si el tirador subreporta) caen en **neutral** — no son una mejor eficiencia ni un error.
- En % y no en absoluto para que un IPSC de 150 disparos con +7 (4.6%) no aparezca peor que un FBI con +3 (6.6%).

**Stage stats** (`computeStageStats`, sobre stage_results no-DQ del usuario):

- Filtra DQs y stages sin `place`.
- `scoredStages`: total contabilizado.
- `winRate`: `% stages con place === 1`.
- `podiumRate`: `% stages con place 1..3`.
- `penaltyRate`: `% stages con penalties > 0`. **Null** si ningún stage del usuario tiene `penalties` no-null (caso normal para FBI y Steel — no las registran).
- `bestStagePercentage`: mayor `stage_percentage` registrado.

**Agregados por disciplina/división**:

- `byDiscipline`: cuenta torneos únicos por disciplina (sobre el set deduped).
- `byDivision`: desglose por división (sobre todos los entries, sin dedup).
- Ambos ordenados por `count desc`. `topDiscipline` / `topDivision` = primer elemento.

`MatchTimelinePoint` expone `matchPercentage`, `place`, `totalInDivision`, `percentile`, `hits`, `isDq`, `isAbsent` etc., apto para graficar.

### 7.4 Armas (firearms)

Catálogo del usuario en `firearms` (RLS por `owner_user_id`). Acciones en `src/lib/actions/firearms.ts`, queries en `src/lib/db/firearms.ts`.

**Campos**: `name` (obligatorio), `brand`, `model`, `caliber`, `notes`. Todos los strings se normalizan con `trimOrNull` (vacío → null).

**Asignación por match**: tabla `match_firearm_log` con `match_entry_id` como **PK lógico** (upsert con `onConflict: "match_entry_id"`). Es decir: **un arma por match_entry** (por par `shooter+match+division`). Si el tirador corrió dos divisiones del mismo match, puede asignar un arma distinta a cada `match_entry`.

`setMatchFirearm`:

- Si `firearm_id` viene vacío → **borra** el log existente (semántica "no recuerdo / no aplica"). Sólo loguea `match_firearm.clear` si efectivamente había un log antes.
- Si viene con `firearm_id` → upsert con `rounds_fired`, `ammunition_type_id` (opcional, nullable), `notes`. Valida `rounds >= 0` (acepta 0 explícitamente). Loguea `match_firearm.set` con snapshot before/after y nombres resueltos.

**Estimación de rounds** (`src/lib/firearms/estimate-rounds.ts`) — solo pre-fill, el usuario puede sobreescribir:

- **Tiro FBI**: **45** (determinístico, 8 tiradas × 5 tiros + 5 warmup).
- **Steel**: `stages_importados × 25` (5 strings × 5 platos por stage). **Ignora misses, es un piso**. Si no hay stages, devuelve null.
- **IPSC**: null (round counts varían por diseño de stage).
- **Otras**: null.

**Log de uso manual** (`firearm_usage_log`): sesiones de práctica/entrenamiento fuera de torneos. Requiere `used_on` (fecha) y `rounds_fired > 0` (estrictamente positivo, a diferencia del match-log que acepta 0). `ammunition_type_id` opcional.

**Stats agregadas** (`listFirearmUsageStats`): suma **AMBAS** fuentes — `match_firearm_log` (torneos) + `firearm_usage_log` (manual). Expone `totalMatches` y `totalSessions` separados, pero `totalRounds` y `lastUsedDate` son la unión.

**QR code feature**: cada firearm tiene un código corto (6 caracteres del alfabeto sin ambigüedades `ABCDEFGHJKMNPQRSTUVWXYZ23456789`) generado por la función `gen_firearm_qr_code()` como DEFAULT de la columna `qr_code`. Se imprime en stickers físicos; la ruta pública `/q/[code]` resuelve el code vía RPC `resolve_firearm_qr_code` y redirige (con `requireUser`+`returnTo`) a la página del arma.

### 7.5 Munición (ammunition)

Catálogo en `ammunition_types` (RLS por `owner_user_id`). Acciones en `src/lib/actions/ammo.ts`, queries en `src/lib/db/ammo.ts`.

**Campos**:

- `name` (obligatorio), `type` ∈ `{"factory", "reload"}` (obligatorio, CHECK en DB).
- `caliber`, `brand`, `bullet_type`, `powder`, `notes` (strings con `trimOrNull`).
- `bullet_weight_grains`, `powder_charge_grains`, `power_factor_measured` (numéricos, no-negativos; acepta coma decimal `es-AR`; null si vacío o inválido).
- `power_factor` ∈ `{"Min", "Maj"}` o null.

**Vínculo con consumo**: a través de `match_firearm_log.ammunition_type_id` (nullable; mantiene compat con logs viejos) y `firearm_usage_log.ammunition_type_id` (nullable). NO está atada a un firearm específico — es un catálogo paralelo.

**Borrado**: el FK `match_firearm_log.ammunition_type_id` está con **`ON DELETE SET NULL`**, así que los logs históricos quedan desvinculados pero no se destruyen.

**Stats por tipo** (`listAmmoUsageStats`): cuenta `totalMatches` y `totalRounds` desde `match_firearm_log` (descarta rows con `ammunition_type_id is null`); `lastUsedDate` desde el `matches.date` del match más reciente.

**Historial** (`listAmmoHistory`): a diferencia del historial de arma, también muestra qué arma se usó con esta munición — los recargadores suelen tener munición específica por arma.

### 7.6 Audit log

Tabla `audit_log`. RLS: `auth.uid() = user_id` (cada usuario sólo ve lo suyo). Acciones canónicas como `<entidad>.<verbo>` (`src/lib/audit/log-action.ts`):

| Constante | `action` | Qué registra |
|---|---|---|
| `MATCH_IMPORT` | `match.import` | Import de match: `{match_name, discipline_name, entries_count, stages_count}` |
| `MATCH_DELETE` | `match.delete` | Borrado: `{match_name, match_date}` |
| `MATCH_UPDATE_CLUB` | `match.update_club` | Cambio de `region`: `{match_name, before:{region}, after:{region}}` |
| `MATCH_UPDATE_MIN_SHOTS` | `match.update_min_shots` | Cambio de `min_shots`: `{match_name, before:{min_shots}, after:{min_shots}}` |
| `SHOOTER_CLAIM` | `shooter.claim` | Claim: `{shooter_full_name, match_id?, match_name?}` |
| `SHOOTER_UNCLAIM` | `shooter.unclaim` | Unclaim: `{shooter_full_name}` |
| `FIREARM_CREATE` | `firearm.create` | `{name, brand, model, caliber}` |
| `FIREARM_UPDATE` | `firearm.update` | `{name, before, after}` (snapshots completos) |
| `FIREARM_DELETE` | `firearm.delete` | Snapshot completo previo al borrado |
| `MATCH_FIREARM_SET` | `match_firearm.set` | `{match_id, match_name, before, after}` con nombres resueltos |
| `MATCH_FIREARM_CLEAR` | `match_firearm.clear` | `{match_id, match_name, before}` |
| `ENTRY_UPDATE_ABSENT` | `entry.update_absent` | `{shooter_full_name, match_id, match_name, after:{is_absent}}` |
| `AMMO_CREATE` | `ammo.create` | `{name, type, caliber, brand}` |
| `AMMO_UPDATE` | `ammo.update` | `{name, before, after}` |
| `AMMO_DELETE` | `ammo.delete` | Snapshot previo: `{name, type, caliber, brand}` |
| `FIREARM_USAGE_CREATE` | `firearm_usage.create` | `{firearm_id, firearm_name, used_on, rounds_fired, ammunition_name}` |
| `FIREARM_USAGE_DELETE` | `firearm_usage.delete` | Snapshot previo |

**Best-effort**: si el insert falla, se loguea `console.warn` pero **no se propaga el error** — la acción del usuario nunca debe romperse por un fallo de auditoría.

**Paginación** (`listAuditLog`): default `pageSize = 50`, ordenado por `created_at desc`, devuelve `{rows, total, pageSize}` para que la UI muestre "Página X de Y". Aunque la RLS ya filtra por usuario, la query también filtra por `user_id` explícitamente para usar el índice `(user_id, created_at desc)`.

**Render** (`describeAuditEntry` en `src/lib/audit/render.ts`): convierte cada row en `{summary, detail?, link?}`. Ejemplos del mapping action → texto:

- `match.import` → `Importaste el match "X"` · `disciplina · N tiradores · M stages` · link `/matches/{id}`.
- `match.update_club` → `Cambiaste el club de "X"` · `RA → RB`.
- `shooter.claim` → `Asociaste a tu cuenta el tirador "X"` · `desde "match"`.
- `firearm.update` / `ammo.update` → summary con el `name` post-update + `describeDiff(before, after)` que lista solo los campos que cambiaron en formato `campo: "viejo" → "nuevo"`. Valores `null/undefined` se renderizan como `—`.
- `entry.update_absent` → `Marcaste como ausente a "X"` o `Quitaste la marca de ausente a "X"` (según `after.is_absent`).
- `match_firearm.set` → `Asignaste "Arma" a "Match"` · `N tiros`.
- Acción desconocida → fallback: summary = el `action` crudo.

### 7.7 Feedback

Workflow en `src/lib/actions/feedback.ts` + `src/lib/db/feedback.ts`. Tabla `feedback` (RLS: `user_id = auth.uid()` para insertar).

**Tipos** (`FeedbackType`): `"bug" | "suggestion" | "other"`. Validado server-side contra `VALID_TYPES`.

**Estados** (columna `status` de la tabla): `new | triaged | in_progress | done | wontdo | duplicate`. Sólo el admin los muta; el usuario los ve en `/about` para conocer el estado de sus reportes.

**Validación de mensaje**:

- `MIN_LENGTH = 10` caracteres (post-trim).
- `MAX_LENGTH = 4000` caracteres.
- `page_url` opcional (la página desde donde se reportó).

**Gate `FEEDBACK_MIN_ENTRIES = 3`**: el usuario tiene que tener ≥ 3 `match_entries` (vía `countMyMatchEntries`) para poder reportar. **Filtra reportes prematuros** de gente que recién está probando la app sin haber importado un match real. Es **defense-in-depth**: la UI ya esconde el form pero un cliente malicioso podría postear igual el form.

**`admin_note`**: campo en `feedback` que escribe el admin cuando triaja/responde. Visible para el usuario que reportó.

**Quién ve qué**:

- Usuario: lista solo lo suyo (`listMyFeedback` filtra por `user_id` — la RLS también restringe).
- Admin: ve todo (vía RPCs / vistas de admin no incluidas en los archivos leídos).

### 7.8 Clubes

Tabla `clubs` con columnas `code` y `name`. Helpers en `src/lib/clubs.ts`.

- Son **seedeados** (no user-creatable desde la UI). La fuente de verdad es la tabla en DB.
- Se vinculan a matches indirectamente: el `matches.region` guarda el código en formato PractiScore (`ARG-TFALP`, `TFALP-ARG`, `TFALP`, o vacío). `parseRegion` extrae country (set `{"ARG"}`) y `clubCode`. `getClubName(region, lookup)` resuelve `code → name`; si el code no está en el catálogo (región custom, club extranjero), cae al code crudo.
- `buildClubLookup(clubs)` arma un `ReadonlyMap<code, name>` para no reconsultar la DB por cada match en una lista.

### 7.9 Validaciones cruzadas / invariantes

- **`shooters.linked_user_id` único por shooter** (un shooter pertenece como máximo a un usuario). Un usuario puede tener N shooters (multi-identidad). Enforce por la operación atómica `.update(...).is("linked_user_id", null)` que no afecta filas si la columna ya está poblada.
- **`match_firearm_log.match_entry_id` único** (un arma por match_entry). Enforce por `upsert(..., {onConflict: "match_entry_id"})`.
- **`match_firearm_log` referencia un `match_entry`** que a su vez referencia un `shooter+match+division`. Por transitividad, sólo existe log para shooters que efectivamente participaron de ese match.
- **`match_firearm_log.ammunition_type_id` es nullable** y con **`ON DELETE SET NULL`** — borrar un tipo de munición desvincula los logs históricos pero no los destruye.
- **DQ y ausentes no contribuyen a promedios** (`avgPercentage`, `bestPercentage`, `consistency`, `trajectorySlope`, `avgPercentile`, `byDiscipline`). **Sí cuentan** en `totalMatches` (audit del historial completo) y **sí cuentan** para eficiencia de munición (la munición se gastó realmente).
- **Stage stats excluyen DQ y stages sin `place`** (datos parciales).
- **`penaltyRate` es null cuando ningún stage del usuario tiene `penalties` no-null** (caso normal para FBI y Steel; sólo IPSC las registra).
- **`hits` sólo en hits-based**: en `MatchTimelinePoint` se setea desde `e.hits`, que el parser deja null en IPSC/Steel y poblado (0..40 a nivel match, 0..5 a nivel stage) en FBI.
- **`totalTimeSeconds` sólo en time-based** (Steel/Combat); null en IPSC.
- **`hasUsefulAliases` gate de sugerencias**: con un solo token de nombre y sin member_number, NO se sugieren candidatos.
- **Audit log es best-effort**: nunca rompe la acción del usuario aunque falle el insert.
- **`createFirearmUsage` exige `rounds_fired > 0`** (estrictamente positivo); en cambio `setMatchFirearm` acepta `rounds_fired >= 0`. Es una asimetría intencional.
- **Feedback gate** (`FEEDBACK_MIN_ENTRIES = 3`) se valida server-side independientemente de la UI.
- **El audit log de claim auto-resuelve `match_name`** si vino con `match_id`, para que la línea del activity diga `desde "Social 4 - 19/04/26"` en lugar del UUID.
- **El audit log de match-firearm auto-resuelve nombres** de arma + munición vía queries adicionales — para que `/activity` no quede con IDs crudos.

---

## 8. Importación de matches y parsers

### 8.1 Formatos soportados

HitFactor acepta ocho variantes de archivo, cada una con su propio parser dedicado bajo `src/lib/parsers/`. El punto de entrada es `parseFile(content)` para texto (HTML / CSV) o `parsePdf(data, filename)` para PDF (binario, async porque `unpdf` se carga dinámicamente). Cada parser devuelve la misma estructura `ParsedMatch { discipline, source, name, date, region, matchEntries, stages, generatedBy }` para que el importer downstream sea agnóstico del origen.

| Formato | Origen | Disciplinas | Qué importa | Notas |
|---|---|---|---|---|
| PractiScore HTML (combined / by-division) | ipsc.org.ar exports | IPSC | Tiradores + match overall (un archivo único con `Match Results - Combined` o varias secciones `Match Results - X`) | `source = practiscore_combined_html` o `practiscore_match_html`. División se prefiere por título de sección, no por columna `Div` de la fila (el organizador la configura libremente en PractiScore). |
| PractiScore Stage HTML | ipsc.org.ar exports | IPSC | Un único stage del torneo, particionado por división | `source = practiscore_stage_html`. Necesita que el match overall ya esté importado; se mergea al match existente vía `resolveMatchForStage`. |
| WinMSS PDF (overall + stages) | ipsc.org.ar históricos | IPSC | Overall por división, stages por (división × stage), y la página de "Disqualified Shooters" | `source = winmss_pdf`. Soporta WinMSS clásico (español, decimales con coma) y la variante ESS / Electronic Scoring System (inglés, decimales con punto, headers `X - Results Overall` / `X - Results by Stage`). Overall y stages se suben como archivos separados; el segundo mergea contra el primero. |
| PractiScore PDF (overall + stages) | App PractiScore (Android/iOS) | IPSC | Overall por división; stages (1 página por stage, con secciones por división) | `source = practiscore_pdf`. Footer `Generated by PractiScore`; headers `Match Results - X` / `Stage Results - X`; decimales en-US, `%` en Match%/Stage%; fecha ISO en el título; DQ con prefijo `(DQ)`. Overall y stages se suben por separado; el segundo mergea. Si el título de un stage no trae número (caso real "Campo 4B"), se infiere por orden de página, o stage anterior + 1; si ambos candidatos ya existen, aborta. |
| Tiro FBI CSV | Google Sheets → Descargar como CSV | Tiro FBI | Match overall + 9 stages (1 Práctica que no suma + 8 que sí) | `source = fbi_csv`. Una fila por (tirador, disciplina); divisiones derivadas de la columna `Disciplina` (Pistola/Revólver/Minirifle/PCC). Ranking primario por impactos DESC, tiebreak por puntos DESC. `min_shots` se fuerza a 45 en DB. |
| FAT PDF | Federación Argentina de Tiro - "Ranking Oficial" | FBI / IPSC / Steel / Combat (best-effort) | Sólo match overall: posición, nombre, impactos / puntos. **No** trae stages, club ni fecha | `source = fat_pdf`. La disciplina se infiere del **nombre del archivo** (ej. `resultados-apertura-fbi.pdf`); si no matchea exactamente una keyword conocida, se rechaza el import. La fecha falta — el flujo de import abre un segundo paso `needsDate`. |
| Steel Challenge HTML | PractiScore | Steel Challenge | Match overall + stages embebidos como columnas en la misma tabla por división (1 archivo único) | `source = practiscore_steel_html`. Scoring time-based (menor tiempo = 100%), sin power factor ni hit factor. Columnas de stage se reconocen con el patrón `^\s*(\d+)\s*:\s*(.+?)\s*$` (ej. `1: Cancha 3`). |
| Steel Challenge PDF (por stage) | PractiScore iPhone | Steel Challenge | Un stage por archivo (`Stage Results - By Division`); se suben los N PDFs juntos en un mismo import para computar el overall | `source = practiscore_steel_pdf`. Variante PDF del reporte de Steel Challenge; único formato que acepta múltiples PDFs en una sola subida (`parsePdfBatch`). |

### 8.2 Pipeline general

Punto de entrada: el server action `importHtml(prevState, formData)` en `src/app/(app)/import/actions.ts` (atado al form vía `useActionState`).

Pasos:

1. **Validación de archivo**: el form acepta `accept=".html,.htm,.csv,.pdf"`. En el server, la action verifica que sea un `File` con `size > 0` y que la extensión matchee `/\.pdf$/i` o `/\.(html?|csv)$/i`. Cualquier otra cosa → `redirectWithError("/import", "Solo se aceptan archivos HTML, CSV o PDF")`.
2. **Lectura del campo opcional `min_shots`** (ver `parseMinShotsField`): se acepta sólo entero positivo; vacío o inválido → `null`.
3. **Autenticación**: `requireUser()` resuelve `{ supabase, user }`. El RLS exige `imported_by_user_id = auth.uid()`.
4. **Parseo**:
   - PDF: `parsePdf(buffer, filename)` → `extractPdfPages` (basada en `unpdf` + reconstrucción posicional, agrupa items por Y con tolerancia 2pt y ordena por X) → discrimina WinMSS vs FAT vs error.
   - Texto: `parseFile(content)` → discrimina FBI CSV vs HTML (PractiScore IPSC o Steel).
   - Excepciones del parser → `redirectWithError("/import", e.message)`.
5. **Validación post-parse**: `parsed.name` debe existir; `parsed.date` debe existir, salvo el caso especial `parsed.source === "fat_pdf"` donde se retorna estado `needsDate` con el `ParsedMatch` serializado en el state del action (segundo submit lo completa con `confirmFatImport`).
6. **Import a DB** (`importParsedMatch` en `src/lib/import/import-match.ts`):
   - Resuelve `discipline` + `divisions` por código a IDs.
   - Decide si es **stage import** (`parsed.stages.length > 0 && parsed.matchEntries.filter(e => !e.isDq).length === 0`) o **match overall**. La condición es deliberada para que la página "Disqualified Shooters" de los PDFs WinMSS stages (que el parser captura como entries con `isDq=true`) no haga interpretar el archivo como overall.
   - **Match overall** → `importMatchOverall`:
     - `findUserMatch` busca un match propio del usuario por `(discipline_id, name, date)` **ignorando region** y filtrando por `imported_by_user_id`. Si lo encuentra: re-upload — se hace UPSERT idempotente de `match_entries` y, si vienen stages embebidos (Steel), `attachStagesToMatch`. Si no, INSERT en `matches` con `source_type`, `source_filename`, `imported_by_user_id`, `min_shots` (FBI siempre `45`, resto usa lo del form o `null`). `min_shots` solo se setea en el primer INSERT; nunca se sobreescribe en re-uploads.
     - Si el INSERT pega contra la unique constraint (código `23505`), se reporta `MATCH_ALREADY_EXISTS`.
   - **Stage import** → `importStages`:
     - `resolveMatchForStage`: exact match por `(name limpio sin sufijo de stage, date, discipline_id)` y, si falla, `findBestPrefixMatch` entre los matches del mismo día/disciplina.
     - Si el match resuelto no es del usuario actual → `NOT_MATCH_OWNER`.
     - Si el archivo trae entries (DQs de WinMSS), se mergean con `upsertMatchEntries`.
     - `attachStagesToMatch` hace bulk-upsert de `stages` (por `match_id + stage_number`) y `stage_results` (con `onConflict: "stage_id,match_entry_id"`).
7. **Upsert de tiradores** dentro de cada paso de import (`resolveShootersBulk`):
   - Paso 1: dedup por `shooterCacheKey = lowercase(fullName) + "|" + memberNumber`.
   - Paso 2: bulk `SELECT … WHERE member_number IN (...)`. El número de socio gana sobre el nombre (sobrevive a typos como "Stoker"/"Stocker").
   - Paso 3: bulk `SELECT … WHERE full_name IN (...)` (case-sensitive).
   - Paso 4: fallback per-row a `findOrCreateShooter`, que usa `ilike` (case-insensitive) e inserta si no existe.
   - En todos los lookups por número o por nombre, si hay múltiples candidatos en DB se prefiere el linkeado a un usuario y, como tiebreak, el más antiguo (`order linked_user_id desc nullsFirst:false, created_at asc`).
8. **Auditoría**: `logImport` → `logAction(supabase, userId, { action: AUDIT_ACTION.MATCH_IMPORT, entityType: "match", entityId: result.matchId, metadata: {...} })`.
9. **Redirect de resultado**: `redirectToResult(result)` → `/import?ok=1&matchId=…&name=…&discipline=…&entries=…&stages=…&stageResults=…&existed=0|1`. La página `/import/page.tsx` lee esos query params, muestra un `Alert` de éxito y dispara `findClaimCandidates(supabase, userId, matchId)` para sugerir "Soy yo".

### 8.3 Selector de parser

Hay dos selectores, uno para texto y otro para binario:

`parseFile(content)` (`parsers/index.ts`):

1. `isFbiCsvFormat(content)`: parsea las primeras 10 líneas como CSV (`parseCsvRow`) y, si alguna fila contiene **todos** los headers requeridos (`tirador, club, categoría, disciplina, impactos, puntos`, comparados normalizando NFC + lowercase + trim), devuelve `true` → `parseFbiCsv`.
2. En otro caso, `parseHtml(content)`:
   - `isSteelChallengeFormat(html)`: `true` si matchea `/Match\s+Results\s*-\s*By\s+Division/i` **o** `/Steel\s+Challenge/i`. → `parseSteelChallengeHtml`.
   - Default: `parsePractiscoreHtml` (IPSC).

`parsePdf(data, filename)` (`parsers/index.ts`):

1. `extractPdfPages(data)` levanta `unpdf` dinámicamente, obtiene `getTextContent()` por página y reconstruye texto por posición (agrupando items por Y con tolerancia 2pt, ordenando por X, deduplicando glyphs simulados como bold dentro de `X_DEDUP_TOL = 2`).
2. `fullText = pages.map(p => p.text).join("\n")`.
3. `isWinmssFormat(fullText)`: requiere `(/Overall\s+(Match|Stage)\s+Results/i || /-\s+Results\s+(Overall|Stage\s+\d+|by\s+Stage)/i)` **AND** `/Printed[:\s]+[A-Za-záéíóúñ]+\s+\d{1,2}/i` (mes con o sin colon). Si matchea → `parseWinmssText(pages)`.
4. `isFatPdfFormat(fullText)`: requiere el header `/RANKING\s+OFICIAL/i` **AND** al menos 3 líneas que matcheen `ROW_RE = /^(\d{1,3})\s*[.)]?\s+(.+?)\s+(\d{1,4})\s*\/\s*(\d{1,5})$/`. Si matchea → `parseFatText(fullText, filename)` (necesita `filename` para inferir la disciplina).
5. En otro caso → `throw new Error("No reconocemos el formato de este PDF…")`.

No se mira el MIME type. Tampoco hay hint por extensión más allá del filtro grueso PDF / HTML+CSV en la action.

### 8.4 Heurísticas clave por parser

#### `shared.ts` (helpers transversales)

- `stripDqPrefix(name)`: detecta el prefijo `(DQ)` de PractiScore con `/^\(DQ\)\s*(.+)$/`.
- `stripNameSuffixes(name)`: dos pasadas alternadas hasta converger — (A) elimina paréntesis terminales con `/\s*\([^)]*\)\s*$/`, (B) elimina tokens trailing conocidos del set `TRAILING_NOISE_TOKENS` (regiones `ARG/CAN/USA/URU/CHI/BRA/PAR/BOL`, roles ICS `RO/ICS/OC/MD/RM/ST/ASM`, categorías multi-letra `SS/GS`, divisiones `OPEN/PRODUCTION/STANDARD/CLASSIC/REVOLVER/PCC/PCCO/REV/PIS/MINI/SM/PO/CO/MS/CL` y los markers `ESC/1TH`). Letras sueltas como `S/J/L` NO están en el set: el riesgo de pisar una inicial real del nombre es demasiado alto.
- `extractClubFromTitle(title)`: busca un token uppercase de 3–8 caracteres al inicio (`/^([A-Z][A-Z0-9]{2,7})\s/`) o al final (`/\s([A-Z][A-Z0-9]{2,7})$/`). No valida contra el catálogo; el usuario corrige desde el match-detail si el código no es real.
- `pickMostCommon(values)`: moda de la lista (ignora `null`). FBI lo usa para inferir `region` desde la columna `Club` mayoritaria entre los tiradores.

#### `practiscore.ts` (IPSC HTML)

- Distingue tres `source`s observando la lista de secciones detectadas:
  - Si hay alguna sección `stage` (cabecera `Stage Results - X`) → `practiscore_stage_html`. Todas las secciones de stage en un archivo pertenecen al **mismo** stage, particionadas por división; el `stage_number` se extrae del `<h3>` con `STAGE_NUMBER_RE = /(?:Stage|Ejercicio|Ej\.?|Stand|St\.?|Etapa|Match)\s+(\d+)/i`.
  - Sección única `match` con título que matchee `/combined/i` → `practiscore_combined_html`.
  - El resto → `practiscore_match_html`.
- Las secciones se extraen con `extractDivisionalTableSections` (recorre `<tr>` particionando en `<td class="division_head">`).
- `divisionCode` se prefiere desde el **título** de la sección, mapeado por `DIVISION_CODE_BY_TITLE` (normalizado NFD + uppercase + trim) — más estable que la columna `Div` de cada fila. Para secciones "Combined" se cae a `get("Div")`.
- Fecha y nombre: `TITLE_DATE_RE = /-\s*(\d{4}-\d{2}-\d{2})\s*$/` aplicado a `<h3>` o `<title>`.
- `isAbsent`: `!isDq && matchPoints === 0 && matchPercentage === 0`.

#### `steel-challenge.ts`

- Cada `<td class="division_head">` no vacío abre una sección — el texto de la cabecera es directamente el `divisionCode` (no hay mapa).
- Columnas de stages: cualquier header que matchee `STAGE_HEADER_RE = /^\s*(\d+)\s*:\s*(.+?)\s*$/` (ej. `1: Cancha 3`); el stage se identifica por `${stageNumber}:${label}`.
- Una fila genera un `ParsedMatchEntry` (con `totalTimeSeconds` y `match %`) más un `ParsedStageResult` por celda no-null. Ranking por stage: menor tiempo gana, `stagePercentage = winnerTime / r.timeSeconds * 100`. DQs van al final con `place=0` y `percentage=0`.
- `memberNumber` puede venir como columna `USPSA#` o `No.`.

#### `winmss-pdf.ts`

- Detecta tres formatos de página dentro del mismo PDF:
  - WinMSS clásico: `([A-Z][A-Z\s]*?)\s*--\s*Overall\s+(Match|Stage)\s+Results/i` con filas de 5 columnas (overall) u 8 columnas (stage), decimales con coma.
  - ESS overall: `([A-Z][A-Z\s]*?)\s+-\s*Results\s+Overall(?!\s+Stage)/i`, decimales con punto.
  - ESS by-stage: `([A-Z][A-Z\s]*?)\s+-\s*Results\s+by\s+Stage/i` con subheader `Stage <Div> - Stage NN`, filas de 5 columnas (no expone hits/time/factor crudos).
- `DIVISION_NAME_TO_CODE` mapea el header de sección al code de DB. Variantes `SG <X>` (Shotgun) reusan los códigos genéricos por decisión de producto. Si la división no matchea, la página se descarta silenciosamente con warning. Lookup se intenta también colapsando espacios (`divisionRaw.replace(/\s+/g, "")`) para tolerar kerning quebrado por `unpdf` (`P` + `ISTOLA`).
- **Extracción del nombre del match**: cambió de "la línea más larga gana" a "**primera línea que pasa todos los filtros**". El parser stripea inline los markers conocidos (`Overall (Match|Stage) Results`, `Stage N -- Etapa N`, `Printed …`, `World Classification System (used)`, `User Defined Classification (used)`, `ESS - Electronic Scoring System`, `Page N`, `N of M`, `2026 21:33:24`, ESS results headers, subheader by-stage), descarta filas tabulares (`/^\s*\d+\s+\d/`, filas DQ `\sDQ\s*$/i`), descarta líneas con ≥3 tokens del set `["Points", "Competitor", "Stage", "Factor", "Percent"]` (artefacto column-major de `unpdf`), y se queda con la primera línea sobreviviente. Después aplica `dedupeTitle` para colapsar repeticiones (`"TFABA 1er SOCIAL ESCOPETATFABA 1er SOCIAL ESCOPETA"`).
- **Fecha**: prioridad 1 es la fecha embebida en el título con shape `DD MES YYYY` (`/\b(\d{1,2})\s+([A-Za-záéíóúñ]+)\s+(\d{4})\b/`) usando `SPANISH_MONTHS` o `ENGLISH_MONTHS`. Prioridad 2 es la fecha de impresión `/Printed[:\s]+([A-Za-záéíóúñ]+)\s+(\d{1,2}),?\s+(\d{4})/i` (que puede ser días después del torneo real).
- **Split nombre vs metadata** (`splitNameFromMeta`): camina desde el final de la fila recogiendo tokens conocidos contra sets explícitos (`KNOWN_CATEGORIES = {S, SS, GS, J, L}`, `KNOWN_REGIONS = {ARG, CAN, USA, BRA, URU, CHI, PAR, BOL}`, `KNOWN_CLASSIFICATIONS = {GM, M, A, B, C, D, U}`, `KNOWN_ICS = {RO}`, `KNOWN_TAGS = {MD, RM, ST, ASM}`). El primer token que no pertenece a ningún set frena la cosecha — evita confundir un apellido en mayúsculas con metadata. `stripNameSuffixes` corre como red de seguridad después.
- `region` del match no se toma de la columna "Reg" (que es la federación IPSC del tirador) sino de `extractClubFromTitle(matchName)`.
- Página "Disqualified Shooters" (WinMSS clásico): no tiene division header — la división viene en la fila (`<bib> <Division> <Apellido>, <Nombre>`). Se resuelve greedy contra `DIVISION_NAME_TO_CODE` probando primero 3 palabras, después 2, después 1.

#### `fbi-csv.ts`

- Detección: las primeras 10 líneas se parsean como CSV; si alguna fila contiene **todos** los headers requeridos (`tirador, club, categoría, disciplina, impactos, puntos`, normalizados NFC + lowercase + trim) → es FBI.
- Mapeo de divisiones (columna `Disciplina` del CSV → code DB): `{ pistola: "PIS", revolver|revólver: "REV", minirifle: "MINI", pcc: "PCC" }`.
- Stages: se detectan recorriendo `STAGE_LABELS` (`Práctica` → stage 0; `Tirada 1..8` → stages 1..8). Cada stage ocupa **5 columnas consecutivas** desde el índice del header (5 disparos puntuados 0–10). `parseShot` acepta enteros 0–10 (con `Math.trunc` para `10.0`); cualquier no-numérico no vacío en una celda activa `hasNonNumericMarker → isDq` para ese stage (caso `F4D`).
- `Puntos` del CSV = suma de los 8 stages que cuentan (sin Práctica); `Impactos` = cantidad de disparos no-cero en esos 8 (max 40).
- **Ranking primario por impactos DESC, tiebreak por puntos DESC**. `matchPercentage = (puntos / winnerPuntosDeLaDivision) * 100`.
- Si un mismo nombre aparece varias veces en la misma división, se preserva el de mayor `puntos` (defensa contra el UNIQUE de la DB).
- Título y fecha: rows arriba del header se escanean buscando `/^(.*?)\s*-\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*$/` (ej. "Social 4 - 15/03/26"). Year de 2 dígitos se asume `20XX`. Fallback: `{ matchName: "Match FBI", date: today() }`.
- `region` del match: `pickMostCommon(matchEntries.map(e => e.shooter.region))` (Club más frecuente), fallback `extractClubFromTitle`.
- `min_shots` se ignora para FBI: el importer fuerza `45`.

#### `fat-pdf.ts`

- Detección: `/RANKING\s+OFICIAL/i` + ≥ 3 filas `ROW_RE = /^(\d{1,3})\s*[.)]?\s+(.+?)\s+(\d{1,4})\s*\/\s*(\d{1,5})$/` (place, nombre, impactos, puntos).
- **La disciplina viene del filename**, no del contenido. `detectDisciplineFromFilename` normaliza (NFD, lowercase, replace non-alnum por espacio) y matchea contra `[{keyword: /\bfbi\b/, ...}, {keyword: /\bipsc\b/, ...}, {keyword: /\b(steel|steelchallenge)\b/, ...}, {keyword: /\bcombat\b/, ...}]`. Si matchean 0 o 2+ → throw con mensaje accionable.
- Secciones: una sección es un header (no-fila) seguido de filas. El header de una sección es la **última** línea no-ignorable que NO es fila antes de que empiecen las filas. `isIgnorableLine` descarta `RANKING OFICIAL`, `PAGINA *`, y líneas que son solo dígitos.
- `classifyHeader`: longest-prefix match (3→2→1 tokens) contra `DIVISION_NAME_TO_CODE[discipline]`. Lo que sobra después de la división es la `category` (`GENERAL` o vacío → null). Solo el set FBI (`PISTOLA → PIS, REVOLVER → REV, MINIRIFLE → MINI, PCC → PCC`) está verificado contra archivos reales; los demás son best-effort.
- Una sola sección "GENERAL" por división aporta los `match_entries`; las secciones subranking (`VETERANO, DAMAS, CADETE...`) solo aportan la `category` al tirador (por `accentFoldedName(name)`). El "ranking canónico" por división es la sección con **más filas** — la `GENERAL` es siempre el superconjunto.
- `matchEntries`: el ranking ya viene ordenado en el PDF. `matchPercentage = (row.points / winnerPoints) * 100`. `hits` solo se setea para disciplinas hits-based (FBI); para IPSC/Steel/Combat queda `null`.
- **Sin fecha en el archivo**: se intenta `dateFromFilename` (formatos `YYYY-MM-DD` o `DD-MM-YYYY` con o sin separadores); si falla, el flujo de import bloquea en estado `needsDate` y la pide al usuario.
- `matchNameFromFilename`: saca extensión, palabra de disciplina, palabras de ruido (`FILENAME_NOISE = /\b(resultados?|ranking|oficial|fat)\b/gi`), tokens numéricos de 2–4 dígitos; title-case del resto. Fallback `"Match FAT"`.

### 8.5 Asociación stage → match (`resolveMatchForStage` + `findBestPrefixMatch`)

Solo aplica al stage import (PractiScore Stage HTML, WinMSS stages PDF):

1. **Exact match**: `stripStageSuffix(parsed.name)` aplica `/\s*[-–—]\s*(Stage|Ejercicio|Ej\.?|Stand|St\.?|Etapa|Match)\s+\d+(?:\s*\([^)]*\))?\s*$/i` para quitar el sufijo de stage del título y se busca `(discipline_id, name limpio, date)`.
2. **Forward prefix**: entre los matches del mismo `(discipline_id, date)`, se busca aquel cuyo `name` es prefijo (case-insensitive, sin acentos) del título del stage, con separador en `[" ", "-", " -", " –", " —"]` (incluye en-dash y em-dash). Gana el `name` **más largo** (más específico).
3. **Reverse prefix** (fallback): el título limpio del stage es prefijo del `name` del match — cubre el caso "el usuario renombró el match después del import original con un sufijo distintivo". Se acepta **solo si hay exactamente 1 candidato**; múltiples se rechazan como ambiguos.

Si nada matchea → `MATCH_NOT_FOUND` con hasta 5 matches del mismo día como parámetro del mensaje (`…` al final si hay más), o `MATCH_NOT_FOUND_NONE_THAT_DAY` si no hay ninguno. Si matchea pero `imported_by_user_id !== userId` → `NOT_MATCH_OWNER`.

### 8.6 Dedupe y resolución

**Identidad de match** (`findUserMatch`): `(discipline_id, name, date, imported_by_user_id)` — **ignora region**. Cubre dos casos de re-upload:

- Re-upload del mismo archivo (region coincide).
- Re-upload tras editar el club desde la UI (region cambió en DB pero el archivo trae la original o `null`).

Si se identifica como re-upload:

- `match_entries`: UPSERT con `onConflict: "match_id,shooter_id,division_id"`. Los entries en DB que no están en el archivo **no** se borran (preserva FK desde firearms y claims).
- `stages`: bulk SELECT por `match_id`, INSERT solo de los `stage_number` nuevos.
- `stage_results`: UPSERT con `onConflict: "stage_id,match_entry_id"`.

Si la unique constraint `(discipline, name, date, region)` rebota en INSERT con código `23505` → `MATCH_ALREADY_EXISTS`.

**Identidad de stage_results**: la unique es `(stage_id, match_entry_id)`. Si el PDF de stages usa un nombre de división distinto al del overall (caso real: TFABA — `PISTOLA` en overall, `PRODUCTION` en stages), el matcher hace un fallback: si el tirador tiene **exactamente 1** `match_entry` en el match (en cualquier división), se usa esa entry. Si tiene > 1 se skipea con warning para no asignar al azar.

**Identidad de shooter** (`resolveShootersBulk` → `findOrCreateShooter`):

- Primario: `member_number` exacto (gana sobre nombre porque sobrevive a typos).
- Secundario: `full_name` exacto (case-sensitive bulk + case-insensitive `ilike` fallback).
- Tiebreak ante múltiples candidatos: `linked_user_id` no nulo gana, después `created_at` ascendente.
- Si no existe → INSERT en `shooters` con `full_name`, `member_number`, `region`.

### 8.7 Asociación con el usuario (match-claim)

Después de un import exitoso, `import/page.tsx` invoca `findClaimCandidates(supabase, userId, matchId)`:

1. **Construcción de aliases del usuario** (`getMyClaimAliases` + `buildClaimAliases`):
   - **Nombres**: `profile.display_name`, `profile.full_name` y `full_name` de **todos** los shooters ya linkeados a este `userId`.
   - **Números**: `profile.member_number` + `member_number` de los shooters linkeados (Set).
2. **Lookup de entries del match**: `match_entries` con shooters cuyo `linked_user_id IS NULL` (los ya claimados por otro usuario se excluyen).
3. **Matching por shooter** (`claimMatchReason`):
   - **Member number**: igualdad exacta del `member_number` trimeado → `reason = "member_number"`. Gana sobre el match por nombre.
   - **Nombre** (`areNamesSimilar`): mismo algoritmo descrito en §5.2.1 — Set containment, ≥ 2 tokens, tolerancia fuzzy Levenshtein ≤ 1 en un solo token con ≥ 4 caracteres.
4. **Bootstrap** (`hasUsefulAliases`): si los aliases no son útiles, `isClaimCandidate` devuelve `true` para todos — habilita el primer claim manual. Este comportamiento solo aplica a `isClaimCandidate` (filtro de la vista pública del match); `findClaimCandidates` (auto-detección post-import) prefiere no sugerir nada antes que sugerir 200 candidatos.
5. **De-dup**: un mismo `shooterId` solo aparece una vez aunque tenga entries en varias divisiones; la `divisionCode` de la `ClaimCandidate` es la primera que el iterador encontró.

Los candidatos se muestran en `/import?ok=1&matchId=…` como Card "¿Sos alguno de estos tiradores?" con botón "Soy yo" que invoca `claimShooter` (server action externa).

### 8.8 Límites y errores conocidos

**Tamaño / forma de archivo**:

- No hay límite explícito de tamaño en código; en la práctica está acotado por `bodySizeLimit: "10mb"` configurado en `next.config.ts` para las Server Actions. `unpdf` se carga dinámicamente (~600 KB) para no inflar el bundle de `/import` hasta que efectivamente se sube un PDF.
- Extensión validada en la action con regex (`/\.pdf$/i` o `/\.(html?|csv)$/i`). El input file en `ImportForm.tsx` usa `accept=".html,.htm,.csv,.pdf"`.
- No hay máximo configurable de stages — el bulk-upsert maneja N en un solo round-trip.

**Reporte de errores**:

- **Capa parser**: `throw new ParserError(code, params?)` (#148). El texto no vive en el parser: la action traduce con `import.parserError.<code>`.
- **Capa import (DB)**: `ImportError(code, params?, detail?)` (#203, mismo criterio). La action traduce con `import.importError.<CODE>`; el catálogo completo de códigos está en [`importing.md`](./importing.md#known-errors-codes). El `detail` lleva el mensaje crudo de Postgres, se loguea en el server y **no** llega al usuario. El error sale como banner rojo en `/import?error=…`. Cualquier `Error` que no sea ninguno de los dos se relanza (500 genuino).
- **Caso especial FAT sin fecha**: en lugar de redirect, el server action devuelve `state = "needsDate"` con el `ParsedMatch` en memoria del state; el form pasa a un segundo paso con `<Input type="date" required>`. Si el segundo submit también falla con `ImportError`, vuelve a la pantalla de fecha con el `error` poblado y el `parsed` preservado (no se vuelve a parsear).

**Casos límite manejados explícitamente**:

- **DQ-only matches**: la condición `isStageImport` exige `realEntries = matchEntries.filter(!isDq)` length 0 — un archivo con solo DQs (página "Disqualified Shooters" de WinMSS stages) se trata como stage import, no como un overall vacío.
- **Empty stages**: `attachStagesToMatch` solo procesa stages con `stageNumber != null`; los `parsed.stages` sin número se ignoran. Si el batch final de `stage_results` queda en 0 filas se evita el upsert.
- **División desconocida en el archivo**: WinMSS skipea la página silenciosamente; FBI skipea la fila; FAT lanza `UNKNOWN_DIVISION` si **ninguna** sección mapea pero acepta el archivo si al menos una mapea.
- **Match sin entries ni stages**: WinMSS aborta con `"El PDF se identificó como WinMSS pero no se pudo extraer ninguna fila de resultados"` en lugar de crear un match vacío.
- **Missing date**: WinMSS aborta (`"No se pudo extraer la fecha del PDF"`), FAT entra a `needsDate`, FBI cae a `today()` como último recurso.
- **Múltiples entries del mismo tirador en el match al asociar stage**: si la división del stage no matchea la del entry pero el tirador tiene exactamente 1 entry en el match, se reusa; si tiene varias, se skipea con `console.warn`.
- **Múltiples shooters en DB con mismo número o nombre**: se prefiere el linkeado a un usuario y, dentro de eso, el más antiguo.
- **PDFs column-major** (`unpdf` extrae celdas en lugar de filas): se aborta con mensaje accionable si ninguna fila parsea.
- **Steel scoring DQ**: tiempo `null` o 0 + `isDq=true` → `place=0`, `stagePercentage=0`.

**No manejados (gold-plating evitado)**:

- No hay validación de discipline match entre archivo y nombre de archivo (FAT confía en el filename; un PDF FBI con nombre `…-ipsc.pdf` se intentaría parsear como IPSC).
- No hay rollback transaccional explícito; se confía en que los UPSERTs son idempotentes y los pasos previos (insert match) son irrecuperables si fallan downstream (el match queda creado, el siguiente re-upload lo va a mergear).

### 8.9 Auditoría del import

El flujo de import emite **un único** evento, vía `logAction`:

- `AUDIT_ACTION.MATCH_IMPORT = "match.import"` con:
  - `entityType: "match"`
  - `entityId: result.matchId`
  - `metadata: { match_name, match_date, discipline_code, discipline_name, entries_count, stages_count, existed_already }`

El flag `existed_already` distingue un import nuevo (INSERT en `matches`) de un re-upload (UPSERT contra match preexistente). El conteo de `entries_count` y `stages_count` es el `insertedEntries` / `insertedStages` devueltos por `importParsedMatch` (que en re-uploads incluye también las filas actualizadas — el código no distingue insert vs update).

Otras acciones del dominio match conviven en `AUDIT_ACTION` pero **no** se emiten desde el pipeline de import: `MATCH_DELETE`, `MATCH_UPDATE_CLUB`, `MATCH_UPDATE_MIN_SHOTS`, `MATCH_FIREARM_SET`, `MATCH_FIREARM_CLEAR` — esos los disparan las acciones de edición del match-detail.

---

## 9. Referencias rápidas

| Tema | Ubicación |
|---|---|
| Schema de DB | `supabase/migrations/0001..0017_*.sql` |
| Disciplinas (constantes y helpers) | `src/lib/disciplines.ts` |
| Stats del tirador | `src/lib/stats/shooter-stats.ts` |
| Audit: vocabulario | `src/lib/audit/log-action.ts` |
| Audit: render | `src/lib/audit/render.ts` |
| Claim suggestions | `src/lib/db/claim-suggestions.ts`, `src/lib/import/match-claim.ts` |
| Parser dispatch | `src/lib/parsers/index.ts` |
| Pipeline de import | `src/lib/import/import-match.ts` |
| Server action de import | `src/app/(app)/import/actions.ts` |
| Estimación de rounds | `src/lib/firearms/estimate-rounds.ts` |
| Tipos generados de DB | `src/lib/supabase/database.types.ts` (regenerar con `npm run db:types`) |
| Clientes Supabase | `src/lib/supabase/{server,client,middleware}.ts` |
| Proxy (Next 16) | `src/proxy.ts` + `src/lib/supabase/middleware.ts` |
| Tema y tokens | `src/app/globals.css` |
| Convenciones del repo | `AGENTS.md`, `CLAUDE.md` |
