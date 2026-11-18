-- =====================================================================
-- 0008 · Datos de contacto y comerciales del cliente (pedido de Javier,
-- 2026-11-18). Base para enviar cotizaciones por correo más adelante.
--   * contacto        -> "Nombre de contacto" (ya existía)
--   * email           -> "Email de contacto" (ya existía)
--   * condicion_pago  -> hasta 30 caracteres (ya existía; se limita)
--   * empaque_consignado (nuevo): sí / no
--   * marca_principal    (nuevo): texto
-- No borra ni cambia datos. Se puede correr más de una vez.
-- =====================================================================

alter table public.clientes
  add column if not exists empaque_consignado boolean not null default false,
  add column if not exists marca_principal text;

-- Condición de pago: máximo 30 caracteres para lo que se cargue de acá en
-- adelante ("not valid" = no rechaza lo que ya estuviera cargado).
alter table public.clientes drop constraint if exists clientes_condicion_pago_30;
alter table public.clientes
  add constraint clientes_condicion_pago_30 check (char_length(condicion_pago) <= 30) not valid;

comment on column public.clientes.contacto           is 'Nombre de contacto';
comment on column public.clientes.email              is 'Email de contacto';
comment on column public.clientes.condicion_pago     is 'Condiciones de pago (hasta 30 caracteres)';
comment on column public.clientes.empaque_consignado is 'El empaque es consignado (sí/no)';
comment on column public.clientes.marca_principal    is 'Marca principal del cliente';

-- Control: clientes con condición de pago de más de 30 caracteres (si sale
-- alguno, conviene acortarlo desde la ficha del cliente).
select nombre, condicion_pago, char_length(condicion_pago) as caracteres
from public.clientes
where char_length(condicion_pago) > 30
order by nombre;
