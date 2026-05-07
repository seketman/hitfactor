-- =====================================================================
-- HitFactor — soporte Google OAuth en handle_new_user
-- =====================================================================
-- El trigger original (0001) leía solo `display_name` (email/password) y
-- `full_name` desde `raw_user_meta_data`. Google manda los campos como
-- `name` (y a veces `full_name`), nunca `display_name`. Sin esta migración,
-- los usuarios que entran via Google quedan con display_name = email-prefix
-- ("diego.demarziani") lo cual es feo en la UI.
--
-- Cadena de fallback:
--   display_name: 'display_name' → 'full_name' → 'name' → email-prefix
--   full_name:    'full_name' → 'name'
-- =====================================================================

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, full_name)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'display_name',
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      split_part(new.email, '@', 1)
    ),
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name'
    )
  );
  return new;
end;
$$;
