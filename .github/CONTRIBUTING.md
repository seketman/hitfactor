# Contribuir a HitFactor

¡Gracias por querer aportar! HitFactor es una app open-source para tiradores
deportivos, y cualquier ayuda — bug reports, sugerencias, código, traducciones,
docs — es bienvenida.

Este documento te explica cómo levantar el proyecto en local, las
convenciones que seguimos, y el flujo de Pull Request.

## Setup local

Necesitás:

- Node.js 20+ y npm
- Una cuenta de [Supabase](https://supabase.com) (free tier alcanza) — vas a
  necesitar URL del proyecto + anon key
- Un cliente para correr migraciones SQL (el SQL Editor de Supabase mismo
  funciona)

Pasos:

```bash
git clone https://github.com/seketman/hitfactor.git
cd hitfactor
npm install
cp .env.example .env.local           # completar con credenciales de Supabase
# aplicar TODAS las migraciones de supabase/migrations/ en orden numérico
# en el SQL Editor de tu proyecto Supabase
npm run dev                          # http://localhost:3000
```

Más detalle en [docs/development.md](../docs/development.md).

## Antes de mandar el PR

Tu PR tiene que pasar el CI, que corre:

```bash
npx tsc --noEmit       # type-check, sin errores
npm test               # vitest, todos los tests verdes
npm run build          # build de producción funciona (en CI, no local obligatorio)
```

Si tu cambio toca lógica de negocio (parsers, importer, stats, claim), por
favor agregá o actualizá el test correspondiente en `tests/`. Hay fixtures
reales de PractiScore, FBI CSV y WinMSS PDF para reproducir casos.

## Convenciones de commit

Usamos **conventional commits** porque
[release-please](https://github.com/googleapis/release-please) los lee para
calcular la próxima versión y armar el CHANGELOG automáticamente:

| Prefijo | Cuándo usarlo | Efecto en versión |
|---|---|---|
| `feat:` | Nueva funcionalidad visible para el usuario | minor (1.0.0 → 1.1.0) |
| `fix:` | Bugfix | patch (1.0.0 → 1.0.1) |
| `perf:` | Mejora de performance sin cambio de API | patch |
| `refactor:` | Refactor interno sin cambio de comportamiento | patch |
| `docs:` | Solo documentación | patch |
| `chore:` / `test:` / `style:` / `ci:` / `build:` | Mantenimiento, tests, formato, CI, build | sin bump |
| `feat!:` o `BREAKING CHANGE:` en body | Cambio incompatible | major (1.0.0 → 2.0.0) |

Ejemplo:

```
feat(import): support WinMSS PDF format with by-stage layout

Adds parser for the ESS "Results by Stage" PDF variant used by some
clubs (TFABA Quilmes etc). The header is "<Division> - Results by Stage"
followed by a "Stage <Division> - Stage NN" subheader, and rows are
5-column (place, %, points, bib, name) — no raw hits/time/factor.
```

## Flujo de Pull Request

1. **Hacé fork** del repo desde GitHub.
2. **Branch a partir de `main`** con un nombre descriptivo:
   `feat/winmss-by-stage-parser`, `fix/duplicate-shooters-on-reupload`, etc.
3. **Commits con conventional commits** (ver arriba). Mejor 3 commits chicos
   y atómicos que un commit gigante.
4. **Corré los checks en local** antes de pushear (`tsc`, tests, opcional
   `npm run build`).
5. **Abrí el PR contra `main`** del repo original. Llená el template — sobre
   todo el "test plan", para que se vea qué probaste.
6. **Esperá review**. Como mantenedor solo hay uno por ahora, puede demorar
   unos días. Si hay cambios pedidos, los aplicás en commits adicionales
   (no fuerza-pushees el branch — preservar la historia ayuda a revisar).
7. **Squash & merge** lo hago yo desde GitHub al aprobar — vos no tenés que
   reorganizar nada.

## Reportar bugs

Abrí un [issue](https://github.com/seketman/hitfactor/issues/new/choose)
con el template de bug. Incluí:

- Versión que estás corriendo (la ves al pie del sidebar, ej `v1.2.0`)
- Pasos para reproducir
- Qué esperabas vs qué pasó
- Si es un import roto, **adjuntá el archivo** (PDF / HTML / CSV) que falla
  — sin él no podemos reproducir

## Sugerir features

Mismo lugar, template de feature request. Antes de invertir tiempo
codeando algo grande, abrí primero el issue para discutirlo — así
nos ahorramos retrabajos.

## Licencia

Al contribuir aceptás que tu código se distribuye bajo
[AGPL v3 o posterior](../LICENSE), la misma licencia del proyecto. En
particular: si alguien aloja HitFactor (o un fork) como servicio
público, está obligado a publicar el código fuente — incluido el tuyo.

## Código de conducta

Tratá a la comunidad como te gustaría ser tratado. Comentarios discriminatorios,
acoso, o ataques personales se moderan sin previo aviso. Si tenés que reportar
algo, mandame un mail privado (lo encontrás en mi perfil de GitHub).
