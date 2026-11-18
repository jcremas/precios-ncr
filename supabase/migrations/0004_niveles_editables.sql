-- =====================================================================
-- 0004: niveles de descuento editables, con número de nivel (id).
--   * niveles: se agrega "id" (número fijo de cada nivel). El texto
--     pasa a llamarse "nombre" y se puede cambiar libremente.
--   * clientes: la columna "nivel" (texto) se reemplaza por "nivel_id",
--     enlazada al id del nivel. Se conservan los niveles de cada cliente.
--   * Cambiar el % de un nivel recalcula los precios del mes actual de
--     sus clientes genéricos (los meses anteriores no se tocan).
--   * No se puede borrar un nivel que tenga clientes.
-- Requiere haber corrido 0002. Se puede correr más de una vez.
-- Después de este archivo NO vuelvas a correr el 0002.
-- =====================================================================

-- ---------- 1. Estructura (solo la primera vez) ------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'clientes' and column_name = 'nivel_id') then

    -- Vistas que usan clientes.nivel: se vuelven a crear más abajo.
    drop view if exists public.v_indice_clientes;
    drop view if exists public.v_precios_detalle;
    drop view if exists public.v_lista_niveles;

    -- niveles: número fijo (id) y nombre editable.
    alter table public.niveles add column id integer generated always as identity;
    alter table public.niveles rename column codigo to nombre;

    -- clientes: nivel (texto) -> nivel_id (número), conservando los datos.
    alter table public.clientes add column nivel_id integer;
    update public.clientes c set nivel_id = n.id from public.niveles n where n.nombre = c.nivel;
    alter table public.clientes drop constraint if exists clientes_generico_con_nivel;
    alter table public.clientes drop constraint if exists clientes_nivel_fkey;
    alter table public.clientes drop column nivel;

    alter table public.niveles drop constraint niveles_pkey;
    alter table public.niveles add constraint niveles_pkey primary key (id);
    alter table public.niveles add constraint niveles_nombre_unico unique (nombre);
    alter table public.niveles add constraint niveles_nombre_valido
      check (length(trim(nombre)) > 0 and nombre = upper(trim(nombre)));

    alter table public.clientes add constraint clientes_nivel_fkey
      foreign key (nivel_id) references public.niveles(id) on delete restrict;
    alter table public.clientes add constraint clientes_generico_con_nivel
      check (modalidad = 'ESPECIAL' or not cotiza or nivel_id is not null);
  end if;
end $$;

-- ---------- 2. Permisos para editar niveles ----------------------------
drop policy if exists niveles_agregar on public.niveles;
drop policy if exists niveles_editar on public.niveles;
drop policy if exists niveles_borrar on public.niveles;
create policy niveles_agregar on public.niveles
  for insert to authenticated with check (public.es_autorizado());
create policy niveles_editar on public.niveles
  for update to authenticated using (public.es_autorizado()) with check (public.es_autorizado());
create policy niveles_borrar on public.niveles
  for delete to authenticated using (public.es_autorizado());

-- ---------- 3. Vistas (exponen "nivel" = nombre, y "nivel_id") ---------
create or replace view public.v_indice_clientes with (security_invoker = true) as
select
  c.id, c.nro_cliente, c.nombre, c.modalidad, n.nombre as nivel, c.cotiza, c.segmento, c.activo,
  (select count(*) from public.cliente_skus cs
     where cs.cliente_id = c.id and cs.activo)          as skus_activos,
  (select max(p.mes) from public.precios_cliente p
     where p.cliente_id = c.id)                          as ultimo_mes,
  c.nivel_id
from public.clientes c
left join public.niveles n on n.id = c.nivel_id;

-- "matar" = precio con el nivel de mayor descuento que exista.
create or replace view public.v_precios_detalle with (security_invoker = true) as
select
  p.mes, p.sku, s.descripcion, s.familia,
  c.id as cliente_id, c.nombre as cliente, c.nro_cliente, c.modalidad, n.nombre as nivel, c.segmento,
  p.precio, p.origen,
  lv.precio as lista,
  public.precio_con_descuento(lv.precio,
    (select coalesce(max(x.descuento_pct), 0) from public.niveles x), s.admite_descuento) as matar,
  lv.precio_minimo,
  c.nivel_id
from public.precios_cliente p
join public.clientes c on c.id = p.cliente_id
left join public.niveles n on n.id = c.nivel_id
join public.skus s on s.sku = p.sku
join public.cliente_skus cs on cs.cliente_id = p.cliente_id and cs.sku = p.sku and cs.activo
left join lateral (
  select l.precio, l.precio_minimo from public.lista_general l
  where l.sku = p.sku and l.mes <= p.mes
  order by l.mes desc limit 1
) lv on true;

-- ---------- 4. Funciones con nivel_id ----------------------------------
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
  return v_filas;
end;
$$;

create or replace function public.cotizar(p_cliente_id bigint)
returns table (sku bigint, descripcion text, precio numeric, mes date, origen text)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare c record;
begin
  select cl.modalidad, cl.cotiza, n.nombre as nivel, n.descuento_pct into c
  from clientes cl left join niveles n on n.id = cl.nivel_id
  where cl.id = p_cliente_id;

  if not found then raise exception 'Cliente % no encontrado', p_cliente_id; end if;
  if not c.cotiza then raise exception 'Este cliente está marcado como NO COTIZA'; end if;

  if c.modalidad = 'ESPECIAL' then
    return query
      select u.sku, s.descripcion, u.precio, u.mes, 'lista propia'::text
      from v_ultimo_precio_cliente u
      join cliente_skus cs on cs.cliente_id = u.cliente_id and cs.sku = u.sku and cs.activo
      join skus s on s.sku = u.sku
      where u.cliente_id = p_cliente_id
      order by s.descripcion, u.sku;
  else
    return query
      select l.sku, s.descripcion,
             precio_con_descuento(l.precio, c.descuento_pct, s.admite_descuento),
             l.mes,
             (case when s.admite_descuento then 'lista ' || c.nivel else 'lista (sin descuento)' end)::text
      from lista_vigente(date_trunc('month', now())::date) l
      join cliente_skus cs on cs.cliente_id = p_cliente_id and cs.sku = l.sku and cs.activo
      join skus s on s.sku = l.sku and s.estado = 'ACTIVO'
      order by s.descripcion, l.sku;
  end if;
end;
$$;

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
    select distinct mes from lista_general where mes > mes_actual()
  ) m
  cross join lateral lista_vigente(m.mes) l
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

create or replace function public.recalcular_cliente_trg()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT'
     or new.nivel_id is distinct from old.nivel_id
     or new.modalidad is distinct from old.modalidad
     or new.cotiza is distinct from old.cotiza
     or new.activo is distinct from old.activo then
    perform recalcular_cliente(new.id);
  end if;
  return null;
end;
$$;

-- Al cambiar el % de un nivel: recalcular sus clientes genéricos.
create or replace function public.recalcular_nivel_trg()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.descuento_pct is distinct from old.descuento_pct then
    perform recalcular_cliente(c.id)
    from clientes c
    where c.nivel_id = new.id and c.modalidad = 'GENERICO' and c.cotiza and c.activo;
  end if;
  return null;
end;
$$;
drop trigger if exists niveles_precios on public.niveles;
create trigger niveles_precios after update on public.niveles
  for each row execute function public.recalcular_nivel_trg();

-- Resultado: los niveles y cuántos clientes tiene cada uno.
select n.id, n.nombre, n.descuento_pct, n.orden, count(c.id) as clientes
from public.niveles n left join public.clientes c on c.nivel_id = n.id
group by n.id order by n.orden;
