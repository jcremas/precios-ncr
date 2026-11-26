-- =====================================================================
-- 0016 · Inflación mensual (IPC) para comparar los aumentos (pedido de
-- Javier, 2026-11-26).
-- inflacion: un % por mes (ej. 2,7 = los precios subieron 2,7% ese mes
-- respecto del anterior). Lo carga a mano el administrador; todos lo leen.
-- La app lo usa en Inicio: gráfico "Aumento acumulado vs. inflación".
-- Requiere 0013 (es_admin, mi_email). Se puede correr más de una vez.
-- =====================================================================

create table if not exists public.inflacion (
  mes             date primary key check (mes = date_trunc('month', mes)::date),
  ipc_pct         numeric(6,2) not null check (ipc_pct > -50 and ipc_pct < 100),
  cargado_por     text default public.mi_email(),
  actualizado_en  timestamptz not null default now()
);
comment on table public.inflacion is 'IPC mensual en % (variación contra el mes anterior), cargado a mano';

create or replace function public.inflacion_tocar()
returns trigger language plpgsql as $$
begin
  new.actualizado_en := now();
  new.cargado_por := public.mi_email();
  return new;
end;
$$;
drop trigger if exists inflacion_tocar on public.inflacion;
create trigger inflacion_tocar before insert or update on public.inflacion
  for each row execute function public.inflacion_tocar();

alter table public.inflacion enable row level security;
drop policy if exists inflacion_leer on public.inflacion;
drop policy if exists inflacion_agregar on public.inflacion;
drop policy if exists inflacion_editar on public.inflacion;
drop policy if exists inflacion_borrar on public.inflacion;
create policy inflacion_leer on public.inflacion
  for select to authenticated using (public.es_autorizado());
create policy inflacion_agregar on public.inflacion
  for insert to authenticated with check (public.es_admin());
create policy inflacion_editar on public.inflacion
  for update to authenticated using (public.es_admin()) with check (public.es_admin());
create policy inflacion_borrar on public.inflacion
  for delete to authenticated using (public.es_admin());
revoke all on public.inflacion from anon;
grant select, insert, update, delete on public.inflacion to authenticated;

-- Datos iniciales: IPC Nivel General Nacional, INDEC (serie
-- 148.3_INIVELNAL_DICI_M_26 de apis.datos.gob.ar, variación % contra el mes
-- anterior, redondeada a 1 decimal como la publica el INDEC; consultada el
-- 2026-11-26). No pisa lo que ya esté cargado. Los meses nuevos se traen
-- desde la app (Inicio > "Traer del INDEC") o se cargan a mano.
insert into public.inflacion (mes, ipc_pct) values
  ('2025-11-01', 2.5),
  ('2025-12-01', 2.8),
  ('2026-01-01', 2.9),
  ('2026-02-01', 2.9),
  ('2026-03-01', 3.4),
  ('2026-04-01', 2.6),
  ('2026-05-01', 2.1),
  ('2026-06-01', 1.9),
  ('2026-07-01', 2.1),
  ('2026-08-01', 1.7),
  ('2026-09-01', 1.9),
  ('2026-10-01', 2.2)
on conflict (mes) do nothing;

-- Verificación
select mes, ipc_pct from public.inflacion order by mes;
