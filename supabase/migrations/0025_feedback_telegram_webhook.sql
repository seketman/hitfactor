-- =====================================================================
-- HitFactor — Webhook de feedback hacia Telegram
-- =====================================================================
-- Declara el trigger `feedback_to_telegram`, que en cada INSERT sobre
-- `public.feedback` postea la fila nueva a la Edge Function
-- `feedback-telegram` (código en `supabase/functions/feedback-telegram/`).
--
-- Por qué llega recién en la 0025: el trigger existía en producción desde
-- 2026-06-08, creado a mano desde el dashboard, y nunca estuvo en el
-- repositorio. Se descubrió comparando el esquema real contra las
-- migraciones. Hasta el 2026-08-14 la función estaba desplegada con
-- `verify_jwt` apagado y sin ningún otro control, así que el endpoint
-- aceptaba POSTs de cualquiera: quien conociera la URL podía disparar
-- mensajes de Telegram con el contenido que quisiera.
--
-- El candado es el header `x-webhook-secret`, que la función compara
-- contra su propio secreto. Activar `verify_jwt` NO lo reemplaza: lo
-- único que verifica es que el JWT esté firmado por el proyecto, y la
-- anon key viaja en el bundle del browser.
--
-- ---------------------------------------------------------------------
-- Cómo aplicarla
-- ---------------------------------------------------------------------
-- El secreto y la URL del proyecto no viven en el repositorio (es
-- público, y además la URL cambia por entorno). Se pasan por settings de
-- sesión antes de correr el archivo:
--
--   select set_config('hitfactor.functions_base_url',
--                     'https://<project-ref>.supabase.co/functions/v1', false);
--   select set_config('hitfactor.feedback_webhook_secret',
--                     '<el secreto>', false);
--
-- Sin eso la migración aborta en vez de instalar un webhook a medias:
-- un trigger con el secreto equivocado devuelve 401 para siempre y no
-- rompe nada visible, porque `pg_net` es asíncrono y el INSERT termina
-- bien igual. Es exactamente el modo de falla que no queremos repetir.
--
-- El secreto tiene que ser el mismo que `FEEDBACK_WEBHOOK_SECRET` en los
-- secrets de la Edge Function. Después de aplicarla, verificar las dos
-- mitades como indica `supabase/functions/README.md` — que rechace a un
-- desconocido no prueba que acepte al trigger.
-- =====================================================================

do $$
declare
  v_base_url text := current_setting('hitfactor.functions_base_url', true);
  v_secret   text := current_setting('hitfactor.feedback_webhook_secret', true);
begin
  if v_base_url is null or v_base_url = '' then
    raise exception
      'Falta hitfactor.functions_base_url. Ver el encabezado de esta migración.';
  end if;

  if v_secret is null or v_secret = '' then
    raise exception
      'Falta hitfactor.feedback_webhook_secret. Ver el encabezado de esta migración.';
  end if;

  execute 'drop trigger if exists feedback_to_telegram on public.feedback';

  -- `supabase_functions.http_request` hornea sus argumentos en la
  -- definición del trigger, así que el secreto queda como literal en
  -- `pg_get_triggerdef`. Es el mecanismo estándar de los Database Webhooks
  -- de Supabase, y conviene ser explícito sobre quién puede leerlo, porque
  -- la respuesta no es "nadie":
  --
  --   * Cualquiera con acceso al dashboard. El SQL Editor es una web UI,
  --     no una conexión directa a Postgres: las network restrictions del
  --     proyecto no lo alcanzan.
  --   * Cualquiera con acceso a un backup o a un `pg_dump`: el DDL del
  --     trigger viaja adentro.
  --   * `pg_net` deja los headers salientes en `net.http_request_queue` en
  --     texto plano hasta que su limpieza los purga.
  --
  -- Lo que sí queda cerrado es la vía de la aplicación: PostgREST no
  -- expone `pg_catalog`, así que el rol `authenticated` no llega. El
  -- riesgo residual es de operadores y backups, y se acepta a sabiendas
  -- porque el secreto solo habilita mandar un mensaje de Telegram. Rotarlo
  -- es cambiar el secret de la Edge Function y volver a correr esto.
  execute format(
    'create trigger feedback_to_telegram '
    'after insert on public.feedback '
    'for each row execute function supabase_functions.http_request(%L, %L, %L, %L, %L)',
    v_base_url || '/feedback-telegram',
    'POST',
    jsonb_build_object(
      'Content-type', 'application/json',
      'x-webhook-secret', v_secret
    )::text,
    '{}',
    '5000'
  );

  -- El secreto queda en la sesión hasta que se cierre la conexión, y en el
  -- SQL Editor eso puede ser un buen rato. Se limpia acá para que la
  -- siguiente consulta que alguien corra en la misma pestaña no lo tenga a
  -- mano vía `current_setting`.
  perform set_config('hitfactor.feedback_webhook_secret', '', false);
  perform set_config('hitfactor.functions_base_url', '', false);

  -- Reaplicar esto con un secreto equivocado —pero no vacío— reemplaza un
  -- trigger que funcionaba por uno que va a dar 401 para siempre, y no hay
  -- forma de detectarlo desde acá: el secreto real vive en la Edge
  -- Function. `pg_net` es asíncrono, así que el INSERT sigue andando y la
  -- app no muestra nada. La única señal es verificarlo a mano.
  raise notice
    'Trigger feedback_to_telegram instalado. Verificá LAS DOS mitades antes de darlo por bueno (supabase/functions/README.md): que rechace a un desconocido NO prueba que acepte al trigger.';
end
$$;
