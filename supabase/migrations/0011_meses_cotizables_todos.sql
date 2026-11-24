-- =====================================================================
-- 0011 · Meses con lista de TODOS los clientes, en una sola consulta
-- (pedido de Javier, 2026-11-24, pantalla "Enviar listas").
--   * meses_cotizables_todos(): una fila por (cliente, mes) que se puede
--     cotizar, con la misma regla que meses_cotizables(cliente) del 0007:
--       - meses con precios guardados > 0 en SKUs tildados del cliente;
--       - genéricos: además, los meses con lista general PUBLICADA.
--   Sirve para elegir un mes (por ejemplo DIC 2026) y ver solo los
--   clientes que tienen lista ese mes, o ver la última lista de cada uno.
-- No borra ni cambia datos. Se puede correr más de una vez. Requiere 0006.
-- =====================================================================

create or replace function public.meses_cotizables_todos()
returns table (cliente_id bigint, mes date)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct p.cliente_id, p.mes from precios_cliente p
  join cliente_skus cs on cs.cliente_id = p.cliente_id and cs.sku = p.sku and cs.activo
  where p.precio > 0
  union
  select c.id, lp.mes from clientes c
  cross join listas_publicadas lp
  where c.modalidad = 'GENERICO';
$$;

revoke execute on function public.meses_cotizables_todos() from anon, public;
grant execute on function public.meses_cotizables_todos() to authenticated;
