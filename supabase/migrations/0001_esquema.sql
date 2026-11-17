-- =====================================================================
-- Sistema de precios por cliente - Nueva Cristalería Rosario
-- Esquema completo. Se corre UNA vez en Supabase (SQL Editor), sobre una
-- base vacía. Para empezar de cero, correr antes supabase/reset.sql.
-- Reglas:
--   * El SKU es siempre un número entero y es la clave permanente.
--   * Los meses se guardan como fecha del día 1 (ej. 2026-05-01 = MAY 2026).
--   * Un precio por (cliente, SKU, mes). Si se corrige, el valor anterior
--     queda registrado en precios_cliente_cambios (nunca se pierde).
--   * Solo usuarios autenticados Y autorizados ven o tocan datos (RLS).
--   * Todos los clientes tienen su tabla de precios (precios_cliente):
--       GENÉRICO: lista general menos el descuento de su nivel; se
--                 recalcula al publicar una lista general nueva.
--       ESPECIAL: lista propia negociada; se maneja con % y a mano.
--     "Cotiza" sí/no bloquea a un cliente sin borrarlo.
--   * Lista general: un precio LISTA por SKU y mes + precio mínimo (piso).
--     Niveles = LISTA × (1 − descuento) redondeado a 1 decimal, salvo SKUs
--     marcados "sin descuento".
-- =====================================================================

-- ---------- Usuarios autorizados -------------------------------------
-- Aunque alguien logre crear un usuario, sin estar en esta tabla no ve nada.
create table public.usuarios_autorizados (
  email      text primary key check (email = lower(email)),
  nombre     text,
  creado_en  timestamptz not null default now()
);

create or replace function public.es_autorizado()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.usuarios_autorizados
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- ---------- Niveles ----------------------------------------------------
create table public.niveles (
  codigo         text primary key,
  descuento_pct  numeric(5,2) not null check (descuento_pct between 0 and 100),
  orden          smallint not null
);

insert into public.niveles (codigo, descuento_pct, orden) values
  ('LISTA', 0, 1), ('MEDIO', 3, 2), ('AGRESIVO', 6, 3), ('DIEGO', 10, 4), ('MATAR', 15, 5);

-- ---------- SKUs -------------------------------------------------------
create table public.skus (
  sku             bigint primary key check (sku > 0),
  descripcion     text not null check (length(trim(descripcion)) > 0),
  familia         text,
  estado          text not null default 'ACTIVO'
                  check (estado in ('ACTIVO', 'INACTIVO', 'DESCONTINUADO')),
  admite_descuento boolean not null default true,  -- false = mismo precio en todos los niveles
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now()
);

-- ---------- Clientes ---------------------------------------------------
create table public.clientes (
  id                 bigint generated always as identity primary key,
  nro_cliente        text unique,
  segmento           text,
  nombre             text not null check (length(trim(nombre)) > 0),
  nombre_hoja_excel  text,           -- nombre recortado de la pestaña, solo para la migración
  contacto           text,
  email              text,
  condicion_pago     text,
  modalidad          text not null default 'GENERICO' check (modalidad in ('GENERICO', 'ESPECIAL')),
  nivel              text references public.niveles(codigo),  -- descuento (genéricos) o referencia (especiales)
  cotiza             boolean not null default true,
  observaciones      text,
  activo             boolean not null default true,
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now(),
  -- Un genérico que cotiza necesita su nivel de descuento.
  constraint clientes_generico_con_nivel check (modalidad = 'ESPECIAL' or not cotiza or nivel is not null)
);
create unique index clientes_nombre_unico on public.clientes (upper(trim(nombre)));

-- Mapa SKU × cliente: qué SKUs se le cotizan a cada uno.
create table public.cliente_skus (
  cliente_id  bigint not null references public.clientes(id) on delete cascade,
  sku         bigint not null references public.skus(sku) on update cascade,
  activo      boolean not null default true,
  creado_en   timestamptz not null default now(),
  primary key (cliente_id, sku)
);

-- ---------- Lista general por mes -------------------------------------
create table public.lista_general (
  mes            date not null check (mes = date_trunc('month', mes)::date),
  sku            bigint not null references public.skus(sku) on update cascade,
  precio         numeric(12,2) not null check (precio > 0),
  precio_minimo  numeric(12,2) check (precio_minimo > 0),  -- precio piso de referencia
  cargado_por    uuid default auth.uid(),
  cargado_en     timestamptz not null default now(),
  primary key (mes, sku)
);

