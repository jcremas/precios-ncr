-- =====================================================================
-- Sistema de precios por cliente - Nueva Cristalería Rosario
-- Esquema inicial. Se corre UNA vez en Supabase (SQL Editor).
-- Reglas:
--   * El SKU es siempre un número entero y es la clave permanente.
--   * Los meses se guardan como fecha del día 1 (ej. 2026-05-01 = MAY 2026).
--   * Un precio por (cliente, SKU, mes). Si se corrige, el valor anterior
--     queda registrado en precios_cliente_cambios (nunca se pierde).
--   * Solo usuarios autenticados Y autorizados ven o tocan datos (RLS).
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
  descuento_pct  numeric(5,2) check (descuento_pct between 0 and 100),
  tipo           text not null check (tipo in ('estandar', 'especial', 'no_cotiza')),
  orden          smallint not null,
  check ((tipo = 'estandar') = (descuento_pct is not null))
);

insert into public.niveles (codigo, descuento_pct, tipo, orden) values
  ('LISTA',     0,    'estandar',  1),
  ('MEDIO',     3,    'estandar',  2),
  ('AGRESIVO',  6,    'estandar',  3),
  ('DIEGO',     10,   'estandar',  4),
  ('MATAR',     15,   'estandar',  5),
  ('ESPECIAL',  null, 'especial',  6),
  ('NO COTIZA', null, 'no_cotiza', 7);

-- ---------- SKUs -------------------------------------------------------
create table public.skus (
  sku             bigint primary key check (sku > 0),
  descripcion     text not null check (length(trim(descripcion)) > 0),
  familia         text,
  estado          text not null default 'ACTIVO'
                  check (estado in ('ACTIVO', 'INACTIVO', 'DESCONTINUADO')),
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
  nivel              text not null default 'LISTA' references public.niveles(codigo),
  observaciones      text,
  activo             boolean not null default true,
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now()
);
create unique index clientes_nombre_unico on public.clientes (upper(trim(nombre)));

-- SKUs que compra cada cliente (su "grilla").
create table public.cliente_skus (
  cliente_id  bigint not null references public.clientes(id) on delete cascade,
  sku         bigint not null references public.skus(sku) on update cascade,
  activo      boolean not null default true,
  creado_en   timestamptz not null default now(),
  primary key (cliente_id, sku)
);

-- ---------- Lista de precios por nivel (por mes de vigencia) -----------
-- Se guarda el precio de cada nivel tal cual, porque hay SKUs en los que
-- no se aplica el descuento del nivel (ej. ELITE, LUCAS, Bitter, Cerveza).
create table public.lista_precios (
  mes          date not null check (mes = date_trunc('month', mes)::date),
  sku          bigint not null references public.skus(sku) on update cascade,
  nivel        text not null references public.niveles(codigo),
  precio       numeric(12,2) not null check (precio > 0),
  cargado_por  uuid default auth.uid(),
  cargado_en   timestamptz not null default now(),
  primary key (mes, sku, nivel)
);

-- ---------- Precios por cliente (historial) ----------------------------
create table public.precios_cliente (
  id           bigint generated always as identity primary key,
  cliente_id   bigint not null references public.clientes(id) on delete restrict,
  sku          bigint not null references public.skus(sku) on update cascade,
  mes          date not null check (mes = date_trunc('month', mes)::date),
  precio       numeric(12,2) not null check (precio > 0),
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

-- Al pasar un cliente a ESPECIAL (alta o cambio de nivel) se le arma la
-- grilla con todos los SKUs activos, sin precios (historial vacío).
create or replace function public.preparar_grilla_especial()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.nivel = 'ESPECIAL' and (tg_op = 'INSERT' or old.nivel is distinct from 'ESPECIAL') then
    insert into cliente_skus (cliente_id, sku)
    select new.id, s.sku from skus s where s.estado = 'ACTIVO'
    on conflict do nothing;
  end if;
  return new;
end;
$$;
create trigger clientes_grilla_especial after insert or update of nivel on public.clientes
  for each row execute function public.preparar_grilla_especial();

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

-- Índice de clientes con cantidad de SKUs activos y último mes cargado.
create view public.v_indice_clientes with (security_invoker = true) as
select
  c.id, c.nro_cliente, c.nombre, c.nivel, c.segmento, c.activo,
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
-- Cotizar a un cliente
--   estándar  -> lista vigente de su nivel
--   ESPECIAL  -> último precio cargado de cada SKU de su grilla
--   NO COTIZA -> error
-- =====================================================================
create or replace function public.cotizar(p_cliente_id bigint)
returns table (sku bigint, descripcion text, precio numeric, mes date, origen text)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_nivel text;
  v_tipo  text;
begin
  select c.nivel, n.tipo into v_nivel, v_tipo
  from clientes c join niveles n on n.codigo = c.nivel
  where c.id = p_cliente_id;

  if v_nivel is null then
    raise exception 'Cliente % no encontrado', p_cliente_id;
  end if;
  if v_tipo = 'no_cotiza' then
    raise exception 'Este cliente está marcado como NO COTIZA';
  end if;

  if v_tipo = 'especial' then
    return query
      select u.sku, s.descripcion, u.precio, u.mes, 'ultimo precio especial'::text
      from v_ultimo_precio_cliente u
      join cliente_skus cs on cs.cliente_id = u.cliente_id and cs.sku = u.sku and cs.activo
      join skus s on s.sku = u.sku
      where u.cliente_id = p_cliente_id
      order by s.descripcion, u.sku;
  else
    return query
      select distinct on (l.sku) l.sku, s.descripcion, l.precio, l.mes, ('lista ' || v_nivel)::text
      from lista_precios l
      join skus s on s.sku = l.sku
      where l.nivel = v_nivel and s.estado = 'ACTIVO'
      order by l.sku, l.mes desc;
  end if;
end;
$$;

-- =====================================================================
-- Seguridad: Row Level Security en todas las tablas
-- =====================================================================
alter table public.usuarios_autorizados     enable row level security;
alter table public.niveles                  enable row level security;
alter table public.skus                     enable row level security;
alter table public.clientes                 enable row level security;
alter table public.cliente_skus             enable row level security;
alter table public.lista_precios            enable row level security;
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
  foreach t in array array['skus','clientes','cliente_skus','lista_precios','precios_cliente','precios_competencia'] loop
    execute format('create policy %1$s_leer on public.%1$s for select to authenticated using (public.es_autorizado())', t);
    execute format('create policy %1$s_agregar on public.%1$s for insert to authenticated with check (public.es_autorizado())', t);
    execute format('create policy %1$s_editar on public.%1$s for update to authenticated using (public.es_autorizado()) with check (public.es_autorizado())', t);
  end loop;
end $$;

-- Borrar: solo grillas, competencia y precios del historial (queda auditado).
create policy cliente_skus_borrar on public.cliente_skus
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
