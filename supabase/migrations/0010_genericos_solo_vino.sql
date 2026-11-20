-- =====================================================================
-- 0010 · Genéricos solo con SKUs de vino (pedido de Javier, 2026-11-20).
-- Casi todos los genéricos son bodegas: se les dejan tildados solo los
-- SKUs de vino (familias BURDEOS, CÓNICA, ESPUMANTE, MERITAGE y BORGOÑA)
-- y se destildan Bitter, Cerveza y Alimentos (Tomate, Aceto).
-- Los ESPECIALES no se tocan.
--
-- Qué hace:
--   1. Nueva columna skus.para_genericos (sí/no): si va tildado en los
--      genéricos. Se marca "sí" solo en las familias de vino. Después se
--      cambia desde la pantalla SKUs (columna "Genéricos").
--   2. Destilda en los genéricos ya cargados los SKUs que no son de vino.
--      NO borra precios: el historial queda guardado; esos SKUs dejan de
--      aparecer al cotizar. Se pueden volver a tildar desde la ficha del
--      cliente (y el precio del mes actual se vuelve a calcular solo).
--   3. Genérico nuevo: arranca solo con los SKUs "para genéricos".
--      SKU nuevo: se tilda en los genéricos solo si es "para genéricos".
--
-- Los pasos 1 y 2 se hacen una sola vez (la primera vez que se corre).
-- Se puede volver a correr: no vuelve a destildar lo que tildaste a mano.
-- Requiere 0001 a 0009.
-- =====================================================================

-- ---------- 1 y 2. Columna nueva + destildar (solo la primera vez) ----
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'skus'
                   and column_name = 'para_genericos') then

    alter table public.skus
      add column para_genericos boolean not null default true;

    update public.skus
    set para_genericos = coalesce(
      upper(translate(trim(familia), 'ÁÉÍÓÚáéíóú', 'AEIOUaeiou'))
        in ('BURDEOS', 'CONICA', 'ESPUMANTE', 'MERITAGE', 'BORGOÑA', 'BORGONA'),
      false);

    update public.cliente_skus cs
    set activo = false
    from public.clientes c, public.skus s
    where c.id = cs.cliente_id and s.sku = cs.sku
      and c.modalidad = 'GENERICO'
      and cs.activo
      and not s.para_genericos;
  end if;
end;
$$;

comment on column public.skus.para_genericos is
  'Si va tildado en los clientes genéricos (al crear un genérico o un SKU nuevo). Por defecto solo vino.';

-- ---------- 3a. Alta de cliente ---------------------------------------
-- Especial: todos los SKUs activos (como antes).
-- Genérico: solo los SKUs activos marcados "para genéricos".
create or replace function public.preparar_grilla()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into cliente_skus (cliente_id, sku)
  select new.id, s.sku from skus s
  where s.estado = 'ACTIVO'
    and (new.modalidad <> 'GENERICO' or s.para_genericos)
  on conflict do nothing;
  return new;
end;
$$;

-- ---------- 3b. Alta de SKU -------------------------------------------
-- Se tilda en todos los genéricos solo si es "para genéricos".
create or replace function public.agregar_sku_a_genericos()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estado = 'ACTIVO' and new.para_genericos then
    insert into cliente_skus (cliente_id, sku)
    select c.id, new.sku from clientes c where c.modalidad = 'GENERICO' and c.activo
    on conflict do nothing;
  end if;
  return new;
end;
$$;

-- ---------- Resultado: cómo quedó cada SKU en los genéricos -----------
select s.sku, s.descripcion, s.familia,
       case when s.para_genericos then 'sí' else 'no' end as para_genericos,
       count(cs.cliente_id) filter (where cs.activo)     as genericos_tildados,
       count(cs.cliente_id) filter (where not cs.activo) as genericos_destildados
from public.skus s
left join public.cliente_skus cs on cs.sku = s.sku
  and cs.cliente_id in (select id from public.clientes where modalidad = 'GENERICO')
group by s.sku, s.descripcion, s.familia, s.para_genericos
order by s.para_genericos desc, s.familia, s.descripcion;
