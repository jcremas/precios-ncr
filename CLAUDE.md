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
- Esquema en `supabase/migrations/0001_esquema.sql` + `0002_precios_genericos_al_instante.sql` + `0003_datos_sku.sql` + `0004_niveles_editables.sql` + `0005_cotizar_ultimo_mes.sql` + `0006_listas_publicadas_y_cambios.sql` + `0007_cotizar_por_mes.sql` + `0008_datos_contacto_cliente.sql` + `0009_sinonimos_sku.sql` + `0010_genericos_solo_vino.sql` + `0011_meses_cotizables_todos.sql` + `0012_condicion_pago_50.sql` (se corren en orden; 0002 en adelante son repetibles); `supabase/reset.sql` borra todo para empezar de cero.
- Genérico: al crearlo, cambiarle nivel/modalidad/cotiza o tildarle un SKU, los disparadores guardan sus precios del mes actual (hora Argentina) con `lista_vigente` (función `recalcular_cliente`). Meses anteriores no se tocan.
- Genéricos solo con vino (0010, pedido de Javier 2026-11-20): `skus.para_genericos` (columna "Genéricos" en SKUs). Genérico nuevo y SKU nuevo se tildan solo si `para_genericos`; especiales igual que antes (todos los activos). Destildar no borra precios (historial).
- Niveles de descuento editables (pantalla Niveles; el front los lee con `useNiveles()`, no hay niveles fijos en el código). Desde 0004: `niveles(id, nombre, descuento_pct, orden)` y `clientes.nivel_id` → `niveles.id` (pedido por Javier: renombrar libremente). Las vistas exponen `nivel` = nombre y `nivel_id`. Cambiar % recalcula el mes actual de sus genéricos (disparador `niveles_precios`); no se borra un nivel con clientes. No volver a correr 0002 después de 0004.
- Lista general: guardar = BORRADOR; `publicar_lista(mes)` la marca en `listas_publicadas`. Solo las publicadas llegan a genéricos (`recalcular_cliente` usa `lista_vigente_publicada`). Correcciones/borrados de la lista quedan en `lista_general_cambios` (0006).
- Lecturas por partes (`traerTodo`): siempre con orden por columnas únicas; usar `preciosDeClientes`, `listasGenerales`, `grillasActivas` de `src/lib/datos.ts`.
- Cotizar: selector de mes (por defecto el más nuevo), SOLO precios de ese mes, sin mezclar meses; SKU sin precio o en cero ese mes = no se cotiza. RPC `cotizar(cliente, mes)` + `meses_cotizables(cliente)` (0007). Genérico: precios guardados del mes o, si no hay, lista general PUBLICADA de ese mes (`listas_publicadas`, 0006).
- Cliente (0008): contacto = nombre de contacto, email = email de contacto, condicion_pago ≤ 50 caracteres (0012; no volver a correr 0008 después), empaque_consignado (sí/no), marca_principal. Se usan en el correo de la lista (Enviar listas).
- Meses guardados como fecha día 1 (`2026-05-01` = MAY 2026).
- Nombres de cliente completos (decidido por Javier, 2026-11-17). El código de cliente (`nro_cliente`) es la clave de negocio; el Excel no lo trae y se completa en la app.

## Datos de origen (PRECIOS_POR_CLIENTE.xlsm, 2026-11-17)
- 51 clientes ESPECIAL con hoja propia (28 SKUs, único mes MAY 2026, 479 precios), INDICE con nombres completos, LISTA_REFERENCIA (MAYO 2026, precio por nivel).
- No hay base de clientes completa ni maestro de SKUs ni historial anterior: se completan luego en la app.
- ENVIO_MENSUAL dice JUN 2026 pero es copia de MAY 2026: no importar. No inventar JUN 2026.
- En la lista, los SKUs con el mismo precio en todos los niveles se importan con `admite_descuento = false`.
- La columna "Minimo" de LISTA_REFERENCIA tiene valores negativos: NO es el precio piso y no se importa. El piso se carga en Lista general.

## Funciones
Hechas: ajuste mensual de especiales (menú "Ajuste mensual", antes "Envío mensual"; ruta /ajuste) (con lista y mínimo de referencia), lista general (cargar, % sobre anterior, pegar desde Excel, publicar a genéricos), historial y mapa SKU × cliente en la ficha, primera lista de un especial nuevo, cotizador (RPC `cotizar`, todos los clientes, con unidades por pallet, copia compacta para correo), SKUs con peso/unidades por pallet/color, ABM de clientes y SKUs, consultas primera tanda (por SKU, ranking, brecha contra lista, ficha, ajustes del mes, desactualizados, cobertura) con exportar a CSV para Excel; todas con filtro Clientes Todos/Especiales/Genéricos (arranca en Todos; al cambiarlo salta al último mes con precios de ese grupo).
Pegar pedido (Cotizar): Edge Function `supabase/functions/leer-pedido` llama a Google Gemini (plan gratis, elegido por Javier 2026-11-18) con la clave en el secreto `GEMINI_API_KEY` (nunca en el front); a la IA solo va el texto del pedido + catálogo de SKUs (sin precios ni clientes); el precio sale de `cotizar`. Primero lee por reglas en la app (`src/lib/leerPedido.ts`, instantáneo); solo las líneas sin reconocer van a la IA (flash-lite primero) — decidido por Javier 2026-11-18. Sinónimos en `skus.sinonimos` (0009). Botón Dictar (Web Speech API del navegador, es-AR; cada pausa = una línea; entiende "tres pallets"). Activación: `supabase/functions/leer-pedido/LEEME.md`.
Enviar listas por Outlook (pedido de Javier 2026-11-24, opción sin Sistemas): la app NO envía; arma archivos .eml (`src/lib/correo.ts`, cabecera `X-Unsent: 1`, HTML con la misma tabla de `tablaHtml`) que Outlook de escritorio abre como mensaje nuevo para apretar Enviar. Uno: botón "Correo para Outlook" en Cotizar. Varios: pantalla "Enviar listas" (/enviar), tildar clientes → .zip con un .eml por cliente (mes elegido = solo clientes con lista ese mes; o la última lista de cada uno, mostrada en la tabla; meses de `meses_cotizables_todos()` (0011), si falta cae a `meses_cotizables` por cliente). Texto del correo editable, guardado en el navegador (clave v2). Textos de Javier (2026-11-24): asunto "Propuesta de Precios {mes} - {cliente} - ...", cierre distinto según `clientes.empaque_consignado` (consignado: embalaje propiedad de NCR, retiros con Mauricio Bedin; no consignado: se suma el precio del empaque), `{condicion_pago}` (vacío = "a convenir"). CC fijo editable en la plantilla (por defecto hector.rossi@, guillermo.rosales@, comercial@ncrosario.com). `clientes.email` admite varios separados con ";" (`normalizarEmails` al guardar). Outlook web se probó y se sacó a pedido de Javier (usa Outlook de escritorio).
Pendientes: importar los 283 clientes genéricos (falta el listado), consultas segunda tanda (evolución de un SKU, aumento acumulado con inflación, dispersión, por familia, por segmento/nivel, cambios manuales, alertas, simulador), precios de competencia, deploy en Vercel.
Plan aprobado: https://claude.ai/artifact/FTZZLVhNNpURLDSUc1nLSm

## Estilo de trabajo
Explicar paso a paso en español simple. Verificar antes de entregar. Preguntar antes de decisiones irreversibles.

## Comandos
`npm run dev` · `npm run build` · `npm run lint` · `python3 migracion/importar_excel.py ARCHIVO.xlsm`
