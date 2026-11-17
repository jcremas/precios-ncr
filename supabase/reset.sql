-- =====================================================================
-- RESET: BORRA TODAS LAS TABLAS Y DATOS DE LA APP DE PRECIOS.
-- No se puede deshacer. Usalo solo para empezar de cero.
-- No toca los usuarios de login (Authentication > Users).
-- Después de esto, correr supabase/migrations/0001_esquema.sql.
-- =====================================================================

-- Vistas
drop view if exists public.v_precios_detalle cascade;
drop view if exists public.v_lista_niveles cascade;
drop view if exists public.v_resumen_sku_mes cascade;
drop view if exists public.v_indice_clientes cascade;
drop view if exists public.v_ultimo_precio_cliente cascade;
drop view if exists public.v_historial_cliente cascade;
drop view if exists public.v_historial_precios cascade;
drop view if exists public.v_ultimo_precio cascade;

-- Tablas (incluye nombres de versiones anteriores)
drop table if exists public.precios_competencia cascade;
drop table if exists public.precios_cliente_cambios cascade;
drop table if exists public.precios_cliente cascade;
drop table if exists public.lista_general cascade;
drop table if exists public.lista_precios cascade;
drop table if exists public.cliente_skus cascade;
drop table if exists public.clientes cascade;
drop table if exists public.skus cascade;
drop table if exists public.niveles cascade;
drop table if exists public.usuarios_autorizados cascade;

-- Funciones
drop function if exists public.cotizar(bigint) cascade;
drop function if exists public.cotizar_cliente(bigint) cascade;
drop function if exists public.aplicar_aumento(bigint, date, numeric) cascade;
drop function if exists public.publicar_lista(date) cascade;
drop function if exists public.lista_vigente(date) cascade;
drop function if exists public.precio_con_descuento(numeric, numeric, boolean) cascade;
drop function if exists public.registrar_cambio_precio() cascade;
drop function if exists public.tocar_actualizado_en() cascade;
drop function if exists public.preparar_grilla_especial() cascade;
drop function if exists public.preparar_grilla() cascade;
drop function if exists public.agregar_sku_a_genericos() cascade;
drop function if exists public.es_autorizado() cascade;

-- Verificación: tiene que devolver 0 filas.
select table_name from information_schema.tables where table_schema = 'public';
