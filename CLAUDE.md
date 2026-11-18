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
- Un precio por (cliente, SKU, mes), para TODOS los clientes. Las correcciones quedan auditadas en `precios_cliente_cambios`.
- Modalidad: GENERICO = lista_general − descuento del nivel, recalculado con `publicar_lista(mes)`; ESPECIAL = lista propia (no descuento), se maneja con % y a mano. `cotiza` false = bloqueado (reemplaza NO COTIZA).
- Lista general: un precio LISTA por SKU/mes + `precio_minimo` (piso). Nivel = round(LISTA × (1 − desc), 1) salvo `skus.admite_descuento = false` (8 SKUs: ELITE, LUCAS, 2 Bitter, 4 Cerveza). Misma fórmula en SQL (`precio_con_descuento`) y en `src/lib/precios.ts`.
- Esquema en `supabase/migrations/0001_esquema.sql` + `0002_precios_genericos_al_instante.sql` + `0003_datos_sku.sql` + `0004_niveles_editables.sql` + `0005_cotizar_ultimo_mes.sql` (se corren en orden; 0002 a 0005 son repetibles); `supabase/reset.sql` borra todo para empezar de cero.
- Genérico: al crearlo, cambiarle nivel/modalidad/cotiza o tildarle un SKU, los disparadores guardan sus precios del mes actual (hora Argentina) con `lista_vigente` (función `recalcular_cliente`). Meses anteriores no se tocan.
- Niveles de descuento editables (pantalla Niveles; el front los lee con `useNiveles()`, no hay niveles fijos en el código). Desde 0004: `niveles(id, nombre, descuento_pct, orden)` y `clientes.nivel_id` → `niveles.id` (pedido por Javier: renombrar libremente). Las vistas exponen `nivel` = nombre y `nivel_id`. Cambiar % recalcula el mes actual de sus genéricos (disparador `niveles_precios`); no se borra un nivel con clientes. No volver a correr 0002 después de 0004.
- Cotizar muestra SOLO el mes más nuevo (último mes del especial; última lista general para genéricos), sin mezclar meses: SKU sin precio ese mes = no se cotiza (pedido de Javier, 2026-11-18, migración 0005).
- Meses guardados como fecha día 1 (`2026-05-01` = MAY 2026).
- Nombres de cliente completos (decidido por Javier, 2026-11-17). El código de cliente (`nro_cliente`) es la clave de negocio; el Excel no lo trae y se completa en la app.

## Datos de origen (PRECIOS_POR_CLIENTE.xlsm, 2026-11-17)
- 51 clientes ESPECIAL con hoja propia (28 SKUs, único mes MAY 2026, 479 precios), INDICE con nombres completos, LISTA_REFERENCIA (MAYO 2026, precio por nivel).
- No hay base de clientes completa ni maestro de SKUs ni historial anterior: se completan luego en la app.
- ENVIO_MENSUAL dice JUN 2026 pero es copia de MAY 2026: no importar. No inventar JUN 2026.
- En la lista, los SKUs con el mismo precio en todos los niveles se importan con `admite_descuento = false`.
- La columna "Minimo" de LISTA_REFERENCIA tiene valores negativos: NO es el precio piso y no se importa. El piso se carga en Lista general.

## Funciones
Hechas: ajuste mensual de especiales (menú "Ajuste mensual", antes "Envío mensual"; ruta /ajuste) (con lista y mínimo de referencia), lista general (cargar, % sobre anterior, pegar desde Excel, publicar a genéricos), historial y mapa SKU × cliente en la ficha, primera lista de un especial nuevo, cotizador (RPC `cotizar`, todos los clientes, con unidades por pallet, copia compacta para correo), SKUs con peso/unidades por pallet/color, ABM de clientes y SKUs, consultas primera tanda (por SKU, ranking, brecha contra lista, ficha, ajustes del mes, desactualizados, cobertura) con exportar a CSV para Excel.
Pendientes: importar los 283 clientes genéricos (falta el listado), consultas segunda tanda (evolución de un SKU, aumento acumulado con inflación, dispersión, por familia, por segmento/nivel, cambios manuales, alertas, simulador), precios de competencia, envío de listas por email, deploy en Vercel.
Plan aprobado: https://claude.ai/artifact/FTZZLVhNNpURLDSUc1nLSm

## Estilo de trabajo
Explicar paso a paso en español simple. Verificar antes de entregar. Preguntar antes de decisiones irreversibles.

## Comandos
`npm run dev` · `npm run build` · `npm run lint` · `python3 migracion/importar_excel.py ARCHIVO.xlsm`
