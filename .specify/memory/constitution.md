# HitFactor Constitution

## Contexto

HitFactor es una aplicación web gratuita para tiradores deportivos federados (mayormente Argentina) que centraliza el historial, las estadísticas y el progreso de sus participaciones en torneos. Resuelve dos problemas concretos: (a) el historial del tirador está fragmentado entre planillas (PractiScore, WinMSS, CSV, PDF FAT) y (b) cada match publicado obliga a N tiradores a procesar la misma planilla por separado.

**Audiencia**: tiradores deportivos de edad variada (~20 a 70+), con habilidad técnica heterogénea — una parte significativa tiene 50+ años con poca exposición a aplicaciones web. **Uso esperado**: bajo (1–5 matches por mes); es una app **de consulta periódica**, no de uso diario.

Esta constitución captura los principios y restricciones que se respetan transversalmente en toda decisión de producto e implementación. Cualquier feature nueva pasa por estos principios en el Constitution Check del `plan.md` correspondiente.

## Core Principles

### I. Biblioteca compartida (NON-NEGOTIABLE)

Cada match importado es un recurso compartido para todos los tiradores que participaron. Un tirador NUNCA debe necesitar re-subir un match ya cargado por otro.

Toda feature nueva que introduce datos asociados a un match debe distinguir explícitamente:

- **Datos públicos del torneo** (resultados, stages, ranking): viven en `matches`, `match_entries`, `stage_results` y son legibles por cualquier usuario autenticado.
- **Datos privados del tirador** (mi arma, mi munición, mis notas): viven en tablas con `owner_user_id` y RLS owner-only.

**Rationale**: La gracia de la app es el efecto red — más tiradores usando HitFactor significa menos esfuerzo de import por persona. Romper este principio convierte HitFactor en una planilla privada, no en una biblioteca.

### II. Identidades múltiples por usuario

Un usuario puede asociar a su cuenta N filas de `shooters` (multi-identidad). El modelo de datos NO debe forzar una identidad única por usuario.

Las features que dependan de "quién soy" deben unir todos los shooters con `linked_user_id = auth.uid()`, no asumir uno. La unique constraint relevante es **`shooters.linked_user_id` único por shooter** (un shooter ↔ máximo un usuario), no al revés.

**Rationale**: En tiro deportivo el nombre del tirador varía entre planillas — *"Apellido, Nombre"* vs *"Apellido Nombre"*, siglas vs no, con/sin número de socio. Una identidad por usuario rompería el claim para los casos reales.

### III. Español plano, sin jerga (NON-NEGOTIABLE)

Todo copy nuevo en la UI evita anglicismos y términos técnicos. Tono: **voseo argentino**, segunda persona singular.

Mapeos vinculantes (en UI; en código y DB se respetan los nombres técnicos):

| En vez de… | Usar… |
|---|---|
| *linkear*, *vincular*, *atar a tu cuenta* | **asociar a tu cuenta** |
| *performance* | **resultados** |
| *stats*, *KPIs*, *métricas* | **estadísticas** |
| *shooter* | **tirador** (UI); en código sigue siendo `shooter` |
| *upload* | **subir** / **importar** |
| *delete* | **borrar** (no *eliminar*) |
| *dashboard* | en sidebar OK; en headings usar **mis estadísticas** |

**Rationale**: La audiencia incluye tiradores 60+ con poco manejo de aplicaciones web. La jerga es una barrera real al uso.

### IV. Una tarea por pantalla

Cada pantalla autenticada hace una cosa. No se anidan tabs, no se mezclan acciones críticas, no se usan modales para tareas principales (login, signup, import son páginas dedicadas — no modales).

Tarjetas dentro de una pantalla pueden mostrar info auxiliar, pero la pantalla tiene un único propósito principal claro.

**Rationale**: La carga cognitiva baja con foco. La audiencia procesa mejor pantallas enfocadas.

### V. Estadísticas que responden preguntas

Cada KPI nuevo en la UI debe responder una pregunta concreta del tirador (*¿estoy mejorando?*, *¿con qué arma anduve mejor?*, *¿cuánta munición gasto?*). Si una métrica no habilita una decisión del usuario, no se agrega.

Las métricas decorativas (counts, IDs, hashes técnicos) NO se exponen en la UI principal del tirador. Si son necesarias para soporte/debugging, viven en una vista dedicada del admin.

**Rationale**: Las KPIs decorativas inflan la UI sin habilitar acción. El espacio de pantalla es caro y la atención del usuario aún más.

### VI. El usuario decide; la app muestra (NON-NEGOTIABLE)

HitFactor presenta datos agregados en formatos que invitan a la inferencia, pero NO recomienda explícitamente.

**Prohibido en la UI**:

- *"Usá esta arma"* / *"Llevá esta munición"*.
- *"Estás tirando mal"* / *"Tu técnica está rara"*.
- *"Vas a ganar tu próximo match con X probabilidad"*.

**Permitido y promovido**:

- Mostrar datos comparativos: *"Con Glock 17 promediaste 78% en 6 matches"*.
- Mostrar tendencias: *"Tu % subió +1.2 por torneo"*.
- Mostrar señales con etiqueta neutra: *"Tasa de penalties: alta"*.
- Mostrar tu mejor combinación HISTÓRICA: *"Tu mayor promedio fue con la combinación X"*.

**Rationale**: El tirador conoce su contexto mejor que la app (clima del día, mantenimiento reciente del arma, gusto personal, lo que tira su contrincante). La app es honesta sobre los datos sin pretender ser entrenador.

### VII. Auditoría visible

