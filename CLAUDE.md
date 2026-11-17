# Proyecto: Sistema de precios por cliente (Nueva Cristalería Rosario)

## Quién y para qué
- Usuario: Javier, ejecutivo comercial B2B en Nueva Cristalería Rosario S.A. (envases de vidrio para vinos y alimentos), Mendoza, Argentina. Usuario de negocio, no desarrollador.
- Idioma: español (Argentina). Interfaz, textos, nombres de tablas y mensajes en español.
- Objetivo: reemplazar una planilla Excel con macros por esta app, con un historial confiable de precios por cliente, SKU y mes. Se abandona el Excel.

## Stack
Supabase (Postgres, São Paulo) · React + TypeScript + Vite + Tailwind v4 + shadcn/ui (componentes en `src/components/ui`) · Vercel · repo privado `precios-ncr`.

## Reglas obligatorias
- Login + RLS en todas las tablas. Acceso solo para usuarios autenticados cuyo email esté en `usuarios_autorizados` (función `es_autorizado()`).
- Nunca subir el Excel ni datos con precios reales (`*.xls*`, `*.csv`, `migracion/salida/` están en `.gitignore`).
- Claves solo en `.env`. Nunca usar la `service_role` key en el frontend.
- El SKU es siempre un entero y es la clave permanente.
- Un precio por (cliente, SKU, mes). Las correcciones quedan auditadas en `precios_cliente_cambios`.
- Meses guardados como fecha día 1 (`2026-05-01` = MAY 2026).
- Nombres de cliente completos (decidido por Javier, 2026-11-17). El código de cliente (`nro_cliente`) es la clave de negocio; el Excel no lo trae y se completa en la app.

## Datos de origen (PRECIOS_POR_CLIENTE.xlsm, 2026-11-17)
- 51 clientes ESPECIAL con hoja propia (28 SKUs, único mes MAY 2026, 479 precios), INDICE con nombres completos, LISTA_REFERENCIA (MAYO 2026, precio por nivel).
- No hay base de clientes completa ni maestro de SKUs ni historial anterior: se completan luego en la app.
- ENVIO_MENSUAL dice JUN 2026 pero es copia de MAY 2026: no importar. No inventar JUN 2026.
- En la lista, algunos SKUs tienen el mismo precio en todos los niveles: guardar precio por nivel, no calcularlo con el %.
- Pendiente: significado de la columna "Minimo" de LISTA_REFERENCIA.

## Funciones
Hechas: envío mensual (cliente o TODOS, % de aumento, edición, guardar), historial por cliente con variación y alertas (>30% / bajas), cotizador (RPC `cotizar`), ABM de clientes (alta ESPECIAL arma grilla vacía vía trigger) y SKUs, índice de clientes.
Pendientes: carga y visualización de lista de precios por nivel, precios de competencia y análisis de competitividad, dashboard (mín/máx/promedio; vista `v_resumen_sku_mes` ya existe), envío de listas por email.

## Estilo de trabajo
Explicar paso a paso en español simple. Verificar antes de entregar. Preguntar antes de decisiones irreversibles.

## Comandos
`npm run dev` · `npm run build` · `npm run lint` · `python3 migracion/importar_excel.py ARCHIVO.xlsm`
