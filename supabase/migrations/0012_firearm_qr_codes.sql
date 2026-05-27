-- =====================================================================
-- HitFactor — Códigos cortos para QR de armas (#58 follow-up)
-- =====================================================================
-- Antes el QR pegado al arma encodeaba la URL completa
-- (`https://app/firearms/<uuid>?log=1#log-form` ≈ 85 chars), lo que daba
-- un patrón QR denso y forzaba al usuario a imprimir stickers grandes.
-- Reemplazamos por un código corto único por arma (6 chars del alfabeto
-- sin ambigüedades visuales — sin O/0/I/1/L) y una ruta /q/{code} que
-- redirige al detalle. URL final ≈ 30 chars, QR ~60% del tamaño anterior.
--
-- Decisiones:
--  - Alfabeto de 31 caracteres (ABCDEFGHJKMNPQRSTUVWXYZ23456789): 31^6 ≈
--    887M combinaciones. A escala de personal-catalog (≪ 10k armas) las
--    colisiones son astronómicamente raras.
--  - El código se genera vía trigger BEFORE INSERT — el código del app
--    no necesita conocer la lógica; sigue insertando como antes. Si por
--    accidente cae una colisión, el UNIQUE constraint hace fallar el
--    insert con 23505 y el caller puede retry-ear (no hay retry hoy
--    porque la probabilidad es despreciable).
--  - El resolver `resolve_firearm_qr_code(code)` es SECURITY DEFINER y
--    GRANT EXECUTE a anon/authenticated. Esto es deliberado: la ruta
--    /q/{code} tiene que resolver SIN autenticar (el QR scaneado puede
--    estar en un device deslogueado; el redirect lleva al login con
--    `?next=`). Exponer el mapping code→id no es sensible: si alguien
--    tiene el código físicamente, ya conoce el arma.
-- =====================================================================

-- 1) Columna nullable (para que el backfill pueda llenar antes del NOT NULL)
alter table public.firearms
  add column qr_code text unique;

-- 2) Generador de códigos: alfabeto sin ambiguities, longitud 6
create or replace function public.gen_firearm_qr_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  -- Sin O/0/I/1/L (confusables al leer del sticker pegado)
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text := '';
  i int;
begin
  for i in 1..6 loop
    code := code || substr(
      alphabet,
      1 + floor(random() * length(alphabet))::int,
      1
    );
  end loop;
  return code;
end;
$$;

-- 3) Backfill: asignar códigos a las armas existentes con retry-on-collision
do $$
declare
  f record;
  attempt int;
  candidate text;
begin
  for f in select id from public.firearms where qr_code is null loop
    attempt := 0;
    loop
      candidate := public.gen_firearm_qr_code();
      begin
        update public.firearms set qr_code = candidate where id = f.id;
        exit;
      exception when unique_violation then
        attempt := attempt + 1;
        if attempt > 10 then
          raise exception
            'No se pudo asignar QR code único a arma % tras 10 intentos',
            f.id;
        end if;
      end;
    end loop;
  end loop;
end $$;

-- 4) Ya todas las filas tienen código → endurecemos a NOT NULL
alter table public.firearms
  alter column qr_code set not null;

-- 5) Trigger BEFORE INSERT: auto-asigna si viene NULL
create or replace function public.firearms_assign_qr_code()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.qr_code is null then
    new.qr_code := public.gen_firearm_qr_code();
  end if;
  return new;
end;
$$;

create trigger firearms_assign_qr_code_trg
  before insert on public.firearms
  for each row execute function public.firearms_assign_qr_code();

-- 6) RPC para resolver code → firearm_id desde /q/{code}.
--    SECURITY DEFINER porque la ruta puede invocarse sin sesión; el
--    redirect final (/firearms/{id}?log=1#log-form) maneja auth + RLS.
create or replace function public.resolve_firearm_qr_code(p_code text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.firearms where qr_code = p_code;
$$;

revoke execute on function public.resolve_firearm_qr_code(text) from public;
grant execute on function public.resolve_firearm_qr_code(text)
  to anon, authenticated;

comment on column public.firearms.qr_code is
  'Código corto único (6 chars, alfabeto sin ambiguities) usado en /q/{code} para redirigir al detalle del arma. Asignado automáticamente vía trigger.';
