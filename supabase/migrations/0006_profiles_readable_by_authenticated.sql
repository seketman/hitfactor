-- =====================================================================
-- HitFactor — profiles legibles para todos los usuarios autenticados
-- =====================================================================
-- La policy original solo permitía leer tu propio profile, lo que rompe
-- la UI de "Importado por X" en matches que subió otra persona.
--
-- En este contexto el display_name (y los demás campos del profile, que
-- son básicamente nombre + número de socio) no son privados: aparecen en
-- las planillas públicas de los torneos. Los abrimos al rol authenticated.
--
-- La policy de UPDATE sigue intacta: solo el dueño puede editar su profile.
-- =====================================================================

drop policy if exists "profiles_select_own" on public.profiles;

create policy "profiles_select_authenticated"
  on public.profiles for select
  to authenticated
  using (true);
