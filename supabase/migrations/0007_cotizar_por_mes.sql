-- =====================================================================
-- 0007 · Cotizar por mes (pedido de Javier, 2026-11-18).
-- Reemplaza la función cotizar del 0005.
--   * meses_cotizables(cliente): los meses que se pueden cotizar a ese
--     cliente, del más nuevo al más viejo. La pantalla elige el primero.
--   * cotizar(cliente, mes): SOLO los precios de ese mes, sin mezclar
--     meses. Sin mes = el más nuevo. Si un SKU no tiene precio ese mes,
--     o está en cero (se decidió no cotizarlo), no aparece.
--       - Si el cliente tiene precios guardados ese mes, se usan esos
--         (especial: su lista; genérico: lo que se le guardó ese mes).
--       - Genérico sin precios guardados ese mes: la lista general de
--         ese mes menos el descuento actual de su nivel, solo si esa
--         lista está PUBLICADA (tabla listas_publicadas, del 0006).
-- Se puede correr más de una vez. Requiere 0004 y 0006.
-- =====================================================================

drop function if exists public.cotizar(bigint);

create or replace function public.meses_cotizables(p_cliente_id bigint)
returns table (mes date)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct p.mes from precios_cliente p
  join cliente_skus cs on cs.cliente_id = p.cliente_id and cs.sku = p.sku and cs.activo
  where p.cliente_id = p_cliente_id and p.precio > 0
  union
  select lp.mes from listas_publicadas lp
  join clientes c on c.id = p_cliente_id and c.modalidad = 'GENERICO'
  order by 1 desc;
$$;

create or replace function public.cotizar(p_cliente_id bigint, p_mes date default null)
returns table (sku bigint, descripcion text, precio numeric, mes date, origen text)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  c record;
  v_mes date := p_mes;
begin
  select cl.modalidad, cl.cotiza, n.nombre as nivel, n.descuento_pct into c
  from clientes cl left join niveles n on n.id = cl.nivel_id
  where cl.id = p_cliente_id;

  if not found then raise exception 'Cliente % no encontrado', p_cliente_id; end if;
  if not c.cotiza then raise exception 'Este cliente está marcado como NO COTIZA'; end if;

  if v_mes is null then
    select max(m.mes) into v_mes from meses_cotizables(p_cliente_id) m;
  end if;
  v_mes := date_trunc('month', v_mes)::date;

  -- Precios guardados del cliente en ese mes.
  if exists (select 1 from precios_cliente p
             join cliente_skus cs on cs.cliente_id = p.cliente_id and cs.sku = p.sku and cs.activo
             where p.cliente_id = p_cliente_id and p.mes = v_mes and p.precio > 0) then
    return query
      select p.sku, s.descripcion, p.precio, p.mes,
             (case when c.modalidad = 'ESPECIAL' then 'lista propia' else 'precio guardado' end)::text
      from precios_cliente p
      join cliente_skus cs on cs.cliente_id = p.cliente_id and cs.sku = p.sku and cs.activo
      join skus s on s.sku = p.sku
      where p.cliente_id = p_cliente_id and p.mes = v_mes and p.precio > 0
      order by s.descripcion, p.sku;
    return;
  end if;

  -- Genérico sin precios guardados ese mes: lista general publicada de ese mes.
  if c.modalidad = 'GENERICO' and exists (select 1 from listas_publicadas lp where lp.mes = v_mes) then
    return query
      select l.sku, s.descripcion,
             precio_con_descuento(l.precio, c.descuento_pct, s.admite_descuento),
             l.mes,
             (case when s.admite_descuento then 'lista ' || c.nivel else 'lista (sin descuento)' end)::text
      from lista_general l
      join cliente_skus cs on cs.cliente_id = p_cliente_id and cs.sku = l.sku and cs.activo
      join skus s on s.sku = l.sku and s.estado = 'ACTIVO'
      where l.mes = v_mes and l.precio > 0
      order by s.descripcion, l.sku;
  end if;
end;
$$;

revoke execute on function public.cotizar(bigint, date), public.meses_cotizables(bigint) from anon, public;
grant execute on function public.cotizar(bigint, date), public.meses_cotizables(bigint) to authenticated;
