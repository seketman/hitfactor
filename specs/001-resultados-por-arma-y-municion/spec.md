# Feature Specification: Resultados por combinación arma + munición + disciplina

**Feature Branch**: `001-resultados-por-arma-y-municion`

**Created**: 2026-05-29

**Status**: Draft

**Input**: User description: "Conocer qué combinación de arma + munición + disciplina deportiva es la óptima para un tirador, identificándola en base a los resultados obtenidos en torneos anteriores, para ayudarle a tomar una mejor decisión en los próximos."

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Ver mi combinación de mayor rendimiento por disciplina (Priority: P1)

Un tirador con historial de torneos en una disciplina, que ha registrado el arma usada en cada match (y a veces la munición), quiere ver con qué **combinación de arma + munición le fue mejor en promedio** dentro de esa disciplina. Esa información lo ayuda a considerar qué llevar al próximo torneo, sin que la app le diga explícitamente qué hacer.

**Why this priority**: Es el caso de uso principal y resuelve la pregunta *"¿qué tenía que llevar la última vez que me fue bien?"* sin que el tirador tenga que abrir match por match. Es la mínima entrega valiosa de la feature.

**Independent Test**: Un tirador con ≥3 `match_entries` en al menos una disciplina, **usando al menos 2 armas distintas**, y con `match_firearm_log` poblado en esas entries, entra a `/dashboard/[discipline]` y encuentra una tarjeta titulada *"Tu mejor combinación"* mostrando un arma, una munición (o *"Sin especificar"*), el promedio del Match % (o impactos para FBI) y la cantidad de matches en que la usó. Si todos los matches son con la misma arma (o sin arma registrada), la tarjeta **no aparece**.

**Acceptance Scenarios**:

1. **Given** un tirador con 3 entries de IPSC, todas con la misma arma+munición y match % {65, 72, 68}, **when** entra a `/dashboard/ipsc`, **then** la tarjeta *"Tu mejor combinación"* muestra esa arma, esa munición, `68.3%` como promedio y `3 matches` como sample size.

2. **Given** un tirador con 6 entries de IPSC repartidas en 2 combinaciones (combo A: 3 matches, avg 75%; combo B: 3 matches, avg 68%), **when** entra a `/dashboard/ipsc`, **then** la tarjeta muestra el combo A (avg más alto), no el combo B.

3. **Given** un tirador con entries donde `match_firearm_log.ammunition_type_id` es `NULL`, **when** entra a `/dashboard/ipsc`, **then** la munición aparece como *"Sin especificar"* y el promedio se computa agrupando esos entries juntos como una combinación legítima.

4. **Given** un tirador en disciplina FBI (hits-based), **when** entra a `/dashboard/tiro_fbi`, **then** la tarjeta muestra promedio de **impactos** (no %) — coherente con la primary metric de la disciplina.

5. **Given** un tirador con matches DQ o ausente con arma asignada, **when** se computa el promedio, **then** esos entries NO se incluyen en el cálculo del promedio (consistente con la lógica existente de `shooter-stats`).

6. **Given** un tirador con 8 entries en IPSC todas con la misma arma (puede haber distinta munición), **when** entra a `/dashboard/ipsc`, **then** la tarjeta *"Tu mejor combinación"* **NO aparece** — no hay comparación significativa entre armas y mostrarla sólo ensuciaría el dashboard.

7. **Given** un tirador sin ningún `match_firearm_log` en la disciplina (todos los matches sin arma registrada), **when** entra a `/dashboard/ipsc`, **then** la tarjeta tampoco aparece (no hay datos sobre los que agregar) y **no se muestra ningún empty state** invitando a registrar armas — el dashboard queda limpio.

---

### User Story 2 — Ver el ranking completo de mis combinaciones (Priority: P2)

El tirador con varias combinaciones distintas (probó armas/municiones diferentes) quiere ver TODAS sus combinaciones en una vista ordenada, no solo la mejor, para poder comparar y entender qué tan parejas o dispares fueron.

**Why this priority**: Una sola combinación destacada (P1) es buen MVP, pero el tirador serio quiere ver el ranking completo para tomar decisiones más matizadas (ej. *"el combo A tiene avg más alto pero solo 3 matches; el combo B tiene avg apenas menor con 15 matches → me fío más de B"*).

**Independent Test**: El tirador hace click en *"Ver todas"* en la tarjeta de P1 y se le muestra una vista con todas sus combinaciones (arma + munición), cantidad de matches, promedio, mejor resultado individual y última vez que la usó. Ordenado por promedio descendente.

**Acceptance Scenarios**:

1. **Given** un tirador con 4 combinaciones en IPSC, **when** abre la vista expandida, **then** ve 4 filas ordenadas por avg %, cada una con arma, munición, N matches, avg %, best %, last used.

2. **Given** el tirador hace click en una fila, **then** se muestran los matches específicos que componen esa combinación (link a cada uno).

---

### User Story 3 — Distinguir combinaciones preliminares de las estadísticamente significativas (Priority: P3)