-- ---------- Precios por cliente (historial) ----------------------------
create table public.precios_cliente (
  id           bigint generated always as identity primary key,
  cliente_id   bigint not null references public.clientes(id) on delete restrict,
  sku          bigint not null references public.skus(sku) on update cascade,
  mes          date not null check (mes = date_trunc('month', mes)::date),
  precio       numeric(12,2) not null check (precio > 0),
  origen       text not null default 'MANUAL'
               check (origen in ('LISTA', 'AUMENTO', 'MANUAL', 'MIGRACION')),
  nota         text,
  cargado_por  uuid default auth.uid(),
  cargado_en   timestamptz not null default now(),
  unique (cliente_id, sku, mes)
);
create index precios_cliente_mes on public.precios_cliente (mes);

-- Registro de correcciones: si se cambia o borra un precio ya cargado,
-- el valor viejo queda acá.
create table public.precios_cliente_cambios (
  id               bigint generated always as identity primary key,
  precio_id        bigint not null,
  cliente_id       bigint not null,
  sku              bigint not null,
  mes              date not null,
  precio_anterior  numeric(12,2) not null,
  precio_nuevo     numeric(12,2),           -- null = se borró
  cambiado_por     uuid default auth.uid(),
  cambiado_en      timestamptz not null default now()
);

create or replace function public.registrar_cambio_precio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    insert into precios_cliente_cambios (precio_id, cliente_id, sku, mes, precio_anterior, precio_nuevo)
    values (old.id, old.cliente_id, old.sku, old.mes, old.precio, null);
    return old;
  end if;
  if new.precio is distinct from old.precio then
    insert into precios_cliente_cambios (precio_id, cliente_id, sku, mes, precio_anterior, precio_nuevo)
    values (old.id, old.cliente_id, old.sku, old.mes, old.precio, new.precio);
    new.cargado_en := now();
    new.cargado_por := auth.uid();
  end if;
  return new;
end;
$$;

create trigger precios_cliente_auditoria
  before update or delete on public.precios_cliente
  for each row execute function public.registrar_cambio_precio();

-- ---------- Precios de la competencia ----------------------------------
create table public.precios_competencia (
  id             bigint generated always as identity primary key,
  cliente_id     bigint references public.clientes(id) on delete cascade,  -- null = dato general de mercado
  sku            bigint not null references public.skus(sku) on update cascade,
  mes            date not null check (mes = date_trunc('month', mes)::date),
  competidor     text not null check (length(trim(competidor)) > 0),
  precio         numeric(12,2) not null check (precio > 0),
  observaciones  text,
  cargado_por    uuid default auth.uid(),
  cargado_en     timestamptz not null default now()
);

-- ---------- Fecha de actualización automática --------------------------
create or replace function public.tocar_actualizado_en()
returns trigger language plpgsql as $$
begin new.actualizado_en := now(); return new; end;
$$;
create trigger skus_actualizado before update on public.skus
  for each row execute function public.tocar_actualizado_en();
create trigger clientes_actualizado before update on public.clientes
  for each row execute function public.tocar_actualizado_en();

-- Alta de cliente: se le tildan todos los SKUs activos.
create or replace function public.preparar_grilla()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into cliente_skus (cliente_id, sku)
  select new.id, s.sku from skus s where s.estado = 'ACTIVO'
  on conflict do nothing;
  return new;
end;
$$;
create trigger clientes_grilla after insert on public.clientes
  for each row execute function public.preparar_grilla();

-- Alta de SKU: se tilda en todos los clientes genéricos.
create or replace function public.agregar_sku_a_genericos()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estado = 'ACTIVO' then
    insert into cliente_skus (cliente_id, sku)
    select c.id, new.sku from clientes c where c.modalidad = 'GENERICO' and c.activo
    on conflict do nothing;
  end if;
  return new;
end;
$$;
create trigger skus_a_genericos after insert on public.skus
  for each row execute function public.agregar_sku_a_genericos();

-- =====================================================================
-- Vistas (respetan los permisos del usuario: security_invoker)
-- =====================================================================

-- Historial con variación mes a mes y acumulada.
create view public.v_historial_cliente with (security_invoker = true) as
select
  p.cliente_id,
  p.sku,
  s.descripcion,
  p.mes,
  p.precio,
  lag(p.precio) over w                                   as precio_anterior,
  round((p.precio / nullif(lag(p.precio) over w, 0) - 1) * 100, 2)          as var_pct,
  round((p.precio / nullif(first_value(p.precio) over w, 0) - 1) * 100, 2)  as var_acum_pct
from public.precios_cliente p
join public.skus s on s.sku = p.sku
window w as (partition by p.cliente_id, p.sku order by p.mes);

-- Último precio cargado de cada cliente y SKU.
create view public.v_ultimo_precio_cliente with (security_invoker = true) as
select distinct on (p.cliente_id, p.sku)
  p.cliente_id, p.sku, p.mes, p.precio
