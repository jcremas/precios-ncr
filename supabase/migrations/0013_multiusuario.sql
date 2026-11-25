-- =====================================================================
-- 0013 · Multiusuario (pedido de Javier, 2026-11-25).
--
-- Reglas:
--   * Todos los usuarios autorizados VEN todo (clientes, precios, listas).
--   * Cada cliente tiene un DUEÑO (clientes.dueno = email del usuario).
--     Solo el dueño modifica ese cliente: sus datos, su mapa de SKUs, sus
--     precios y sus precios de competencia.
--   * Lo compartido (lista general y su publicación, SKUs, niveles) lo
--     modifica solo el ADMINISTRADOR (usuarios_autorizados.es_admin).
--   * Cliente nuevo: queda a nombre de quien lo crea.
--   * Pasar un cliente a otro usuario: solo el administrador, con
--     transferir_cliente(cliente, email) (botón "Cambiar dueño" en la ficha).
--   * Publicar la lista general y cambiar el % de un nivel siguen
--     recalculando TODOS los genéricos, sean de quien sean.
--
-- Una sola vez (la primera vez que se corre):
--   El usuario autorizado MÁS ANTIGUO (el primero que se cargó, Javier)
--   queda como administrador y dueño de todos los clientes existentes.
--
-- Se puede volver a correr: no cambia dueños ni administradores ya puestos.
-- Al final muestra los usuarios, si son admin y cuántos clientes tiene cada uno.
-- =====================================================================

-- ---------- 1. Administrador -----------------------------------------
alter table public.usuarios_autorizados
  add column if not exists es_admin boolean not null default false;

update public.usuarios_autorizados set es_admin = true
where email = (select email from public.usuarios_autorizados order by creado_en, email limit 1)
  and not exists (select 1 from public.usuarios_autorizados where es_admin);

-- ---------- 2. Funciones de ayuda ------------------------------------
create or replace function public.mi_email()
returns text
language sql
stable
set search_path = public
as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

create or replace function public.es_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.usuarios_autorizados
    where email = public.mi_email() and es_admin
  );
$$;

-- ---------- 3. Dueño de cada cliente ---------------------------------
alter table public.clientes add column if not exists dueno text;

-- Los clientes que ya existen quedan a nombre del administrador.
update public.clientes set dueno = (
  select email from public.usuarios_autorizados where es_admin order by creado_en, email limit 1
) where dueno is null;

alter table public.clientes alter column dueno set default public.mi_email();
alter table public.clientes alter column dueno set not null;
alter table public.clientes drop constraint if exists clientes_dueno_fk;
alter table public.clientes add constraint clientes_dueno_fk
  foreign key (dueno) references public.usuarios_autorizados(email) on update cascade;
create index if not exists clientes_dueno on public.clientes (dueno);
comment on column public.clientes.dueno is 'Email del usuario dueño: solo él modifica este cliente y sus precios';

