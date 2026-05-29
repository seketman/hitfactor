# HitFactor — Glosario

Términos del dominio de tiro deportivo y de la app, usados en specs, plans, código y UI. **Lectura obligatoria** antes de escribir un spec o plan nuevo: muchos términos tienen un significado preciso aquí y un significado coloquial distinto.

## Conceptos del dominio

**Tirador** — Persona que dispara en torneos. En código y DB sigue siendo `shooter` (term-of-art en planillas); en UI siempre **tirador**.

**Match** — Torneo. Unidad principal de competencia. Tiene una `discipline`, una `date`, un `name`, posiblemente un `region` (club), y se compone de stages y match_entries. En código y planillas: `match`.

**Stage** — Ejercicio individual dentro de un match. Algunas planillas IPSC también lo llaman *"Ej."* (Ejercicio). Un match tiene N stages numerados.

**Match entry** — La participación de un tirador en un match en una división determinada. En DB: `match_entries`. Es lo que se rankea para el resultado general. Un mismo tirador puede tener N match_entries en el mismo match si compite en varias divisiones.

**Stage result** — El resultado de un tirador en un stage específico. En DB: `stage_results`. Un match_entry tiene N stage_results (uno por stage del match).

**División** — Subcategoría de competidores dentro de un match. Las divisiones existen por disciplina: IPSC tiene Open, Production, PCC, etc.; Tiro FBI tiene PIS, REV, MINI, PCC; etc. En DB: `divisions`.

**Disciplina** — Rama del tiro deportivo. Las cuatro soportadas son **IPSC** (Tiro Práctico), **Steel Challenge**, **Combat Solutions** y **Tiro FBI**. Cada una tiene su scoring distinto.

**Scoring type** — Cómo se calcula el ranking:

- **`hit_factor`** (IPSC): (points − penalties) / time, normalizado a Match %.
- **`time_plus`** (Steel, Combat): menor tiempo total gana; el ranking se calcula por % relativo al mejor tiempo.
- **`points`** (Tiro FBI): hits-based, donde la cantidad de impactos es el criterio primario y los puntos desempatan.

**Hit factor** — En IPSC, métrica = `(points − penalties) / time`. Determina el match %.

**Match %** — % del hit factor (o equivalente) relativo al mejor de la división. Métrica primaria en IPSC, Steel y Combat. El ganador queda en 100%.

**Power factor** — Clasificación de munición por momento cinético: **Min** (Minor) o **Maj** (Major). Determina cuántos puntos vale cada hit en zonas no-A en IPSC.

**Hit-based / time-based / hit-factor-based** — Forma corta de referirse al `scoring_type` de una disciplina. Tiro FBI es hit-based; Steel y Combat son time-based; IPSC es hit-factor-based.

**Hits** — Cantidad de impactos. Solo se trackea en disciplinas hits-based (Tiro FBI: 0..40 a nivel match, 0..5 a nivel stage); `NULL` en IPSC/Steel.

**DQ** — *Disqualification*, descalificado. El tirador queda registrado pero no contribuye al ranking. En DB: `is_dq: boolean`.

**Ausente** — Anotado pero no se presentó. Distinto de DQ (no es por infracción). En DB: `is_absent: boolean`. Excluido de promedios (igual que DQ).

**Min shots** — Cantidad mínima de disparos requerida por reglamento. FBI = 45 (8 tiradas × 5 tiros + 5 warmup). En DB: `matches.min_shots`.

**Ammo efficiency / Eficiencia de munición** — Relación entre `rounds_fired` (en `match_firearm_log`) y `min_shots` (en `matches`). Mide cuántos disparos extra hiciste sobre el mínimo reglamentario. Tiers: *perfect* (0 extras), *neutral* (≤5%), *warning* (≤15%), *danger* (>15%).

## Conceptos de la app

**Claim** — El acto de un usuario marcando *"Soy yo"* sobre un shooter para asociarlo a su cuenta. Implementado en `src/lib/actions/claim.ts`.

**Identidad / Identidades múltiples** — Cada fila en `shooters` linkeada al usuario actual cuenta como una identidad. Un usuario puede tener N (multi-identidad, ver Principio II de la constitución).

