-- =====================================================================
-- 0003: datos del SKU en el maestro: peso, unidades por pallet y color.
-- Unidades por pallet se muestra en Cotizar. Se cargan en la pantalla
-- SKUs (a mano o pegando desde Excel). No borra nada y se puede correr
-- más de una vez.
-- =====================================================================
alter table public.skus
  add column if not exists peso numeric(10,2)
    check (peso >= 0),
  add column if not exists unidades_pallet integer
    check (unidades_pallet > 0),
  add column if not exists color varchar(10);