Una combinación con 1 o 2 matches es ruido — un resultado podría ser pura suerte. El tirador debe poder distinguir visualmente las combinaciones con muestra suficiente (≥3 matches) de las preliminares.

**Why this priority**: Evita que el usuario tome decisiones basadas en N=1 (*"usé Glock 19 una vez y me fue al 92%, debe ser mejor que Glock 17"*). Es defensa contra el sobreajuste.

**Independent Test**: Cuando una combinación tiene <3 matches, aparece marcada con un tag *"Preliminar"* o similar. La tarjeta principal de P1 prefiere combos NO preliminares cuando existen; si TODOS son preliminares, muestra el mejor preliminar con la marca + copy aclaratorio.

**Acceptance Scenarios**:

1. **Given** dos combos: A con 2 matches (avg 80%) y B con 5 matches (avg 75%), **when** entra a `/dashboard/ipsc`, **then** la tarjeta principal muestra el combo B (no preliminar), no A. El combo A aparece en la vista expandida con tag *"Preliminar"*.

2. **Given** todos los combos del tirador tienen <3 matches, **when** entra a la disciplina, **then** la tarjeta principal muestra el de mayor avg con tag *"Preliminar"* y un copy explicativo: *"Necesitás más torneos con la misma combinación para que el dato sea confiable."*

### Edge Cases

- **El tirador no tiene firearms ni `match_firearm_log` poblado en la disciplina**: la feature se oculta silenciosamente. **No se muestra empty state** ni copy invitando a registrar armas — el dashboard del usuario debe quedar limpio. El descubrimiento de la funcionalidad de registrar arma sucede en `/matches/[id]/me` (flujo existente), no acá.
- **Solo 1 match en total en la disciplina**: la feature se esconde (no hay con qué comparar).
- **Todos los matches en la disciplina son con la misma arma** (con una o más municiones distintas): la feature se esconde. *Justificación*: aunque haya variación de munición, el tirador piensa en la decisión a nivel "qué arma traigo" — si solo hay una opción, mostrar una tarjeta "Tu mejor combinación" no aporta y ensucia la vista.
- **El tirador tiene matches DQ o ausente con arma asignada**: esos entries SE EXCLUYEN del cálculo del promedio (consistente con la lógica de `shooter-stats` existente — ver §7.3 de `docs/system-overview.md`). Pero **sí cuentan** para evaluar si hay ≥2 armas distintas (la condición de visibilidad). Los disparos de esos matches también cuentan para la suma de rondas del arma a nivel `/firearms/[id]` (la munición se gastó realmente; eso ya está implementado).
- **El tirador cambió de arma entre divisiones del mismo match**: cada `match_entry` tiene su propio `match_firearm_log` (la PK es `match_entry_id`), así que distintos entries del mismo match con distintas armas se tratan como armas distintas para la condición de visibilidad.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE agregar `match_entries` joineadas con `match_firearm_log` para los shooters cuyo `linked_user_id` matchea el `auth.uid()` actual.
- **FR-002**: El sistema DEBE agrupar por la tupla `(discipline_id, firearm_id, ammunition_type_id)`, tratando `ammunition_type_id IS NULL` como un grupo válido (*"sin especificar"*), no descartando esos entries.
- **FR-003**: El sistema DEBE excluir entries con `is_dq = true` O `is_absent = true` del cálculo de promedios y best (consistente con principio estadístico existente).
- **FR-004**: El sistema DEBE usar la primary metric correcta por disciplina: **hits** para `tiro_fbi`, **matchPercentage** para `ipsc`, `steel_challenge`, `combat_solutions` (vía la función `isHitsBasedDiscipline` ya existente en `src/lib/disciplines.ts`).
- **FR-005**: El sistema DEBE exponer por combinación: `matchCount`, `avgPrimaryMetric`, `bestPrimaryMetric`, `bestMatchId` (para link al match destacado), `lastUsedDate`, `firearmName`, `ammunitionName` (o *"Sin especificar"*), `disciplineCode`.
- **FR-006**: El sistema DEBE marcar combinaciones con `matchCount < 3` como `isPreliminary: true`.
- **FR-007**: El sistema DEBE preferir, al seleccionar el "mejor combo" para la tarjeta principal, una combinación NO preliminar sobre una preliminar incluso si el promedio de esta es mayor. Solo si todas son preliminares, muestra la mejor preliminar con la marca.
- **FR-008**: El sistema DEBE renderizar la tarjeta en `/dashboard/[discipline]` (vista filtrada por disciplina) y NO en `/dashboard` consolidado. *Justificación*: la pregunta no tiene sentido cross-discipline (no se promedia "% IPSC" con "hits FBI").
- **FR-009**: El sistema DEBE proveer una vista expandida con todas las combinaciones ordenadas por `avgPrimaryMetric` descendente, accesible desde la tarjeta principal mediante un link *"Ver todas"*. El mecanismo de presentación (drawer, sub-página, modal) se decide en `plan.md`.
- **FR-010**: El sistema NO DEBE recomendar explícitamente una combinación al tirador (constitutional Principio VI). Todo el copy es descriptivo (*"Tu mayor promedio"*, *"Tu mejor combinación"*) y nunca prescriptivo (*"Llevá X"*, *"Usá esta munición"*).
- **FR-011**: El sistema NO DEBE mostrar empty state ni copy invitando a registrar armas cuando la feature no aplica. La presencia o ausencia de la tarjeta es silenciosa — no hay "zona vacía" en el dashboard. El onboarding de registrar arma vive en `/matches/[id]/me`, no acá.
- **FR-012**: El sistema DEBE renderizar la tarjeta **solo cuando hay ≥2 armas distintas** (`firearm_id`) con al menos un `match_entry` scoreable en la disciplina actual. Si todos los matches en la disciplina son con la misma arma (cualquier munición) o sin arma registrada, la tarjeta y el drawer no se muestran. *Justificación*: mostrar "Tu mejor combinación" cuando no hay con qué compararla es ruido visual, no información útil.
- **FR-013**: La query DEBE respetar RLS. No introducir uso de service-role; usar la sesión del usuario actual.
- **FR-014**: El sistema NO DEBE loguear las visitas a la feature en `audit_log` (la auditoría es para mutaciones; visualizar no muta).
- **FR-015**: El sistema DEBE incluir, en cada combinación, una referencia al `match_id` del mejor resultado individual de esa combinación (para link "ver ese match" desde la fila).
- **FR-016**: La feature DEBE respetar el principio constitucional III (español plano, sin jerga): nunca usar *"loadout"*, *"setup"*, *"performance"* en la UI. Términos canónicos: **combinación**, **promedio**, **mejor**, **última vez**.