**Sugerencia de claim** — Shooter detectado automáticamente como candidato a ser el usuario (matchea alias por nombre o member_number). Lógica en `src/lib/db/claim-suggestions.ts`.

**Importer / Match owner** — El usuario que subió la planilla del match. En DB: `matches.imported_by_user_id`. RLS le da permisos de UPDATE/DELETE sobre ese match (más admin con permiso global).

**Audit log** — Tabla `audit_log` con vocabulario de acciones canónicas (`<entidad>.<verbo>`: `shooter.claim`, `match.import`, `firearm.update`, etc.). Cada usuario solo ve lo suyo (RLS).

**Activity** — Cómo se llama el audit log en la UI: ruta `/activity`. El render lo hace `describeAuditEntry` con narrativa en segunda persona.

**Soy yo** — Label del botón de claim sobre la fila de un shooter no claimado. Tres letras chicas; el botón más importante de la app.

**Biblioteca compartida** — Modelo de datos donde un match importado por cualquier usuario queda disponible para todos. Ver Principio I de la constitución.

## Métricas estadísticas

(Definiciones técnicas viven en `src/lib/stats/shooter-stats.ts`. Estas son las descripciones de alto nivel.)

**Consistency / Consistencia** — Desvío estándar muestral (denominador `n−1`) del Match % a través de los matches válidos. Menor = más predecible. Tiers: *sólido* (<10), *normal* (<20), *volátil* (>20).

**Trajectory slope / Tendencia** — Pendiente β de la regresión lineal del Match % vs orden cronológico, en *"% por torneo"*. Positivo = mejorando.

**Percentile / Percentil** — `place / totalInDivision × 100`. **Más bajo = mejor** (top 10% es mejor que top 30%).

**Cadence / Cadencia** — Frecuencia de participación en torneos. Ventana fija de 90 días; expresado como matches/mes.

**Stage win rate** — % de stages donde quedaste en place=1.

**Podium rate** — % de stages donde quedaste en place 1..3.

**Penalty rate** — % de stages con `penalties > 0`. **`null`** si ningún stage del usuario tiene `penalties` no-null (caso normal en FBI y Steel — no las registran).

## Disciplinas soportadas (códigos canónicos)

Constantes en `src/lib/disciplines.ts`, deben coincidir 1:1 con `disciplines.code` en DB:

| Constante | `code` | Scoring | Métrica primaria en UI |
|---|---|---|---|
| `DISCIPLINE.IPSC` | `ipsc` | hit_factor | Match % |
| `DISCIPLINE.STEEL` | `steel_challenge` | time_plus | Match % |
| `DISCIPLINE.COMBAT` | `combat_solutions` | time_plus | Match % |
| `DISCIPLINE.FBI` | `tiro_fbi` | points (hits-based) | Hits |

## Roles y permisos

**Anon** — Sin sesión. Solo accede a rutas públicas: `/`, `/login`, `/signup`, `/auth/*`, `/q/[code]`.

**Authenticated** — Con sesión válida. Accede a todo `(app)/`, RLS limita lo que ve.

**Match owner** — `imported_by_user_id = auth.uid()`. Puede UPDATE/DELETE su match y stages/entries asociados.

**Shooter owner** — Usuario que claimeó un shooter (`shooters.linked_user_id = auth.uid()`). Puede UPDATE entries del shooter en cualquier match (no solo los propios).

**Admin del sitio** — `profiles.is_admin = true`. Puede UPDATE de cualquier match (p. ej. el `min_shots`). Bootstrap manual vía SQL UPDATE.

## Formatos de archivo importables

| Source type | Origen | Disciplina típica |
|---|---|---|
| `practiscore_match_html` | Export HTML de PractiScore | IPSC |
| `practiscore_combined_html` | Idem, sección "Combined" | IPSC |
| `practiscore_stage_html` | Stage individual de PractiScore | IPSC |
| `practiscore_steel_html` | Steel Challenge HTML | Steel |
| `winmss_pdf` | PDF de WinMSS / ESS | IPSC |
| `fbi_csv` | CSV de Google Sheets (Tiro FBI) | FBI |
| `fat_pdf` | PDF "Ranking Oficial" de la Federación Argentina de Tiro | FBI/IPSC/Steel/Combat (best-effort) |
| `manual` | Reservado para cargas manuales — no usado actualmente | — |
