-- =====================================================================
-- 0009 · Otros nombres (sinónimos) de cada SKU, para "Pegar pedido" en
-- Cotizar (pedido de Javier, 2026-11-18).
-- Son las formas en que los clientes nombran el producto en sus pedidos
-- (ej. "Giuliana", "Cónica baja", "boca corcho", "verde = oliva"),
-- separadas por coma. La IA las usa para reconocer el SKU.
-- Se cargan en la pantalla SKUs. No borra nada y se puede correr más de
-- una vez. No depende de 0008: se puede correr antes o después.
-- =====================================================================
alter table public.skus
  add column if not exists sinonimos text
    check (char_length(sinonimos) <= 300);

comment on column public.skus.sinonimos is
  'Otros nombres con que los clientes piden este SKU, separados por coma (los usa "Pegar pedido")';