from public.precios_cliente p
order by p.cliente_id, p.sku, p.mes desc;

-- Índice de clientes con cantidad de SKUs tildados y último mes cargado.
create view public.v_indice_clientes with (security_invoker = true) as
select
  c.id, c.nro_cliente, c.nombre, c.modalidad, c.nivel, c.cotiza, c.segmento, c.activo,
  (select count(*) from public.cliente_skus cs
     where cs.cliente_id = c.id and cs.activo)          as skus_activos,
  (select max(p.mes) from public.precios_cliente p
     where p.cliente_id = c.id)                          as ultimo_mes
from public.clientes c;

-- Resumen por SKU y mes: mínimo, máximo y promedio entre clientes.
create view public.v_resumen_sku_mes with (security_invoker = true) as
select
  p.sku, s.descripcion, p.mes,
  count(*)                    as clientes,
  min(p.precio)               as minimo,
  max(p.precio)               as maximo,
  round(avg(p.precio), 2)     as promedio
from public.precios_cliente p
join public.skus s on s.sku = p.sku
group by p.sku, s.descripcion, p.mes;

-- =====================================================================
-- Cálculo de precios
-- =====================================================================

create or replace function public.precio_con_descuento(p_precio numeric, p_descuento numeric, p_admite boolean)
returns numeric
language sql
immutable
as $$
  select case when p_admite then round(p_precio * (1 - p_descuento / 100), 1) else p_precio end;
$$;

-- Lista vigente de cada SKU para cada mes en que hay lista, con los
-- precios de todos los niveles calculados.
create view public.v_lista_niveles with (security_invoker = true) as
select
  l.mes, l.sku, s.descripcion, s.admite_descuento, s.estado,
  l.precio                                                   as lista,
  public.precio_con_descuento(l.precio, 3,  s.admite_descuento) as medio,
  public.precio_con_descuento(l.precio, 6,  s.admite_descuento) as agresivo,
  public.precio_con_descuento(l.precio, 10, s.admite_descuento) as diego,
  public.precio_con_descuento(l.precio, 15, s.admite_descuento) as matar,
  l.precio_minimo
from public.lista_general l
join public.skus s on s.sku = l.sku;

