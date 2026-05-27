-- =====================================================================
-- HitFactor — Reemplazar trigger de qr_code por DEFAULT a nivel columna
-- =====================================================================
-- La 0012 usaba un trigger BEFORE INSERT para autogenerar el qr_code
-- cuando venía NULL. Funcionaba bien en runtime, pero `supabase gen_types`
-- no introspecta triggers: veía la columna como `text NOT NULL` sin
-- DEFAULT y la marcaba como required en el tipo `Insert`. Eso obligaba a
-- pasar qr_code desde el app code, contradiciendo la intención de
-- "delegar la generación a la DB".
--
-- Reemplazamos por un DEFAULT a nivel columna que llama al mismo
-- generador. Resultado:
--   - Comportamiento idéntico: si el INSERT no incluye qr_code, Postgres
--     calcula el default y lo guarda. Si lo incluye, se usa el provisto.
--   - `gen_types` ahora ve un DEFAULT y marca `qr_code?: string` en Insert
--     (opcional). El app code no necesita conocer la lógica.
--
-- Dropeamos el trigger y la función que lo respaldaba — la función pierde
-- su único caller. `gen_firearm_qr_code()` se mantiene porque sigue siendo
-- la fuente de los códigos vía el DEFAULT.
-- =====================================================================

drop trigger if exists firearms_assign_qr_code_trg on public.firearms;
drop function if exists public.firearms_assign_qr_code();

alter table public.firearms
  alter column qr_code set default public.gen_firearm_qr_code();
