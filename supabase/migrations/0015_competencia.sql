-- =====================================================================
-- 0015 · Módulo Competencia (pedido de Javier, 2026-11-25).
--
-- La competencia vende productos iguales a los nuestros con otros nombres
-- y a precios distintos en cada cliente. Se arma así:
--   * competidores            : maestro de competidores (Verallia, etc.).
--   * productos_competencia   : productos de cada competidor, con SU nombre,
--                               vinculados a NUESTRO SKU equivalente.
--   * precios_competencia     : precio de un producto de la competencia en
--                               un cliente y un mes (uno por cliente,
--                               producto y mes). Sin cliente = dato general
--                               de mercado.
--   * v_competencia           : cada precio con nuestro precio a ese cliente
--                               y la lista general, para el informe
--                               (mínimo, máximo, promedio, diferencia).
--
-- Permisos (como 0013):
--   * Todos ven todo.
--   * Precios de competencia de un cliente: solo el dueño del cliente.
--     Sin cliente (mercado): solo el administrador.
--   * Competidores y productos: cualquiera agrega (para poder cargar sin
--     esperar); corregir o borrar, solo el administrador.
--
-- Se puede volver a correr. Requiere 0013.
-- =====================================================================

-- ---------- 1. Competidores ------------------------------------------
create table if not exists public.competidores (
  id            bigint generated always as identity primary key,
  nombre        text not null check (length(trim(nombre)) > 0),
  activo        boolean not null default true,
  observaciones text,
  creado_por    text default public.mi_email(),
  creado_en     timestamptz not null default now()
);
create unique index if not exists competidores_nombre_unico on public.competidores (lower(trim(nombre)));

-- ---------- 2. Productos de la competencia ---------------------------
create table if not exists public.productos_competencia (
  id             bigint generated always as identity primary key,
  competidor_id  bigint not null references public.competidores(id) on delete restrict,
  nombre         text not null check (length(trim(nombre)) > 0),
  sku            bigint not null references public.skus(sku) on update cascade,
  activo         boolean not null default true,
  observaciones  text,
  creado_por     text default public.mi_email(),
  creado_en      timestamptz not null default now()
);
create unique index if not exists productos_competencia_nombre_unico
  on public.productos_competencia (competidor_id, lower(trim(nombre)));
create index if not exists productos_competencia_sku on public.productos_competencia (sku);
comment on column public.productos_competencia.nombre is 'Nombre con que lo vende el competidor';
comment on column public.productos_competencia.sku is 'Nuestro SKU equivalente';

-- ---------- 3. Precios de competencia: pasan a usar el producto -------
alter table public.precios_competencia add column if not exists producto_id bigint
  references public.productos_competencia(id) on delete restrict;
alter table public.precios_competencia add column if not exists cargado_por_email text default public.mi_email();
alter table public.precios_competencia add column if not exists actualizado_en timestamptz not null default now();

-- Datos que ya hubiera (de antes, sin producto): se crea el competidor y un
-- producto "SKU <n>" para cada uno, así no se pierde nada.
insert into public.competidores (nombre)
select distinct on (lower(trim(pc.competidor))) trim(pc.competidor) from public.precios_competencia pc
where pc.producto_id is null and pc.competidor is not null
  and not exists (select 1 from public.competidores c where lower(trim(c.nombre)) = lower(trim(pc.competidor)));

insert into public.productos_competencia (competidor_id, nombre, sku)
select distinct c.id, 'SKU ' || pc.sku, pc.sku
from public.precios_competencia pc
join public.competidores c on lower(trim(c.nombre)) = lower(trim(pc.competidor))
where pc.producto_id is null
  and not exists (select 1 from public.productos_competencia p
                  where p.competidor_id = c.id and lower(trim(p.nombre)) = lower('SKU ' || pc.sku));

update public.precios_competencia pc set producto_id = p.id
from public.competidores c
join public.productos_competencia p on p.competidor_id = c.id
where pc.producto_id is null
  and lower(trim(c.nombre)) = lower(trim(pc.competidor))
  and lower(trim(p.nombre)) = lower('SKU ' || pc.sku);

alter table public.precios_competencia alter column producto_id set not null;

-- SKU y nombre del competidor se copian del producto (no se escriben a mano).
create or replace function public.completar_precio_competencia()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  select p.sku, c.nombre into new.sku, new.competidor
  from productos_competencia p join competidores c on c.id = p.competidor_id
  where p.id = new.producto_id;
  -- Quién y cuándo: solo si cambió el dato (no al propagar un producto).
  if tg_op = 'INSERT' or new.precio is distinct from old.precio
     or new.observaciones is distinct from old.observaciones or new.mes is distinct from old.mes then
    new.actualizado_en := now();
    new.cargado_por_email := public.mi_email();
  end if;
  return new;
