-- =====================================================================
-- 0005 · Cotizar: solo los precios del mes más nuevo (pedido de Javier,
-- 2026-11-18). No se mezclan meses: si en el último mes un SKU no tiene
-- precio (se decidió no cotizarlo), no aparece, aunque tenga precio en
-- un mes anterior.
--   * ESPECIAL: sus precios del último mes cargado para ese cliente.
--   * GENÉRICO: la última lista general (solo los SKUs de ese mes) menos
--     el descuento de su nivel. Si todavía no hay lista general, sus
--     precios guardados del último mes.
-- Se puede correr más de una vez. Requiere 0004.
-- =====================================================================

create or replace function public.cotizar(p_cliente_id bigint)
returns table (sku bigint, descripcion text, precio numeric, mes date, origen text)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  c record;
  v_mes date;
begin
  select cl.modalidad, cl.cotiza, n.nombre as nivel, n.descuento_pct into c
  from clientes cl left join niveles n on n.id = cl.nivel_id
  where cl.id = p_cliente_id;

  if not found then raise exception 'Cliente % no encontrado', p_cliente_id; end if;
  if not c.cotiza then raise exception 'Este cliente está marcado como NO COTIZA'; end if;

  if c.modalidad = 'GENERICO' then
    select max(l.mes) into v_mes from lista_general l;
    if v_mes is not null then
      return query
        select l.sku, s.descripcion,
               precio_con_descuento(l.precio, c.descuento_pct, s.admite_descuento),
               l.mes,
               (case when s.admite_descuento then 'lista ' || c.nivel else 'lista (sin descuento)' end)::text
        from lista_general l
        join cliente_skus cs on cs.cliente_id = p_cliente_id and cs.sku = l.sku and cs.activo
        join skus s on s.sku = l.sku and s.estado = 'ACTIVO'
        where l.mes = v_mes
        order by s.descripcion, l.sku;
      return;
    end if;
  end if;

  -- Especial (o genérico sin lista general): último mes con precios del cliente.
  select max(p.mes) into v_mes from precios_cliente p where p.cliente_id = p_cliente_id;
  return query
    select p.sku, s.descripcion, p.precio, p.mes,
           (case when c.modalidad = 'ESPECIAL' then 'lista propia' else 'último precio guardado' end)::text
    from precios_cliente p
    join cliente_skus cs on cs.cliente_id = p.cliente_id and cs.sku = p.sku and cs.activo
    join skus s on s.sku = p.sku
    where p.cliente_id = p_cliente_id and p.mes = v_mes
    order by s.descripcion, p.sku;
end;
$$;

revoke execute on function public.cotizar(bigint) from anon, public;
grant execute on function public.cotizar(bigint) to authenticated;
