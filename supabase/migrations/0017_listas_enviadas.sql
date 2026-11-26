-- =====================================================================
-- 0017 · Registro de listas enviadas (pedido de Javier, 2026-11-26).
--
-- La app no ve si se apretó Enviar en Outlook: el registro se guarda
-- cuando se ARMA el correo (botón "Correo para Outlook" en Cotizar o
-- "Bajar N correos" en Enviar listas). De cada correo queda:
--   cliente, mes de la lista, quién lo armó, fecha y hora, destinatarios
--   (Para y CC), asunto y una copia de los precios que salieron.
-- Si al final no se mandó, se marca "No se envió" (descartado) y deja de
-- contar como enviado. No se borra: queda el historial.
--
-- Permisos:
--   * Todos ven todo.
--   * Cualquier usuario puede registrar un correo (de cualquier cliente:
--     en Enviar listas se pueden armar correos de clientes de otros);
--     queda a nombre de quien lo armó.
--   * Marcar / desmarcar "No se envió": quien lo armó, el dueño del
--     cliente o el administrador. Solo se puede cambiar esa marca.
--   * Borrar: solo el administrador.
--
-- Se puede volver a correr. Requiere 0013 (va después de 0016_inflacion).
-- =====================================================================

create table if not exists public.listas_enviadas (
  id              bigint generated always as identity primary key,
  cliente_id      bigint not null references public.clientes(id) on delete cascade,
  mes             date not null check (extract(day from mes) = 1),
  enviado_por     text not null default public.mi_email(),
  enviado_en      timestamptz not null default now(),
  para            text,
  cc              text,
  asunto          text,
  -- De dónde salió: 'cotizar' o 'enviar_listas'.
  origen          text,
  -- Copia de lo enviado: [{ "sku": 1, "descripcion": "...", "precio": 1.5 }, ...]
  precios         jsonb not null default '[]'::jsonb,
  cantidad_skus   integer generated always as (jsonb_array_length(precios)) stored,
  descartado      boolean not null default false,
  descartado_por  text,
  descartado_en   timestamptz
);
comment on table public.listas_enviadas is 'Correos de listas de precios armados para Outlook (uno por cliente y vez)';
comment on column public.listas_enviadas.descartado is 'Marcado "No se envió": no cuenta como enviado';
create index if not exists listas_enviadas_cliente on public.listas_enviadas (cliente_id, enviado_en desc);
create index if not exists listas_enviadas_mes on public.listas_enviadas (mes);

-- Quién y cuándo los pone la base (no se pueden falsear desde la app).
create or replace function public.completar_lista_enviada()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.enviado_por := public.mi_email();
    new.enviado_en := now();
    new.descartado := false;
    new.descartado_por := null;
    new.descartado_en := null;
  elsif new.descartado is distinct from old.descartado then
    new.descartado_por := case when new.descartado then public.mi_email() end;
    new.descartado_en := case when new.descartado then now() end;
  end if;
  return new;
end;
$$;
drop trigger if exists listas_enviadas_completar on public.listas_enviadas;
create trigger listas_enviadas_completar
  before insert or update on public.listas_enviadas
  for each row execute function public.completar_lista_enviada();

-- ---------- Permisos -------------------------------------------------
alter table public.listas_enviadas enable row level security;
drop policy if exists listas_enviadas_leer on public.listas_enviadas;
drop policy if exists listas_enviadas_agregar on public.listas_enviadas;
drop policy if exists listas_enviadas_editar on public.listas_enviadas;
drop policy if exists listas_enviadas_borrar on public.listas_enviadas;
create policy listas_enviadas_leer on public.listas_enviadas
  for select to authenticated using (public.es_autorizado());
create policy listas_enviadas_agregar on public.listas_enviadas
  for insert to authenticated with check (public.es_autorizado());
create policy listas_enviadas_editar on public.listas_enviadas
  for update to authenticated
  using (public.es_autorizado() and (enviado_por = public.mi_email() or public.es_dueno(cliente_id) or public.es_admin()))
  with check (public.es_autorizado());
create policy listas_enviadas_borrar on public.listas_enviadas
  for delete to authenticated using (public.es_admin());

revoke all on public.listas_enviadas from anon;
-- Desde la app solo se puede cambiar la marca "No se envió".
revoke update on public.listas_enviadas from authenticated;
grant select, insert, delete on public.listas_enviadas to authenticated;
grant update (descartado) on public.listas_enviadas to authenticated;

-- ---------- Resumen por cliente y mes de lista -----------------------
-- Para Enviar listas: cuándo se mandó por última vez cada lista (sin
-- contar los marcados "No se envió").
create or replace view public.v_envios_por_mes with (security_invoker = true) as
select cliente_id, mes, max(enviado_en) as ultimo_envio, count(*)::int as veces
from public.listas_enviadas
where not descartado
group by cliente_id, mes;

grant select on public.v_envios_por_mes to authenticated;
revoke all on public.v_envios_por_mes from anon;

-- Verificación
select count(*) as correos_registrados from public.listas_enviadas;