-- Lista vigente a un mes: la última cargada en ese mes o antes.
create or replace function public.lista_vigente(p_mes date)
returns table (sku bigint, mes date, precio numeric, precio_minimo numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct on (l.sku) l.sku, l.mes, l.precio, l.precio_minimo
  from lista_general l
  where l.mes <= p_mes
  order by l.sku, l.mes desc;
$$;

-- Publicar la lista general de un mes: guarda los precios de todos los
-- clientes genéricos que cotizan, en sus SKUs tildados. Si ya estaban
-- publicados y cambió algo, se corrigen (queda registrado el anterior).
create or replace function public.publicar_lista(p_mes date)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare v_filas integer;
begin
  p_mes := date_trunc('month', p_mes)::date;
  if not exists (select 1 from lista_general where mes = p_mes) then
    raise exception 'No hay lista general cargada para ese mes';
  end if;

  insert into precios_cliente (cliente_id, sku, mes, precio, origen)
  select c.id, l.sku, p_mes,
         precio_con_descuento(l.precio, n.descuento_pct, s.admite_descuento),
         'LISTA'
  from clientes c
  join niveles n on n.codigo = c.nivel
  join cliente_skus cs on cs.cliente_id = c.id and cs.activo
  join lista_general l on l.sku = cs.sku and l.mes = p_mes
  join skus s on s.sku = l.sku and s.estado = 'ACTIVO'
  where c.modalidad = 'GENERICO' and c.cotiza and c.activo
  on conflict (cliente_id, sku, mes) do update
    set precio = excluded.precio, origen = 'LISTA'
    where precios_cliente.precio is distinct from excluded.precio;

  get diagnostics v_filas = row_count;
  return v_filas;
end;
$$;

-- =====================================================================
-- Cotizar
--   GENÉRICO -> lista vigente menos su descuento
--   ESPECIAL -> su último precio cargado
--   No cotiza -> error
-- =====================================================================
create function public.cotizar(p_cliente_id bigint)
returns table (sku bigint, descripcion text, precio numeric, mes date, origen text)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare c record;
begin
  select cl.modalidad, cl.cotiza, cl.nivel, n.descuento_pct into c
  from clientes cl left join niveles n on n.codigo = cl.nivel
  where cl.id = p_cliente_id;

  if not found then raise exception 'Cliente % no encontrado', p_cliente_id; end if;
  if not c.cotiza then raise exception 'Este cliente está marcado como NO COTIZA'; end if;

  if c.modalidad = 'ESPECIAL' then
    return query
      select u.sku, s.descripcion, u.precio, u.mes, 'lista propia'::text
      from v_ultimo_precio_cliente u
      join cliente_skus cs on cs.cliente_id = u.cliente_id and cs.sku = u.sku and cs.activo
      join skus s on s.sku = u.sku
      where u.cliente_id = p_cliente_id
      order by s.descripcion, u.sku;
  else
    return query
      select l.sku, s.descripcion,
             precio_con_descuento(l.precio, c.descuento_pct, s.admite_descuento),
             l.mes,
             (case when s.admite_descuento then 'lista ' || c.nivel else 'lista (sin descuento)' end)::text
      from lista_vigente(date_trunc('month', now())::date) l
      join cliente_skus cs on cs.cliente_id = p_cliente_id and cs.sku = l.sku and cs.activo
      join skus s on s.sku = l.sku and s.estado = 'ACTIVO'
      order by s.descripcion, l.sku;
  end if;
end;
$$;
revoke execute on function public.cotizar(bigint), public.publicar_lista(date), public.lista_vigente(date) from anon, public;
grant execute on function public.cotizar(bigint), public.publicar_lista(date), public.lista_vigente(date) to authenticated;

-- Detalle de precios por cliente y mes, solo SKUs tildados, con la lista
-- vigente en ese mes para comparar.
create view public.v_precios_detalle with (security_invoker = true) as
select
  p.mes, p.sku, s.descripcion, s.familia,
  c.id as cliente_id, c.nombre as cliente, c.nro_cliente, c.modalidad, c.nivel, c.segmento,
  p.precio, p.origen,
  lv.precio as lista,
  public.precio_con_descuento(lv.precio, 15, s.admite_descuento) as matar,
  lv.precio_minimo
from public.precios_cliente p
join public.clientes c on c.id = p.cliente_id
join public.skus s on s.sku = p.sku
join public.cliente_skus cs on cs.cliente_id = p.cliente_id and cs.sku = p.sku and cs.activo
left join lateral (
  select l.precio, l.precio_minimo from public.lista_general l
  where l.sku = p.sku and l.mes <= p.mes
  order by l.mes desc limit 1
) lv on true;

-- =====================================================================
-- Seguridad: Row Level Security en todas las tablas
-- =====================================================================
alter table public.usuarios_autorizados     enable row level security;
alter table public.niveles                  enable row level security;
alter table public.skus                     enable row level security;
alter table public.clientes                 enable row level security;
alter table public.cliente_skus             enable row level security;
alter table public.lista_general            enable row level security;
alter table public.precios_cliente          enable row level security;
alter table public.precios_cliente_cambios  enable row level security;
alter table public.precios_competencia      enable row level security;

-- Cada usuario autorizado puede ver la lista de autorizados; nadie la edita
-- desde la app (se administra desde el panel de Supabase).
create policy autorizados_leen on public.usuarios_autorizados
  for select to authenticated using (public.es_autorizado());

create policy niveles_leer on public.niveles
  for select to authenticated using (public.es_autorizado());

-- Tablas de trabajo: usuarios autorizados leen, agregan y editan.
do $$
declare t text;
begin
  foreach t in array array['skus','clientes','cliente_skus','lista_general','precios_cliente','precios_competencia'] loop
    execute format('create policy %1$s_leer on public.%1$s for select to authenticated using (public.es_autorizado())', t);
    execute format('create policy %1$s_agregar on public.%1$s for insert to authenticated with check (public.es_autorizado())', t);
    execute format('create policy %1$s_editar on public.%1$s for update to authenticated using (public.es_autorizado()) with check (public.es_autorizado())', t);
  end loop;
end $$;

-- Borrar: solo grillas, competencia y precios del historial (queda auditado).
create policy cliente_skus_borrar on public.cliente_skus
  for delete to authenticated using (public.es_autorizado());
create policy lista_general_borrar on public.lista_general
  for delete to authenticated using (public.es_autorizado());
create policy precios_competencia_borrar on public.precios_competencia
  for delete to authenticated using (public.es_autorizado());
create policy precios_cliente_borrar on public.precios_cliente
  for delete to authenticated using (public.es_autorizado());

-- El registro de cambios es de solo lectura.
create policy cambios_leer on public.precios_cliente_cambios
  for select to authenticated using (public.es_autorizado());

-- Los visitantes sin login (anon) no tienen ningún acceso.
revoke all on all tables in schema public from anon;
revoke execute on function public.cotizar(bigint) from anon, public;
grant execute on function public.cotizar(bigint) to authenticated;
