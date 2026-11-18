-- =====================================================================
-- 0006 · Lista general: historial de correcciones y listas "publicadas".
--   * Si se corrige o se borra un precio (o el mínimo) de la lista general,
--     el valor anterior queda en lista_general_cambios (nunca se pierde).
--   * Una lista guardada es un BORRADOR hasta que se aprieta Publicar.
--     Solo las listas publicadas llegan a los clientes genéricos:
--       - Cotizar usa solo listas PUBLICADAS (eso lo agrega la 0007, que
--         trae el selector de mes en Cotizar; esta 0006 no toca cotizar).
--       - Al crear un genérico, cambiarle el nivel o tildarle un SKU, sus
--         precios se calculan con la lista publicada vigente.
--   * Las listas de este mes o anteriores se marcan como publicadas (ver el
--     punto 5). Una lista de un mes futuro queda como borrador.
-- Requiere 0004 y 0005. Va antes de la 0007. Se puede correr más de una vez.
-- =====================================================================

-- ---------- 1. Historial de correcciones de la lista general ---------
create table if not exists public.lista_general_cambios (
  id               bigint generated always as identity primary key,
  mes              date not null,
  sku              bigint not null,
  precio_anterior  numeric(12,2) not null,
  precio_nuevo     numeric(12,2),            -- null = se borró
  minimo_anterior  numeric(12,2),
  minimo_nuevo     numeric(12,2),
  cambiado_por     uuid default auth.uid(),
  cambiado_en      timestamptz not null default now()
);
create index if not exists lista_general_cambios_mes on public.lista_general_cambios (mes, sku);

create or replace function public.registrar_cambio_lista()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    insert into lista_general_cambios (mes, sku, precio_anterior, precio_nuevo, minimo_anterior, minimo_nuevo)
    values (old.mes, old.sku, old.precio, null, old.precio_minimo, null);
    return old;
  end if;
  if new.precio is distinct from old.precio or new.precio_minimo is distinct from old.precio_minimo then
    insert into lista_general_cambios (mes, sku, precio_anterior, precio_nuevo, minimo_anterior, minimo_nuevo)
    values (old.mes, old.sku, old.precio, new.precio, old.precio_minimo, new.precio_minimo);
    new.cargado_en := now();
    new.cargado_por := auth.uid();
  end if;
  return new;
end;
$$;
drop trigger if exists lista_general_auditoria on public.lista_general;
create trigger lista_general_auditoria
  before update or delete on public.lista_general
  for each row execute function public.registrar_cambio_lista();

alter table public.lista_general_cambios enable row level security;
drop policy if exists lista_cambios_leer on public.lista_general_cambios;
create policy lista_cambios_leer on public.lista_general_cambios
  for select to authenticated using (public.es_autorizado());
revoke all on public.lista_general_cambios from anon;

-- ---------- 2. Listas publicadas --------------------------------------
create table if not exists public.listas_publicadas (
  mes            date primary key check (mes = date_trunc('month', mes)::date),
  publicada_en   timestamptz not null default now(),
  publicada_por  uuid default auth.uid()
);
alter table public.listas_publicadas enable row level security;
drop policy if exists listas_publicadas_leer on public.listas_publicadas;
drop policy if exists listas_publicadas_agregar on public.listas_publicadas;
drop policy if exists listas_publicadas_editar on public.listas_publicadas;
create policy listas_publicadas_leer on public.listas_publicadas
  for select to authenticated using (public.es_autorizado());
create policy listas_publicadas_agregar on public.listas_publicadas
  for insert to authenticated with check (public.es_autorizado());
create policy listas_publicadas_editar on public.listas_publicadas
  for update to authenticated using (public.es_autorizado()) with check (public.es_autorizado());
revoke all on public.listas_publicadas from anon;

-- Último mes con lista publicada que todavía tenga precios cargados
-- (null si todavía no hay ninguna).
create or replace function public.ultima_lista_publicada()
returns date
language sql
stable
security invoker
set search_path = public
as $$
  select max(lp.mes) from listas_publicadas lp
  where exists (select 1 from lista_general l where l.mes = lp.mes);
$$;

