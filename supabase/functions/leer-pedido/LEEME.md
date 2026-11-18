# Pegar pedido con IA: cómo activarlo (una sola vez)

Se hace todo desde el navegador. Son unos 10 minutos.

## 1. Correr la migración 0009
Supabase → **SQL Editor** → New query → pegar `supabase/migrations/0009_sinonimos_sku.sql` → **Run**.
Agrega la columna "Otros nombres" a los SKUs. No borra nada.

## 2. Crear la clave gratis de Gemini
1. Entrar a https://aistudio.google.com con una cuenta de Google.
2. Botón **Get API key** (o "Obtener clave de API") → **Create API key**.
3. Copiar la clave (empieza con `AIza…`). No la mandes por correo ni la pegues en el código.

Plan gratis: tiene un límite de pedidos por minuto y por día (de sobra para uso normal). Google puede usar lo que se le manda para mejorar sus modelos; por eso la app solo le manda el texto del pedido y la lista de SKUs, sin precios ni datos de clientes.

## 3. Guardar la clave en Supabase
Supabase → **Edge Functions** → **Secrets** → Add new secret:
- Name: `GEMINI_API_KEY`
- Value: la clave del paso 2 → **Save**.

(Opcional) `GEMINI_MODEL` para elegir otro modelo. Si no se carga, usa `gemini-flash-latest`.

## 4. Crear la función
Supabase → **Edge Functions** → **Deploy a new function** → **Via Editor**:
1. Nombre: `leer-pedido` (exacto, en minúsculas y con guion).
2. Borrar el código de ejemplo y pegar todo `supabase/functions/leer-pedido/index.ts`.
3. **Deploy function**. Dejar prendido "Verify JWT" (así solo la usan usuarios logueados).

## 5. Usarlo
Cotizar → elegir cliente y mes → **Pegar pedido** → pegar el texto → **Leer pedido con IA**.
Las filas en amarillo hay que revisarlas (SKU dudoso, sin precio ese mes, o botellas que no cierran con los pallets). Se puede cambiar el SKU, los pallets o quitar filas, y después **Copiar cotización** para pegar en el correo.

Para que acierte más: en **SKUs**, columna **Otros nombres**, cargar cómo nombran los clientes cada producto (ej. `Giuliana, Burdeos, boca corcho`).

## Actualizar la función (cuando cambia el código)
Supabase → **Edge Functions** → `leer-pedido` → pestaña **Code** → borrar todo, pegar el `index.ts` nuevo → **Deploy updates**. La clave no se toca.

## Si dice que Gemini está saturado (error 503)
Es del lado de Google (pasa en el plan gratis en horas pico). La función ya reintenta sola y prueba otros modelos gratuitos (flash, flash-lite). Si aun así falla, esperar unos minutos.