Toda mutación del usuario (crear/editar/borrar firearms, ammo, claims, matches; modificar entries) DEBE registrarse en `audit_log` con `metadata` jsonb que permita re-rendear el evento en lenguaje natural años después.

Convenciones del `metadata`:

- Resolver IDs a nombres **en el momento del log** (snapshot), no al renderear (los IDs pueden desaparecer; los nombres no).
- Para updates, guardar `{ before: {...}, after: {...} }` con snapshots completos.
- Para deletes, guardar el snapshot previo completo.

`describeAuditEntry` (`src/lib/audit/render.ts`) renderea cada row a `{ summary, detail?, link? }` con narrativa en segunda persona (*"Importaste"*, *"Asociaste"*, *"Quitaste"*) y link al recurso afectado cuando aplica.

**Rationale**: El tirador necesita poder revisar qué hizo y deshacer si se equivocó. Sin auditoría, la confianza en la app baja.

### VIII. Errores accionables (NON-NEGOTIABLE)

Todo mensaje de error visible al usuario debe seguir el patrón: **qué pasó + cómo seguir**. Nunca se exponen errores crudos de Supabase, Postgres o Next al usuario final.

Ejemplos:

- ✅ *"Tu email todavía no está confirmado. Revisá la casilla de X y hacé click en el link que te mandamos al registrarte. Si no lo ves, revisá tu carpeta de spam."*
- ❌ *"Email not confirmed"* (lo que devuelve Supabase, se debe mapear antes).
- ✅ *"No se pudo extraer la fecha del PDF. ¿Es un archivo WinMSS válido?"*
- ❌ *"23505: duplicate key value violates unique constraint"* (lo que devuelve Postgres, nunca llega al usuario).

**Rationale**: Un error sin acción posible es una mala experiencia y una llamada al soporte. Errores técnicos en la UI generan ansiedad sin habilitar resolución.

## Out of Scope

Por respeto al foco y a la audiencia, lo siguiente NO está en alcance del producto:

- **Scoring de match en vivo.** PractiScore/WinMSS/ESS generan la planilla; HitFactor la consume.
- **Funciones de organizador.** No hay flujos para crear matches a mano desde cero, gestionar inscripciones, ni emitir resultados oficiales.
- **Real-time / live tracking.** La unidad mínima es el torneo finalizado y publicado.
- **Features sociales.** No hay seguir tiradores, comparar perfiles, comentarios, likes ni ranking público.
- **Coaching automático.** Ver Principio VI.
- **Pagos o suscripción.** La app es gratis sin límites; toda funcionalidad disponible para todo usuario autenticado.
- **App nativa móvil.** Es web responsive; no hay artefactos en App Store / Play Store.
- **Exportación a Excel / PDF.** Los datos viven en la UI.

Cualquier feature nueva que roce estas restricciones requiere una **excepción justificada documentada en el `plan.md` correspondiente**, sección *Complexity Tracking*.

## Convenciones técnicas vinculantes

Estas no son principios de producto sino reglas operativas que TODO cambio respeta:

- **Conventional Commits** obligatorios (`feat:`, `fix:`, `perf:`, `refactor:`, `docs:`, `chore:`, `test:`, `style:`, `build:`, `ci:`). release-please depende de esto.
- **Server Components por default**; `"use client"` solo cuando hay estado/efectos locales reales.
- **RLS siempre activa** en toda tabla del schema `public`. La app **jamás usa la service-role key**.
- **`auth.uid()` para ownership** en políticas RLS; no comparar contra `user_id` en código de frontend como única defensa.
- **Errores de DB nunca llegan crudos al usuario** (ver Principio VIII).
- **Tipos de DB generados** son la fuente de verdad (`npm run db:types`); no escribir tipos a mano para tablas existentes.
- **Tests cubren lógica pura** (parsers, stats, audit-render, import); no se exigen tests E2E ni de componentes React.
- **Migraciones versionadas** con prefijo numérico secuencial `NNNN_descripcion.sql` en `supabase/migrations/`.
- **`DEFAULT` en columnas** preferido sobre triggers cuando es posible (ver migración 0013 para el patrón).
- **`unpdf` se carga dinámicamente** (`await import("unpdf")`) — nunca import estático en módulos que se cargan en cold-path.
- **Server Actions** con entrada `FormData` y salida `redirect`/`redirectWithError`; nunca devuelven JSON al cliente.
- **No introducir dependencias nuevas** sin justificación documentada en el `plan.md`.

## Governance

Esta constitución supersede cualquier convención no escrita o decisión ad-hoc previa.

**Flujo de cambio**:

1. `/speckit-specify` produce un `spec.md` que respeta los principios.
2. `/speckit-plan` produce un `plan.md` que pasa el **Constitution Check** (cada principio se verifica explícitamente; las violaciones se documentan en *Complexity Tracking* con justificación de por qué la alternativa simple no aplica).
3. `/speckit-tasks` produce un `tasks.md` ordenado.
4. `/speckit-implement` ejecuta tareas respetando los principios.

**Amendments**: cambios a esta constitución requieren PR dedicado con justificación en el cuerpo del PR. Si un principio cambia de `NON-NEGOTIABLE` a flexible o viceversa, debe documentarse el contexto del cambio (incidente, decisión de producto, nueva evidencia).

**Versión del documento**: la primera versión (1.0.0) consolida los principios derivados del estado del repo y de la práctica vigente al 2026-05-29. Versiones futuras siguen SemVer: MAJOR para cambios en NON-NEGOTIABLES, MINOR para nuevos principios o cambios sustanciales, PATCH para clarificaciones.

**Version**: 1.0.0 | **Ratified**: 2026-05-29 | **Last Amended**: 2026-05-29
