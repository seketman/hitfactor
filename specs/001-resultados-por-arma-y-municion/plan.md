# Implementation Plan: Resultados por combinación arma + munición + disciplina

**Branch**: `001-resultados-por-arma-y-municion` | **Date**: 2026-05-29 | **Spec**: [./spec.md](./spec.md)

**Input**: Feature specification from `./spec.md`

## Summary

Agregar a `/dashboard/[discipline]` una tarjeta *"Tu mejor combinación"* que muestre la combinación de arma + munición con mayor promedio (de la primary metric apropiada por disciplina) entre los `match_entries` del usuario, descartando DQ y ausentes. Una vista expandida muestra todas las combinaciones con sus métricas, accesible mediante drawer (sin nueva ruta).

**Regla de visibilidad** (FR-012): la tarjeta y el drawer **solo se renderean cuando el usuario tiene ≥2 armas distintas con `match_entries` scoreables en la disciplina**. Si todos los matches son con la misma arma (independiente de las municiones) o sin arma registrada, la feature se oculta silenciosamente — sin empty state, sin placeholder. Mostrar una "mejor combinación" cuando no hay con qué comparar es ruido visual; el dashboard del usuario queda limpio.

Lógica de agregación nueva en `src/lib/stats/loadout-stats.ts` (pure function, sin queries, testeable en aislamiento). Query nueva en `src/lib/db/loadout-stats.ts` (join cross-tabla). Render en un nuevo componente `LoadoutInsightsCard` consumido desde `DashboardView` solo cuando hay disciplina activa. Tests unitarios sobre la pure function.

**No requiere migración de DB.** Todo el esquema necesario ya existe.

## Technical Context

**Language/Version**: TypeScript ^6.x, React 19.2.6, Next.js 16.2.6.

**Primary Dependencies**: Ya existentes en el proyecto — `@supabase/ssr`, `@supabase/supabase-js`, Tailwind v4, `lucide-react`. **Sin nuevas dependencias.**

**Storage**: Postgres (Supabase). Tablas existentes consumidas: `match_entries`, `match_firearm_log`, `firearms`, `ammunition_types`, `matches`, `disciplines`, `shooters`. **No requiere nueva migración.** El agregado es read-only sobre el esquema actual.

**Testing**: Vitest. Test unitario nuevo en `tests/loadout-stats.test.ts` cubriendo la lógica de agregación (dedupe por combo, exclusiones DQ/ausente, preliminary flag, primary metric per discipline, NULL ammunition).

**Target Platform**: Web (Next.js App Router, Server Components). Sin requisitos especiales de plataforma.

**Project Type**: Web application (Next.js App Router, brownfield existente).

**Performance Goals**: Render server-side de la tarjeta en **<150 ms adicional** sobre el dashboard actual (SC-002). El join se hace en una sola query (no se reusa la del dashboard, que filtra sin `match_firearm_log`). Para un tirador con ~50 matches y ~5 firearms, el resultado del join tiene <100 filas — el agregado en JS es trivial; la latencia está dominada por el round-trip.

**Constraints**:

- Respeta RLS — query firmada con la sesión del usuario, sin service-role.
- Sin nuevas migraciones de DB.
- Sin nuevas dependencias externas.
- Server Components por default.
- Conventional Commits obligatorios.

**Scale/Scope**: Tirador típico activo: ~50 matches, ~5 firearms, ~3 ammunition_types → ~15-30 combinaciones únicas (en práctica suele haber pocas distintas). Cómputo trivial.

## Constitution Check

*GATE: Recorrido principio por principio. Toda violación se documenta y justifica en Complexity Tracking.*

| Principio | Estado | Notas |
|---|---|---|
| **I. Biblioteca compartida** | ✅ | La feature solo lee datos privados del usuario (sus shooters, sus firearms, sus ammos) que ya están privados por RLS. No afecta el modelo compartido. |
| **II. Identidades múltiples** | ✅ | La agregación une `match_entries` de TODOS los shooters linkeados al usuario (no asume identidad única). Se delega al join `shooters` ON `linked_user_id = auth.uid()`. |
| **III. Español plano, sin jerga** | ⚠️ A verificar en review | Copy usado: *"Tu mejor combinación"*, *"Tu mayor promedio"*, *"Preliminar"*, *"Sin especificar"*, *"Ver todas"*. **Prohibido** introducir *"loadout"*, *"setup"*, *"performance"*. El review del PR verifica explícitamente. |
| **IV. Una tarea por pantalla** | ✅ | La feature es una tarjeta dentro del dashboard (info auxiliar, no nueva tarea principal). La vista expandida es un **drawer**, no una ruta nueva — el dashboard sigue siendo la pantalla principal. |
| **V. Estadísticas que responden preguntas** | ✅ | Responde explícitamente *"¿con qué combo me fue mejor?"* — caso paradigmático del principio. |
| **VI. El usuario decide; la app muestra** | ✅ | Todo el copy es descriptivo. **Veto explícito** a botones como *"Usar este combo"* o *"Recomendar para próximo match"*. La tarjeta describe lo histórico; no proyecta ni sugiere. |
| **VII. Auditoría visible** | ✅ | No aplica (la feature es read-only, sin mutaciones que loguear). FR-014 lo confirma. |
| **VIII. Errores accionables** | ✅ | La feature no tiene empty states (FR-011) — se oculta silenciosamente cuando no aplica. Si en el futuro aparece un error de DB, se captura y se muestra vía `redirectWithError` con copy accionable. |

