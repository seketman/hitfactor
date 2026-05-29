# HitFactor — documentación

## Documentos canónicos (current)

| Documento | Para qué |
|---|---|
| [`system-overview.md`](./system-overview.md) | **Snapshot del sistema completo** (al 2026-05-29, post-migración 0014). Decisiones que la app habilita, mapa de navegación, recorridos típicos, stack, arquitectura, modelo de datos, reglas de negocio e importación. Es el primer doc que leer para conocer el estado actual. |
| [`glossary.md`](./glossary.md) | Términos del dominio (tirador, match, claim, hit factor, etc.). Lectura obligatoria antes de escribir un spec o plan nuevo. |
| [`development.md`](./development.md) | Cómo levantar el proyecto en local. Variables de entorno. Migraciones. |
| [`deployment.md`](./deployment.md) | Cómo deployar a Vercel + Supabase. |

## Otros documentos

| Documento | Estado |
|---|---|
| [`../.specify/memory/constitution.md`](../.specify/memory/constitution.md) | **Principios no negociables** que toda feature respeta. Toda spec/plan nueva los chequea explícitamente. |
| [`../specs/`](../specs/) | Specs de features (formato SDD: `spec.md` + `plan.md` + `tasks.md` por feature). |

## Documentos legacy (v0)

Estos archivos fueron escritos al lanzamiento (v0, 2026-05-05) y **no se mantuvieron al día** con la evolución del producto. Su contenido está cubierto, actualizado y ampliado en [`system-overview.md`](./system-overview.md). Se mantienen por referencia histórica y se eliminarán cuando el equipo confirme que no hay matices únicos perdidos.

| Documento legacy | Reemplazado por |
|---|---|
| [`architecture.md`](./architecture.md) | [`system-overview.md`](./system-overview.md) §4 (Stack) y §5 (Arquitectura) |
| [`data-model.md`](./data-model.md) | [`system-overview.md`](./system-overview.md) §6 (Modelo de datos) |
| [`parsers.md`](./parsers.md) | [`system-overview.md`](./system-overview.md) §8.3 a §8.4 |
| [`importing.md`](./importing.md) | [`system-overview.md`](./system-overview.md) §8 completa (Importación y parsers) |
