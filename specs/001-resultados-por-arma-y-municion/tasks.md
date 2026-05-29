---
description: "Tasks for: Resultados por combinación arma + munición + disciplina"
---

# Tasks: Resultados por combinación arma + munición + disciplina

**Input**: Design documents from `/specs/001-resultados-por-arma-y-municion/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md)

**Tests**: Incluidos (la feature tiene lógica de agregación non-trivial que conviene testear unitariamente; consistente con la práctica del proyecto, ver `tests/shooter-stats.test.ts`).

**Organization**: Tareas agrupadas por user story para implementación incremental e independiente.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Puede correr en paralelo (archivos distintos, sin dependencias).
- **[Story]**: A qué user story pertenece (US1, US2, US3).
- Cada tarea incluye paths exactos.

## Path Conventions

Web app (Next.js App Router). Source en `src/`, tests en `tests/`. Paths derivados del Project Structure de [plan.md](./plan.md).

---

## Phase 1: Setup

**Purpose**: N/A — no hay scaffold nuevo. El proyecto ya está inicializado.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: N/A — no hay migraciones de DB, no hay cambios de infra compartida. El esquema actual cubre la feature.

---

## Phase 3: User Story 1 - Tu mejor combinación por disciplina (Priority: P1) 🎯 MVP

**Goal**: Mostrar en `/dashboard/[discipline]` una tarjeta con la combinación arma + munición de mayor promedio histórico en esa disciplina.

**Independent Test**: Un tirador con ≥3 match_entries y firearm_log poblado en una disciplina entra a `/dashboard/<discipline>` y ve la tarjeta *"Tu mejor combinación"* con arma, munición (o *"Sin especificar"*), promedio y match count.

### Tests for User Story 1 ⚠️

> Escribir y verificar que FAILAN antes de implementar.

- [ ] **T001** [P] [US1] Crear `tests/loadout-stats.test.ts` con casos para `aggregateLoadouts`:
  - Agrupa por `(discipline_id, firearm_id, ammunition_type_id)` correctamente
  - Trata `ammunition_type_id = null` como un grupo válido (no descarta)
  - Excluye entries con `is_dq` o `is_absent`
  - Calcula `avgPrimaryMetric` correctamente para hit-factor disciplines (usa `match_percentage`)
  - Calcula `avgPrimaryMetric` correctamente para hits-based disciplines (usa `hits`)
  - Devuelve `bestMatchId` apuntando al match con mejor primary metric individual
  - Devuelve `lastUsedDate` = max(`match.date`) por combo
  - Devuelve array vacío cuando no hay entries scoreables

### Implementation for User Story 1

- [ ] **T002** [US1] Definir el tipo `LoadoutAggregate` (inline en `src/lib/stats/loadout-stats.ts` o en `src/lib/types/loadout.ts`):
  ```ts
  type LoadoutAggregate = {
    disciplineCode: DisciplineCode;
    firearmId: string;
    firearmName: string;
    ammunitionTypeId: string | null;
    ammunitionName: string | null;  // null → UI muestra "Sin especificar"
    matchCount: number;
    avgPrimaryMetric: number;
    bestPrimaryMetric: number;
    bestMatchId: string;
    lastUsedDate: string;  // ISO YYYY-MM-DD
    isPreliminary: boolean;
  };
  ```

- [ ] **T003** [US1] Implementar `aggregateLoadouts(entries, options)` en `src/lib/stats/loadout-stats.ts` (pure function):
  - Recibe los entries crudos joineados (typed input from `db/loadout-stats.ts`)
  - Agrupa por `(discipline, firearm, ammunition_type)`
  - Excluye DQ y ausentes
  - Usa `isHitsBasedDiscipline()` para decidir primary metric (FR-004)
  - Define `LOADOUT_MIN_SAMPLE = 3` exportada como const
  - Marca `isPreliminary: matchCount < LOADOUT_MIN_SAMPLE` (FR-006)
  - Cubre todos los casos de T001

- [ ] **T004** [US1] **Verificar que T001 PASA** (correr `npm test -- loadout-stats`).

- [ ] **T005** [US1] Implementar `listMyLoadoutsByDiscipline(supabase, userId, disciplineCode)` en `src/lib/db/loadout-stats.ts`:
  - Join: `match_entries` → `match_firearm_log` (inner) → `firearms`, `ammunition_types` (left) → `matches` (inner) → `shooters` (inner, filtrado por `linked_user_id = userId`)
  - Filtra por `matches.disciplines.code = disciplineCode`
  - Devuelve filas crudas listas para `aggregateLoadouts`
  - Respeta RLS (usa el client server-side firmado con la sesión del usuario)

- [ ] **T006** [US1] Crear componente `<LoadoutInsightsCard>` en `src/components/LoadoutInsightsCard.tsx`:
  - Server Component, recibe `aggregates: LoadoutAggregate[]` como prop
  - Selecciona el "mejor" según FR-007 (no-preliminary preferido)
  - Renderea: nombre del arma, nombre de munición (o *"Sin especificar"*), promedio, sample size, link al bestMatch
  - **No renderea nada si la regla de visibilidad de T008 no se cumple** — la decisión de renderear vive en T008/T007, no acá. Si se llama, asume que ya pasó el gate.

- [ ] **T007** [US1] Modificar `src/components/DashboardView.tsx`:
  - Embeber `<LoadoutInsightsCard>` solo cuando `disciplineCode != null` (FR-008) **Y** `shouldShowLoadoutInsights(aggregates) === true` (FR-012, gate definido en T008).
  - Posición: después de `StatsOverview`, antes de `HistoryTable`.
  - Si el gate falla, no se monta nada — sin placeholder ni espaciado adicional.

- [ ] **T008** [US1] Implementar **regla de visibilidad** (FR-012) en `src/lib/stats/loadout-stats.ts`:
  - Función `shouldShowLoadoutInsights(aggregates: LoadoutAggregate[]): boolean` que devuelve `true` solo si el conjunto contiene **≥2 firearm_ids distintos**.
  - Test asociado en `tests/loadout-stats.test.ts`: 0 firearms → false; 1 firearm con 1 ammo → false; 1 firearm con 2 ammos → false (1 arma distinta sigue siendo 1 arma); 2 firearms → true.
  - Tanto `<LoadoutInsightsCard>` (T006) como `<LoadoutInsightsDrawer>` (T010) consultan esto antes de renderear. Si devuelve `false`, no se monta el componente y **no se muestra ningún empty state ni placeholder** (FR-011).

- [ ] **T008b** [US1] Modificar `src/app/(app)/dashboard/[discipline]/page.tsx`:
  - Llamar `listMyLoadoutsByDiscipline` con el discipline code de la ruta
  - Pasar el resultado (después de `aggregateLoadouts`) al `<DashboardView>` como prop

- [ ] **T009** [US1] **Code review focalizado en Principios III y VI**:
  - Verificar copy: nunca *"loadout"*, *"performance"*, *"setup"*. Sí *"combinación"*, *"promedio"*, *"mejor"* (FR-016).
  - Verificar que NO hay frases tipo *"usá esto"* o *"recomendado para tu próximo match"* (FR-010).

**Checkpoint**: User Story 1 funcional y testeable independientemente. Tarjeta visible en `/dashboard/[discipline]` con datos reales.

---

## Phase 4: User Story 2 - Ranking completo de combinaciones (Priority: P2)

**Goal**: Permitir al usuario ver TODAS sus combinaciones (no solo la mejor) en una vista ordenada por promedio descendente.

**Independent Test**: El tirador hace click en *"Ver todas"* en la tarjeta de US1 y ve una tabla con todas sus combinaciones, cantidad de matches, promedio, mejor y última vez. Las filas son linkeables a los matches que componen cada combinación.

### Implementation for User Story 2

- [ ] **T010** [US2] Crear componente `<LoadoutInsightsDrawer>` en `src/components/LoadoutInsightsDrawer.tsx`:
  - Client Component (`"use client"`) — necesita estado de open/close
  - Props: `aggregates: LoadoutAggregate[]`
  - Renderea una tabla con columnas: Arma, Munición, N matches, Promedio, Mejor, Última vez, [→ link]
  - Ordena por `avgPrimaryMetric` desc (consume el array sin re-ordenar; se asume ordenado upstream)
  - Cada fila linka al `bestMatchId`

- [ ] **T011** [US2] Modificar `<LoadoutInsightsCard>` (de T006):
  - Agregar link *"Ver todas las combinaciones"* en el footer de la card
  - Click abre el `<LoadoutInsightsDrawer>` con todas las aggregates

- [ ] **T012** [US2] Ordenar `aggregates` en `aggregateLoadouts` (T003):
  - Por defecto devolver ordenado por `avgPrimaryMetric` desc para evitar re-ordenar en cliente
  - Actualizar el test correspondiente en `tests/loadout-stats.test.ts`

**Checkpoint**: US1 + US2 funcionando. Usuario puede ver el destacado Y comparar todos sus combos.

---

## Phase 5: User Story 3 - Tag "Preliminar" + manejo de baja muestra (Priority: P3)

**Goal**: Distinguir visualmente las combinaciones con muestra suficiente (≥3 matches) de las preliminares; preferir las no-preliminares en la tarjeta principal.

**Independent Test**: Con 2 combos donde A tiene 2 matches y avg 80%, B tiene 5 matches y avg 75% — la tarjeta principal debe mostrar B; A debe aparecer en el drawer marcado *"Preliminar"*.

### Tests for User Story 3 ⚠️

- [ ] **T013** [P] [US3] Extender `tests/loadout-stats.test.ts` con casos de preliminary:
  - Marca `isPreliminary: true` cuando `matchCount < 3`
  - Si hay no-preliminares, `selectBest()` (o lógica equivalente) prefiere uno de esos
  - Si todos son preliminares, devuelve el de mayor avg con `isPreliminary: true`

### Implementation for User Story 3

- [ ] **T014** [US3] Implementar `selectBestLoadout(aggregates)` en `src/lib/stats/loadout-stats.ts`:
  - Recibe el array completo de aggregates (ya ordenado por avg desc)
  - Devuelve el primer no-preliminary; si no hay, el primero (será preliminary)
  - Devuelve `null` si el array está vacío

- [ ] **T015** [US3] Actualizar `<LoadoutInsightsCard>` (T006) para usar `selectBestLoadout()`:
  - Si `selectBestLoadout()` devuelve un preliminary → mostrar tag *"Preliminar"* + copy aclaratorio (*"Necesitás más torneos con la misma combinación para que el dato sea confiable."*)

- [ ] **T016** [US3] Actualizar `<LoadoutInsightsDrawer>` (T010):
  - Mostrar tag *"Preliminar"* en las filas con `isPreliminary: true`
  - Estilo del tag: consistente con los badges existentes (ver `src/components/ui/Badge.tsx`); color `text-fg-muted` o equivalente (sutil, no alarmante).

- [ ] **T017** [US3] **Verificar T013 PASA** (correr tests).

**Checkpoint**: Las tres user stories completas y testeables. La feature es entregable.

---

## Phase N: Polish & Cross-Cutting

**Purpose**: Tareas que cruzan stories o son afinamiento final.

- [ ] **T018** Smoke test manual de los estados de visibilidad en local:
  - **Hide states** (la feature NO debe aparecer, sin empty state ni placeholder):
    - Usuario sin claims → no aparece.
    - Usuario con claims pero sin `match_firearm_log` poblado → no aparece (silenciosa, FR-011).
    - Usuario con 1 sola arma distinta en la disciplina (cualquier cantidad de matches o municiones) → no aparece (FR-012).
    - Usuario con 0 ó 1 match scoreable en la disciplina → no aparece.
  - **Show state** (la feature aparece y funciona):
    - Usuario con ≥2 armas distintas y `match_firearm_log` poblado → la tarjeta aparece, el drawer abre, las métricas son correctas.

- [ ] **T019** Correr `npm run build` y verificar 0 errores de TypeScript.

- [ ] **T020** Correr `npm test` completo — todos los tests existentes deben seguir pasando + los nuevos de loadout pasar.

- [ ] **T021** [P] Actualizar `docs/system-overview.md` §1 (Decisiones que la app habilita) sumando la nueva pregunta: *"¿Con qué combinación arma + munición me fue mejor?"* → `/dashboard/[discipline]` → `LoadoutAggregate.avgPrimaryMetric`.

- [ ] **T022** Verificar Conventional Commits en cada commit (`feat(stats): ...`, `feat(dashboard): ...`).

- [ ] **T023** Code review final cross-cutting: scan completo en busca de violaciones de Principio III (jerga) o VI (recomendaciones explícitas).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 + 2**: Vacías. No bloquean.
- **Phase 3 (US1 — MVP)**: Empezar acá directamente.
- **Phase 4 (US2)**: Depende de US1 (`<LoadoutInsightsCard>` debe existir para wirear el drawer).
- **Phase 5 (US3)**: Depende de US1 (extiende la pure function); puede empezar después de T004.
- **Phase N (Polish)**: Después de las tres user stories.

### Within Each User Story

- Tests FALLAN antes de implementación (T001 antes de T003; T013 antes de T014).
- Pure function antes de query antes de componente.
- Componente antes de wireup en página.

### Parallel Opportunities

- T001 y T013 pueden escribirse en paralelo (mismo archivo `loadout-stats.test.ts` pero distintas suites/describes — coordinar con un solo dev).
- T021 (docs) corre en paralelo a todo lo demás.

---

## Implementation Strategy

### MVP First

1. Phase 3 completo (T001–T009). Stop, validar que la tarjeta aparece correctamente con un usuario real.
2. Si la tarjeta cubre el caso de uso → demo / merge / siguiente prioridad.

### Incremental Delivery

1. **US1** → tarjeta mínima visible (MVP demo).
2. **US2** → drawer expandido.
3. **US3** → preliminaridad y robustez para casos de baja muestra.

Cada user story es entregable e independientemente útil. Si se decide cortar el alcance, US1 sola ya entrega valor (el destacado de la mejor combinación).

---

## Notes

- [P] = archivos distintos, sin dependencias.
- [Story] = traceability al user story de [spec.md](./spec.md).
- Tests fallan antes de implementar (TDD donde aplica).
- Commit Conventional + `feat(scope)` por tarea o grupo coherente.
- Code review final aplica Principios III y VI de la constitución (`.specify/memory/constitution.md`).