**Veredicto**: **PASA**, con dos cautelas a verificar en code review (copy plano, drawer en vez de sub-página).

## Project Structure

### Documentation (this feature)

```
specs/001-resultados-por-arma-y-municion/
├── spec.md              # Feature spec (DONE)
├── plan.md              # This file
└── tasks.md             # Generated by /speckit-tasks
```

### Source Code (repository root)

```
src/
├── lib/
│   ├── stats/
│   │   ├── shooter-stats.ts           # existing — no cambios
│   │   └── loadout-stats.ts           # NEW — pure aggregation function
│   ├── db/
│   │   ├── matches.ts                 # existing — no cambios
│   │   └── loadout-stats.ts           # NEW — query helper joineando tablas
│   └── types/
│       └── loadout.ts                 # NEW — types de la agregación (opcional;
│                                      #       puede vivir inline en stats file)
├── components/
│   ├── DashboardView.tsx              # MODIFIED — embed LoadoutInsightsCard
│   │                                  #            solo cuando hay discipline
│   ├── LoadoutInsightsCard.tsx        # NEW — tarjeta principal
│   └── LoadoutInsightsDrawer.tsx      # NEW — vista expandida con tabla
└── app/(app)/dashboard/[discipline]/
    └── page.tsx                       # MODIFIED — fetcha loadout data
                                       #            y la pasa a DashboardView

tests/
└── loadout-stats.test.ts              # NEW — cubre FR-001..FR-007 + edge cases
```

**Structure Decision**: Sigue el patrón existente del proyecto:

- **Pure functions** en `src/lib/stats/` (testeables sin DB).
- **Query helpers** en `src/lib/db/` (consumen `TypedSupabaseClient`).
- **Componentes UI** en `src/components/` (Server Components por default; `"use client"` solo si el drawer necesita estado local).

## Complexity Tracking

| Violación / Decisión no obvia | Por qué | Alternativa más simple rechazada porque |
|---|---|---|
| Nueva query DB en vez de extender la del dashboard | El dashboard actual no joinea `match_firearm_log` ni `ammunition_types`. Agregar esos joins ralentizaría el query para los ~30% de usuarios sin firearm log poblado. | Reusar el query del dashboard penalizaría a usuarios que no usan la feature. Una query lazy y específica respeta el caso común. |
| Visibilidad gateada por "≥2 armas distintas", no por "≥1 combo" | El usuario piensa la decisión de loadout a nivel arma; una sola arma (con varias municiones) no es una comparación que el tirador busque. Mostrarla ensucia la vista. | Mostrar siempre que haya ≥1 combo sería técnicamente más completo (ej. comparar factory vs reload con la misma arma) pero contradice el modelo mental del usuario. El caso "compará tus municiones" amerita una feature dedicada futura, no esta. |
| Drawer en vez de sub-página `/dashboard/[discipline]/combinaciones` | Mantener la pantalla principal enfocada (Principio IV). El drawer es feature secundaria del dashboard, no merece ruta propia. | Una sub-página agregaría navegación y un layout extra para algo que es esencialmente una tabla detallada del agregado. |
| Constante `LOADOUT_MIN_SAMPLE = 3` hardcoded en el código | Valor inicial respaldado por intuición de producto (1 match es ruido; 3 empieza a ser señal). Ajustable si feedback lo amerita. | Volverlo configurable por usuario sería sobreingeniería para v1. |

## Notas para `/speckit-tasks`

Cuando se generen los tasks, conviene:

- **Phase 1 (Setup)**: Vacío. No hay scaffold nuevo.
- **Phase 2 (Foundational)**: Vacío. No hay migraciones ni cambios de infra compartida.
- **Phase 3 (US1 — MVP)**: Empieza por la pure function + tests, después la query, después el componente.
- **Phase 4 (US2)**: Drawer y vista expandida. Reutiliza la misma agregación de US1.
- **Phase 5 (US3)**: Lógica de preliminary tag (extiende la pure function de US1; el test debe agregarse en la misma `loadout-stats.test.ts`).
- **Phase N (Polish)**: Code review enfocado en Principios III y VI; smoke manual de los estados de visibilidad (hide cuando 0-1 armas, show cuando ≥2).
