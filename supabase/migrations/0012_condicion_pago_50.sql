-- =====================================================================
-- 0012 · Condición de pago: hasta 50 caracteres (pedido de Javier,
-- 2026-11-24). Reemplaza el límite de 30 del 0008.
-- No borra ni cambia datos. Se puede correr más de una vez.
-- (No volver a correr 0008 después de esta: vuelve a poner 30.)
-- =====================================================================

alter table public.clientes drop constraint if exists clientes_condicion_pago_30;
alter table public.clientes drop constraint if exists clientes_condicion_pago_50;
alter table public.clientes
  add constraint clientes_condicion_pago_50 check (char_length(condicion_pago) <= 50);

comment on column public.clientes.condicion_pago is 'Condiciones de pago (hasta 50 caracteres)';