-- ¿Soy el dueño de este cliente? (security definer: no depende de los permisos de la tabla)
create or replace function public.es_dueno(p_cliente_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.es_autorizado() and exists (
    select 1 from public.clientes c
    where c.id = p_cliente_id and c.dueno = public.mi_email()
  );
$$;

-- ---------- 4. Permisos (RLS) ----------------------------------------
-- Se borran todos los permisos de escritura viejos y se crean los nuevos.
do $$
declare t text; p text;
begin
  foreach t in array array['skus','clientes','cliente_skus','lista_general','precios_cliente',
                           'precios_competencia','niveles','listas_publicadas'] loop
    foreach p in array array['leer','agregar','editar','borrar'] loop
      execute format('drop policy if exists %1$s_%2$s on public.%1$s', t, p);
    end loop;
    execute format('create policy %1$s_leer on public.%1$s for select to authenticated using (public.es_autorizado())', t);
  end loop;
end $$;

-- Compartido: solo el administrador.
do $$
declare t text;
begin
  foreach t in array array['skus','lista_general','niveles','listas_publicadas'] loop
    execute format('create policy %1$s_agregar on public.%1$s for insert to authenticated with check (public.es_admin())', t);
    execute format('create policy %1$s_editar on public.%1$s for update to authenticated using (public.es_admin()) with check (public.es_admin())', t);
  end loop;
end $$;
create policy lista_general_borrar on public.lista_general
  for delete to authenticated using (public.es_admin());
create policy niveles_borrar on public.niveles
  for delete to authenticated using (public.es_admin());

-- Clientes: crea cualquiera (queda a su nombre); edita solo el dueño, sin poder regalarlo.
create policy clientes_agregar on public.clientes
  for insert to authenticated with check (public.es_autorizado() and dueno = public.mi_email());
create policy clientes_editar on public.clientes
  for update to authenticated
  using (public.es_autorizado() and dueno = public.mi_email())
  with check (dueno = public.mi_email());

-- Mapa de SKUs y precios: solo el dueño del cliente.
do $$
declare t text;
begin
  foreach t in array array['cliente_skus','precios_cliente'] loop
    execute format('create policy %1$s_agregar on public.%1$s for insert to authenticated with check (public.es_dueno(cliente_id))', t);
    execute format('create policy %1$s_editar on public.%1$s for update to authenticated using (public.es_dueno(cliente_id)) with check (public.es_dueno(cliente_id))', t);
    execute format('create policy %1$s_borrar on public.%1$s for delete to authenticated using (public.es_dueno(cliente_id))', t);
  end loop;
end $$;

-- Competencia: la de un cliente, su dueño; la general de mercado (sin cliente), el administrador.
create policy precios_competencia_agregar on public.precios_competencia
  for insert to authenticated
  with check (case when cliente_id is null then public.es_admin() else public.es_dueno(cliente_id) end);
create policy precios_competencia_editar on public.precios_competencia
  for update to authenticated
  using (case when cliente_id is null then public.es_admin() else public.es_dueno(cliente_id) end)
  with check (case when cliente_id is null then public.es_admin() else public.es_dueno(cliente_id) end);
create policy precios_competencia_borrar on public.precios_competencia
  for delete to authenticated
  using (case when cliente_id is null then public.es_admin() else public.es_dueno(cliente_id) end);

-- ---------- 5. Lo que recalcula genéricos de todos -------------------
-- Publicar la lista: solo el administrador; recalcula los genéricos de
-- todos los dueños (por eso corre con permisos de la base).
create or replace function public.publicar_lista(p_mes date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_filas integer;
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador publica la lista general';
  end if;
  p_mes := date_trunc('month', p_mes)::date;
  if not exists (select 1 from lista_general where mes = p_mes) then
    raise exception 'No hay lista general cargada para ese mes';
  end if;

  insert into precios_cliente (cliente_id, sku, mes, precio, origen)
  select c.id, l.sku, p_mes,
         precio_con_descuento(l.precio, n.descuento_pct, s.admite_descuento),
         'LISTA'
  from clientes c
  join niveles n on n.id = c.nivel_id
  join cliente_skus cs on cs.cliente_id = c.id and cs.activo
  join lista_general l on l.sku = cs.sku and l.mes = p_mes
  join skus s on s.sku = l.sku and s.estado = 'ACTIVO'
  where c.modalidad = 'GENERICO' and c.cotiza and c.activo
  on conflict (cliente_id, sku, mes) do update
    set precio = excluded.precio, origen = 'LISTA'
    where precios_cliente.precio is distinct from excluded.precio;
  get diagnostics v_filas = row_count;

  insert into listas_publicadas (mes) values (p_mes)
  on conflict (mes) do update set publicada_en = now(), publicada_por = auth.uid();

  return v_filas;
end;
$$;
revoke execute on function public.publicar_lista(date) from anon, public;
grant execute on function public.publicar_lista(date) to authenticated;

-- Cambiar el % de un nivel (solo admin, por permisos de niveles):
-- recalcula los genéricos de ese nivel, sean de quien sean.
create or replace function public.recalcular_nivel_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.descuento_pct is distinct from old.descuento_pct then
    perform recalcular_cliente(c.id)
    from clientes c
    where c.nivel_id = new.id and c.modalidad = 'GENERICO' and c.cotiza and c.activo;
  end if;
  return null;
end;
$$;

-- ---------- 6. Pasar un cliente a otro usuario (solo administrador) ---
create or replace function public.transferir_cliente(p_cliente_id bigint, p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador cambia el dueño de un cliente';
  end if;
  if not exists (select 1 from usuarios_autorizados where email = lower(trim(p_email))) then
    raise exception 'Ese email no es un usuario autorizado';
  end if;
  update clientes set dueno = lower(trim(p_email)) where id = p_cliente_id;
  if not found then
    raise exception 'No existe ese cliente';
  end if;
end;
$$;
revoke execute on function public.transferir_cliente(bigint, text) from anon, public;
grant execute on function public.transferir_cliente(bigint, text) to authenticated;
revoke execute on function public.es_dueno(bigint), public.es_admin(), public.mi_email() from anon, public;
grant execute on function public.es_dueno(bigint), public.es_admin(), public.mi_email() to authenticated;

-- ---------- 7. Índice de clientes con su dueño ------------------------
create or replace view public.v_indice_clientes with (security_invoker = true) as
select
  c.id, c.nro_cliente, c.nombre, c.modalidad, n.nombre as nivel, c.cotiza, c.segmento, c.activo,
  (select count(*) from public.cliente_skus cs
     where cs.cliente_id = c.id and cs.activo)          as skus_activos,
  (select max(p.mes) from public.precios_cliente p
     where p.cliente_id = c.id)                          as ultimo_mes,
  c.nivel_id,
  c.dueno
from public.clientes c
left join public.niveles n on n.id = c.nivel_id;

-- ---------- Resultado ------------------------------------------------
select u.email, u.nombre, u.es_admin, count(c.id) as clientes
from public.usuarios_autorizados u
left join public.clientes c on c.dueno = u.email
group by u.email, u.nombre, u.es_admin, u.creado_en
order by u.creado_en;