end;
$$;
drop trigger if exists precios_competencia_completar on public.precios_competencia;
create trigger precios_competencia_completar
  before insert or update on public.precios_competencia
  for each row execute function public.completar_precio_competencia();

-- Si el administrador corrige el SKU equivalente o el nombre del competidor,
-- se actualizan los precios ya cargados (security definer: son de todos).
create or replace function public.propagar_producto_competencia()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'productos_competencia' then
    if new.sku is distinct from old.sku or new.competidor_id is distinct from old.competidor_id then
      update precios_competencia set producto_id = producto_id where producto_id = new.id;
    end if;
  else
    if new.nombre is distinct from old.nombre then
      update precios_competencia pc set producto_id = pc.producto_id
      from productos_competencia p where p.id = pc.producto_id and p.competidor_id = new.id;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists productos_competencia_propagar on public.productos_competencia;
create trigger productos_competencia_propagar
  after update on public.productos_competencia
  for each row execute function public.propagar_producto_competencia();
drop trigger if exists competidores_propagar on public.competidores;
create trigger competidores_propagar
  after update on public.competidores
  for each row execute function public.propagar_producto_competencia();

-- Un precio por cliente, producto y mes (sin cliente = mercado, también uno).
-- Si había repetidos, queda el último cargado.
delete from public.precios_competencia a
using public.precios_competencia b
where a.producto_id = b.producto_id and a.mes = b.mes
  and a.cliente_id is not distinct from b.cliente_id
  and a.id < b.id;
alter table public.precios_competencia drop constraint if exists precios_competencia_unico;
alter table public.precios_competencia add constraint precios_competencia_unico
  unique nulls not distinct (cliente_id, producto_id, mes);
create index if not exists precios_competencia_sku_mes on public.precios_competencia (sku, mes);

-- ---------- 4. Permisos ----------------------------------------------
alter table public.competidores          enable row level security;
alter table public.productos_competencia enable row level security;

do $$
declare t text; p text;
begin
  foreach t in array array['competidores','productos_competencia'] loop
    foreach p in array array['leer','agregar','editar','borrar'] loop
      execute format('drop policy if exists %1$s_%2$s on public.%1$s', t, p);
    end loop;
    execute format('create policy %1$s_leer on public.%1$s for select to authenticated using (public.es_autorizado())', t);
    execute format('create policy %1$s_agregar on public.%1$s for insert to authenticated with check (public.es_autorizado())', t);
    execute format('create policy %1$s_editar on public.%1$s for update to authenticated using (public.es_admin()) with check (public.es_admin())', t);
    execute format('create policy %1$s_borrar on public.%1$s for delete to authenticated using (public.es_admin())', t);
  end loop;
end $$;
-- precios_competencia ya tiene sus permisos desde 0013 (dueño del cliente / admin).
revoke all on public.competidores, public.productos_competencia from anon;

-- ---------- 5. Vista para el informe ---------------------------------
-- Cada precio de competencia con:
--   nuestro_precio: lo que le cobramos a ese cliente ese SKU, en ese mes o,
--                   si no hay, el último mes anterior (nuestro_mes dice cuál).
--   lista:          lista general PUBLICADA vigente ese mes.
create or replace view public.v_competencia with (security_invoker = true) as
select
  pc.id, pc.mes, pc.precio, pc.observaciones,
  pc.cliente_id, c.nombre as cliente, c.nro_cliente, c.modalidad, c.dueno, n.nombre as nivel,
  pc.producto_id, p.nombre as producto, p.competidor_id, co.nombre as competidor,
  pc.sku, s.descripcion, s.familia, s.peso,
  nos.precio as nuestro_precio, nos.mes as nuestro_mes,
  l.precio as lista,
  pc.cargado_por_email, pc.actualizado_en
from public.precios_competencia pc
join public.productos_competencia p on p.id = pc.producto_id
join public.competidores co on co.id = p.competidor_id
join public.skus s on s.sku = pc.sku
left join public.clientes c on c.id = pc.cliente_id
left join public.niveles n on n.id = c.nivel_id
left join lateral (
  select pr.precio, pr.mes from public.precios_cliente pr
  where pr.cliente_id = pc.cliente_id and pr.sku = pc.sku and pr.mes <= pc.mes and pr.precio > 0
  order by pr.mes desc limit 1
) nos on true
left join lateral (
  select lg.precio from public.lista_general lg
  join public.listas_publicadas lp on lp.mes = lg.mes
  where lg.sku = pc.sku and lg.mes <= pc.mes
  order by lg.mes desc limit 1
) l on true;

grant select on public.v_competencia to authenticated;
revoke all on public.v_competencia from anon;

-- Verificación: competidores, productos y precios cargados.
select
  (select count(*) from public.competidores) as competidores,
  (select count(*) from public.productos_competencia) as productos,
  (select count(*) from public.precios_competencia) as precios;
