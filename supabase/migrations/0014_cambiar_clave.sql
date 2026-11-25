-- =====================================================================
-- 0014 · Contraseña temporal (pedido de Javier, 2026-11-25).
-- usuarios_autorizados.cambiar_clave = true: al entrar, la app le pide
-- al usuario que cambie la contraseña antes de seguir (pantalla Mi cuenta).
-- clave_cambiada(): la app la llama después de cambiarla; apaga el aviso
-- solo para el usuario logueado.
-- Requiere 0013. Se puede correr más de una vez.
-- =====================================================================

alter table public.usuarios_autorizados
  add column if not exists cambiar_clave boolean not null default false;
comment on column public.usuarios_autorizados.cambiar_clave is
  'true = tiene una contraseña temporal: la app le pide cambiarla al entrar';

create or replace function public.clave_cambiada()
returns void
language sql
security definer
set search_path = public
as $$
  update public.usuarios_autorizados set cambiar_clave = false
  where email = public.mi_email();
$$;
revoke execute on function public.clave_cambiada() from anon, public;
grant execute on function public.clave_cambiada() to authenticated;

select email, nombre, es_admin, cambiar_clave from public.usuarios_autorizados order by creado_en;
