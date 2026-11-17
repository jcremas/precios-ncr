# Precios NCR

App web para gestionar precios por cliente de Nueva Cristalería Rosario: historial por cliente, SKU y mes, envío mensual con % de aumento, cotizador y alta/edición de clientes y SKUs. Reemplaza la planilla Excel con macros.

**Tecnología:** Supabase (base de datos y login) · React + TypeScript + Tailwind + shadcn/ui · Vercel (publicación).

## Qué hay en este repositorio

| Carpeta / archivo | Para qué sirve |
|---|---|
| `src/` | La app (pantallas: Envío mensual, Clientes, Ficha de cliente con historial, Cotizar, SKUs). |
| `supabase/migrations/0001_esquema_inicial.sql` | Crea las tablas, la seguridad (login + RLS) y las vistas. Se corre una sola vez. |
| `migracion/importar_excel.py` | Lee el Excel y genera el SQL con los datos iniciales. El Excel y el SQL generado **nunca** se suben. |
| `.env.example` | Modelo del archivo de claves. El `.env` real no se sube. |

## Puesta en marcha, paso a paso

### 1. Crear el proyecto en Supabase
1. Entrá a <https://supabase.com> y creá una cuenta (podés usar la de GitHub).
2. **New project** → nombre `precios-ncr`, región **South America (São Paulo)**, inventá una contraseña de base de datos y guardala en un lugar seguro (no la pegues en ningún chat).
3. Esperá un par de minutos a que termine de crearse.

### 2. Crear las tablas
1. En Supabase: menú **SQL Editor** → **New query**.
2. Abrí `supabase/migrations/0001_esquema_inicial.sql`, copiá todo, pegalo y apretá **Run**. Tiene que decir *Success*.

### 3. Cerrar el registro público y crear tu usuario
1. **Authentication → Sign In / Providers → Email**: dejá Email activado y **desactivá "Allow new users to sign up"**. Así nadie se puede registrar solo.
2. **Authentication → Users → Add user → Create new user**: tu email y una contraseña. Marcá *Auto Confirm User*.
3. Autorizá tu email para ver los datos. En **SQL Editor** corré (con tu email, en minúsculas):
   ```sql
   insert into usuarios_autorizados (email, nombre) values ('tu-email@ejemplo.com', 'Javier');
   ```
   Para sumar a otra persona más adelante: crear su usuario (paso 2) y agregar su email igual.

### 4. Cargar los datos del Excel (una sola vez)
En tu computadora, con Python instalado:
```bash
pip install openpyxl
python3 migracion/importar_excel.py /ruta/a/PRECIOS_POR_CLIENTE.xlsm
```
El script muestra un resumen (clientes, SKUs, precios, avisos) y genera `migracion/salida/carga_inicial.sql`. Abrilo, copiá todo, pegalo en el **SQL Editor** de Supabase y apretá **Run**. Después podés borrar ese archivo.

### 5. Probar la app en tu computadora (opcional)
1. Instalá Node.js 22 o más nuevo.
2. Copiá `.env.example` como `.env` y completalo con **Project Settings → API**: *Project URL* y la clave *anon public* (en paneles nuevos puede llamarse *Publishable key*).
3. `npm install` y después `npm run dev`. Abrí <http://localhost:5173>.

### 6. Publicar en Vercel
1. Entrá a <https://vercel.com> con tu cuenta de GitHub → **Add New → Project** → elegí el repo `precios-ncr`.
2. En **Environment Variables** cargá `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` (los mismos valores del `.env`).
3. **Deploy**. Cada cambio que se suba a GitHub se publica solo.

> La clave *anon public* puede estar en la app publicada: está pensada para eso. Lo que protege los datos es el login y las reglas RLS. La que **nunca** hay que usar en la app ni pegar en ningún lado es la *service_role*.

> El plan gratuito de Supabase pausa el proyecto si pasa una semana sin uso. Se reactiva desde el panel con un click.

## Cómo funciona la base

- **niveles**: LISTA 0%, MEDIO 3%, AGRESIVO 6%, DIEGO 10%, MATAR 15%, ESPECIAL, NO COTIZA.
- **skus**: el número de SKU es la clave permanente (siempre entero). La descripción se edita en un solo lugar.
- **clientes**: nombre completo (sin el límite de 31 caracteres del Excel) y código de cliente único.
- **cliente_skus**: qué SKUs compra cada cliente (su grilla para el envío mensual).
- **lista_precios**: precio de cada SKU por nivel y mes de vigencia. Se guarda el precio de cada nivel tal cual, porque en algunos SKUs no se aplica el descuento.
- **precios_cliente**: un precio por cliente, SKU y mes. Si se corrige un precio ya guardado, el valor anterior queda en **precios_cliente_cambios** (no se pierde nada).
- **precios_competencia**: precios de la competencia por cliente, SKU y mes (pantalla pendiente).
- Vistas: historial con variación mensual y acumulada, último precio, índice de clientes, resumen mínimo/máximo/promedio por SKU y mes.