-- Lista PUBLICADA vigente a un mes: para cada SKU, la última publicada en
-- ese mes o antes (los borradores no cuentan).
create or replace function public.lista_vigente_publicada(p_mes date)
returns table (sku bigint, mes date, precio numeric, precio_minimo numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct on (l.sku) l.sku, l.mes, l.precio, l.precio_minimo
  from lista_general l
  join listas_publicadas lp on lp.mes = l.mes
  where l.mes <= p_mes
  order by l.sku, l.mes desc;
$$;

-- Estado de cada lista: borrador, publicada, o publicada con cambios
-- posteriores que todavía no llegaron a los genéricos.
create or replace view public.v_estado_listas with (security_invoker = true) as
select
  l.mes,
  count(*)                                   as skus,
  lp.publicada_en,
  greatest(max(l.cargado_en),
           (select max(c.cambiado_en) from public.lista_general_cambios c where c.mes = l.mes)) as ultimo_cambio
from public.lista_general l
left join public.listas_publicadas lp on lp.mes = l.mes
group by l.mes, lp.publicada_en;

-- ---------- 3. Publicar: además de guardar precios, marca el mes -----
create or replace function public.publicar_lista(p_mes date)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare v_filas integer;
begin
  p_mes := date_trunc('month', p_mes)::date;
  if not exists (select 1 from lista_general where mes = p_mes) then
    raise exception 'No hay lista general cargada para ese mes';
  end if;

  insert into precios_cliente (cliente_id, sku, mes, precio, origen)
  select c.id, l.sku, p_mes,
         precio_con_descuento(l.precio, n.descuento_pct, s.admite_descuento),
         'LISTA'
  from clientes c
  join niveles n on n.id = c.nivel_id
  join cliente_skus cs on cs.cliente_id = c.id and cs.activo
  join lista_general l on l.sku = cs.sku and l.mes = p_mes
  join skus s on s.sku = l.sku and s.estado = 'ACTIVO'
  where c.modalidad = 'GENERICO' and c.cotiza and c.activo
  on conflict (cliente_id, sku, mes) do update
    set precio = excluded.precio, origen = 'LISTA'
    where precios_cliente.precio is distinct from excluded.precio;
  get diagnostics v_filas = row_count;

  insert into listas_publicadas (mes) values (p_mes)
  on conflict (mes) do update set publicada_en = now(), publicada_por = auth.uid();

  return v_filas;
end;
$$;

-- ---------- 4. Genéricos al instante: solo con listas publicadas ------
create or replace function public.recalcular_cliente(p_cliente_id bigint, p_sku bigint default null)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare v_filas integer;
begin
  insert into precios_cliente (cliente_id, sku, mes, precio, origen)
  select c.id, l.sku, m.mes,
         precio_con_descuento(l.precio, n.descuento_pct, s.admite_descuento),
         'LISTA'
  from clientes c
  join niveles n on n.id = c.nivel_id
  cross join (
    select mes_actual() as mes
    union
    select mes from listas_publicadas where mes > mes_actual()
  ) m
  cross join lateral lista_vigente_publicada(m.mes) l
  join cliente_skus cs on cs.cliente_id = c.id and cs.sku = l.sku and cs.activo
  join skus s on s.sku = l.sku and s.estado = 'ACTIVO'
  where c.id = p_cliente_id
    and c.modalidad = 'GENERICO' and c.cotiza and c.activo
    and (p_sku is null or l.sku = p_sku)
  on conflict (cliente_id, sku, mes) do update
    set precio = excluded.precio, origen = 'LISTA'
    where precios_cliente.precio is distinct from excluded.precio;

  get diagnostics v_filas = row_count;
  return v_filas;
end;
$$;

revoke execute on function public.publicar_lista(date),
  public.ultima_lista_publicada(), public.lista_vigente_publicada(date) from anon, public;
grant execute on function public.publicar_lista(date),
  public.ultima_lista_publicada(), public.lista_vigente_publicada(date) to authenticated;

-- ---------- 5. Una sola vez: marcar como publicadas las listas en uso --
-- Se marcan como publicadas las listas de este mes o anteriores (ya están
-- en uso). Una lista de un mes FUTURO queda como borrador: cuando esté
-- lista, apretá Publicar en la pantalla Lista general.
insert into public.listas_publicadas (mes, publicada_en)
select l.mes, max(l.cargado_en)
from public.lista_general l
where l.mes <= public.mes_actual()
group by l.mes
on conflict (mes) do nothing;

-- Resultado: estado de cada lista.
select mes, skus,
       case when publicada_en is null then 'BORRADOR' else 'PUBLICADA' end as estado,
       publicada_en
from public.v_estado_listas
order by mes;
