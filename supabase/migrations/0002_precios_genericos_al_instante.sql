-- =====================================================================
-- 0002: los clientes genéricos tienen precios al instante.
--   * Al crear un cliente genérico se guardan sus precios del mes.
--   * Al cambiarle el nivel (o pasarlo a genérico, o volver a cotizarle)
--     se recalculan sus precios del mes desde la lista general vigente.
--   * Al tildarle un SKU se le guarda el precio de ese SKU.
-- Los meses anteriores no se tocan: el cambio queda como un mes más en
-- el historial. Si se corrige un precio del mismo mes, el anterior queda
-- en precios_cliente_cambios.
-- Se puede correr más de una vez sin problema, PERO NO después de 0004
-- (0004 deja la versión nueva de estas funciones).
-- =====================================================================

-- Mes actual en hora de Argentina (primer día del mes).
create or replace function public.mes_actual()
returns date
language sql
stable
set search_path = public
as $$
  select date_trunc('month', now() at time zone 'America/Argentina/Buenos_Aires')::date;
$$;

-- Guarda los precios de un cliente genérico: el mes actual con la lista
-- vigente, y cada mes posterior que ya tenga lista cargada.
-- p_sku = null recalcula todos sus SKUs tildados.
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
  join niveles n on n.codigo = c.nivel
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

-- Disparador en clientes: alta o cambio de nivel / modalidad / cotiza / activo.
-- (Se llama "clientes_precios" para correr después de "clientes_grilla",
-- que es el que le tilda los SKUs al cliente nuevo.)
create or replace function public.recalcular_cliente_trg()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT'
     or new.nivel is distinct from old.nivel
     or new.modalidad is distinct from old.modalidad
     or new.cotiza is distinct from old.cotiza
     or new.activo is distinct from old.activo then
    perform recalcular_cliente(new.id);
  end if;
  return null;
end;
$$;
drop trigger if exists clientes_precios on public.clientes;
create trigger clientes_precios after insert or update on public.clientes
  for each row execute function public.recalcular_cliente_trg();

-- Disparador en el mapa SKU × cliente: al tildar un SKU, su precio.
create or replace function public.recalcular_sku_cliente_trg()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.activo and (tg_op = 'INSERT' or not old.activo) then
    perform recalcular_cliente(new.cliente_id, new.sku);
  end if;
  return null;
end;
$$;
drop trigger if exists cliente_skus_precios on public.cliente_skus;
create trigger cliente_skus_precios after insert or update on public.cliente_skus
  for each row execute function public.recalcular_sku_cliente_trg();

revoke execute on function public.recalcular_cliente(bigint, bigint) from anon, public;
grant execute on function public.recalcular_cliente(bigint, bigint) to authenticated;

-- Una sola vez: los genéricos que ya existen y todavía no tienen ningún
-- precio reciben los del mes actual.
select c.nombre, public.recalcular_cliente(c.id) as precios_guardados
from public.clientes c
where c.modalidad = 'GENERICO' and c.cotiza and c.activo
  and not exists (select 1 from public.precios_cliente p where p.cliente_id = c.id);