### Key Entities *(include if feature involves data)*

- **MatchEntry**: Participación del tirador en un match (un par `shooter` + `division`). Atributos relevantes: `match_percentage`, `hits`, `is_dq`, `is_absent`. Pertenece a un `match` (con `discipline_id`) y a un `shooter`.
- **MatchFirearmLog**: Vínculo 1:1 con `match_entry_id` (PK). Atributos: `firearm_id` (NOT NULL), `ammunition_type_id` (nullable), `rounds_fired`.
- **Firearm**: Arma del usuario (catálogo privado, `owner_user_id`). Atributos relevantes para la UI: `name`, `brand`, `model`, `caliber`.
- **AmmunitionType**: Tipo de munición (catálogo privado, `owner_user_id`). Atributos relevantes: `name`, `type` (`factory` / `reload`), `brand`, `caliber`.
- **Match**: contexto del entry, aporta `discipline_id` y `date`.
- **Discipline**: define la primary metric (vía `scoring_type` y helper `isHitsBasedDiscipline`).
- **LoadoutAggregate** *(nuevo, computed; no se persiste)*: tupla `(discipline, firearm, ammunition | null)` con sus métricas agregadas. Vive en `src/lib/stats/loadout-stats.ts` (a crear).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un tirador con ≥5 matches en una disciplina, usando ≥2 armas distintas, con `match_firearm_log` poblado, puede identificar su combinación de mayor promedio en **menos de 10 segundos** desde que carga `/dashboard/[discipline]`.
- **SC-002**: La query de la tarjeta carga junto con el resto del dashboard sin agregar más de **150 ms** al render server-side (medido en producción con un tirador real de ~50 matches).
- **SC-003**: **0 falsos positivos** de "mejor combo" basados en N=1 — verificable porque la lógica FR-007 prefiere combinaciones no preliminares siempre que haya alguna.
- **SC-004**: El copy de la feature pasa los Principios III (sin jerga) y VI (sin recomendaciones explícitas) en code review.
- **SC-005**: Para un tirador con 0 o 1 armas distintas en la disciplina, la zona del dashboard donde podría aparecer la tarjeta queda completamente vacía (sin tarjeta, sin empty state, sin placeholder). Verificable por inspección visual.

## Assumptions

- El tirador tiene al menos un `shooter` claimado a su cuenta. Sin esto no hay `match_entries` que agregar y la feature simplemente no aparece — el empty state correspondiente está cubierto por el flujo de claim existente.
- El tirador registra su arma post-match desde `/matches/[id]/me` (flujo existente). La feature NO sustituye ese flujo; lo aprovecha.
- La columna `match_firearm_log.ammunition_type_id` puede ser NULL (compat histórica) y el agregado lo trata como un grupo legítimo de combinación, no lo descarta.
- Las disciplinas hits-based (FBI) son las únicas donde la primary metric NO es `match_percentage`. La función helper `isHitsBasedDiscipline()` ya existe.
- **Threshold de muestra mínima "no preliminar"**: 3 matches. Valor inicial; ajustable por feedback. Documentado como constante en el código (`LOADOUT_MIN_SAMPLE = 3`).
- **Comparación entre combos**: solo dentro de la misma disciplina. No se compara un avg % de IPSC contra un avg de hits de FBI.
- Cualquier mejora futura (gráfico de evolución por combo, comparación side-by-side, exposición en `/firearms/[id]`) queda **fuera del alcance** de esta iteración.
