# Precios NCR

App web para gestionar precios por cliente de Nueva Cristalería Rosario: historial por cliente, SKU y mes, ajuste mensual con % de aumento, cotizador y alta/edición de clientes y SKUs. Reemplaza la planilla Excel con macros.

**Tecnología:** Supabase (base de datos y login) · React + TypeScript + Tailwind + shadcn/ui · Vercel (publicación).

## Qué hay en este repositorio

| Carpeta / archivo | Para qué sirve |
|---|---|
| `src/` | La app (pantallas: Ajuste mensual, Clientes, Ficha de cliente con historial, Cotizar, SKUs). |
| `supabase/migrations/0001_esquema.sql` | Crea las tablas, la seguridad (login + RLS) y las vistas. Se corre una sola vez. |
| `supabase/migrations/0002_precios_genericos_al_instante.sql` | Precios de los genéricos al instante (al crearlos o cambiarles el nivel). Se corre después de 0001. |
| `supabase/migrations/0003_datos_sku.sql` | Peso, unidades por pallet y color de cada SKU. |
| `supabase/migrations/0004_niveles_editables.sql` | Niveles de descuento con número fijo (id), editables (nombre, %, orden). Clientes enlazados por `nivel_id`. |
| `supabase/migrations/0005_cotizar_ultimo_mes.sql` | Cotizar muestra solo los precios del mes más nuevo, sin mezclar meses. |
| `supabase/reset.sql` | Borra todo lo de la app para empezar de cero. |
| `migracion/importar_excel.py` | Lee el Excel y genera el SQL con los datos iniciales. El Excel y el SQL generado **nunca** se suben. |
| `.env.example` | Modelo del archivo de claves. El `.env` real no se sube. |

## Puesta en marcha, paso a paso

### 1. Crear el proyecto en Supabase
1. Entrá a <https://supabase.com> y creá una cuenta (podés usar la de GitHub).
2. **New project** → nombre `precios-ncr`, región **South America (São Paulo)**, inventá una contraseña de base de datos y guardala en un lugar seguro (no la pegues en ningún chat).
3. Esperá un par de minutos a que termine de crearse.

### 2. Crear las tablas
1. **Solo si ya habías creado tablas antes y querés empezar de cero:** en Supabase, menú **SQL Editor** → **New query**, pegá todo `supabase/reset.sql` y apretá **Run**. ⚠️ Borra todas las tablas y precios de la app (no se puede deshacer). Los usuarios de login no se tocan. Al final tiene que mostrar una tabla vacía (0 filas).
2. **New query** otra vez: abrí `supabase/migrations/0001_esquema.sql`, copiá todo, pegalo y apretá **Run**. Tiene que decir *Success*.
3. **New query** otra vez con `supabase/migrations/0002_precios_genericos_al_instante.sql` → **Run**. Hace que un cliente genérico tenga sus precios apenas se crea o se le cambia el nivel. Se puede correr más de una vez sin problema.
4. **New query** con `supabase/migrations/0003_datos_sku.sql` → **Run**. Agrega a los SKUs peso, unidades por pallet y color.
5. **New query** con `supabase/migrations/0004_niveles_editables.sql` → **Run**. Permite editar los niveles de descuento desde la app: cada nivel pasa a tener un número fijo (id) y los clientes quedan enlazados a ese número, así se puede cambiar el nombre sin perder nada. Conserva el nivel de cada cliente. Después de este, no vuelvas a correr el 0002.
6. **New query** con `supabase/migrations/0005_cotizar_ultimo_mes.sql` → **Run**. El cotizador pasa a mostrar solo los precios del mes más nuevo de cada cliente (o de la última lista general, para genéricos). Si un SKU no tiene precio ese mes, no se cotiza.

### 3. Cerrar el registro público y crear tu usuario
1. **Authentication → Sign In / Providers → Email**: dejá Email activado y **desactivá "Allow new users to sign up"**. Así nadie se puede registrar solo.
2. **Authentication → Users → Add user → Create new user**: tu email y una contraseña. Marcá *Auto Confirm User*.
3. Autorizá tu email para ver los datos. En **SQL Editor** corré (con tu email, en minúsculas):
   ```sql
   insert into usuarios_autorizados (email, nombre) values ('tu-email@ejemplo.com', 'Javier');
   ```
   Para sumar a otra persona más adelante: crear su usuario (paso 2) y agregar su email igual.

### 4. Bajar el proyecto a tu computadora (con GitHub Desktop)
GitHub guarda el código "en la nube". Para correr el script de migración necesitás una copia en tu PC. GitHub Desktop la baja y la mantiene al día sin usar comandos.

**Primera vez:**
1. Descargá e instalá **GitHub Desktop** desde <https://desktop.github.com> y entrá con tu cuenta de GitHub.
2. **File → Clone repository** → pestaña **GitHub.com** → elegí `jcremas/precios-ncr`.
3. En **Local path** dejá la carpeta que propone (en Windows suele ser `Documentos\GitHub\precios-ncr`) → **Clone**.
4. Listo: esa carpeta es tu copia del proyecto. Para abrirla: **Repository → Show in Explorer** (Windows) o **Show in Finder** (Mac).

**Cada vez que yo (Claude) haga cambios:** abrí GitHub Desktop → **Fetch origin** y, si aparece, **Pull origin**. Tu carpeta queda igual que GitHub.

**Dónde poner el Excel:** lo más seguro es **dejarlo fuera** de esa carpeta (por ejemplo en `Documentos`) y pasarle la ruta al script, como en el paso 5. Si igual lo copiás adentro, no pasa nada: el proyecto está configurado para ignorar cualquier `.xlsx` / `.xlsm` / `.xls`, así que GitHub Desktop no lo va a ofrecer para subir. Regla de oro: si alguna vez GitHub Desktop te muestra un Excel o un archivo `.env` en la lista de cambios, **no hagas Commit** y avisame.

### 5. Cargar los datos del Excel (una sola vez)
**a) Instalar Python (una sola vez)**
- **Windows:** bajalo de <https://www.python.org/downloads/> (botón amarillo). Al instalar, **tildá "Add python.exe to PATH"** abajo de todo, y después *Install Now*.
- **Mac:** bajalo de la misma página e instalalo con doble click.

**b) Abrir una terminal dentro de la carpeta del proyecto**
- En GitHub Desktop: **Repository → Open in Command Prompt** (Windows) o **Open in Terminal** (Mac). Se abre una ventana negra ya ubicada en la carpeta correcta.

**c) Instalar lo que usa el script (una sola vez)** — escribí y Enter:
```bash
python -m pip install -r migracion/requirements.txt
```
(En Mac, si `python` no anda, usá `python3` en este y el siguiente comando.)

**d) Correr la migración** — reemplazá la ruta por la de tu Excel. Truco: escribí `python migracion/importar_excel.py ` (con un espacio al final) y **arrastrá el archivo Excel a la ventana**: la ruta se escribe sola. Después Enter.
```bash
python migracion/importar_excel.py "C:\Users\TU_USUARIO\Documents\PRECIOS_POR_CLIENTE.xlsm"
```
El script muestra un resumen (51 clientes especiales, 28 SKUs, lista general de 26 SKUs, 479 precios, 2 avisos de SKUs sin precio) y crea el archivo `migracion/salida/carga_inicial.sql` (tampoco se sube a GitHub).

**e) Pasar los datos a Supabase:** abrí `carga_inicial.sql` con el Bloc de notas, **Ctrl+A** y **Ctrl+C**, pegalo en el **SQL Editor** de Supabase y apretá **Run**. Corrélo **una sola vez**: si lo corrés dos veces da error de duplicados (no rompe nada, pero no hace falta). Después podés borrar el archivo.

### 6. Probar la app en tu computadora (opcional)
1. Instalá Node.js 22 o más nuevo.
2. Copiá `.env.example` como `.env` y completalo con **Project Settings → API**: *Project URL* y la clave *anon public* (en paneles nuevos puede llamarse *Publishable key*).
3. `npm install` y después `npm run dev`. Abrí <http://localhost:5173>.

### 7. Publicar en Vercel
1. Entrá a <https://vercel.com> con tu cuenta de GitHub → **Add New → Project** → elegí el repo `precios-ncr`.
2. En **Environment Variables** cargá `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` (los mismos valores del `.env`).
3. **Deploy**. Cada cambio que se suba a GitHub se publica solo.

> La clave *anon public* puede estar en la app publicada: está pensada para eso. Lo que protege los datos es el login y las reglas RLS. La que **nunca** hay que usar en la app ni pegar en ningún lado es la *service_role*.

> El plan gratuito de Supabase pausa el proyecto si pasa una semana sin uso. Se reactiva desde el panel con un click.

## Cómo funciona la base

- **clientes**: nombre completo, código de cliente único y **modalidad**:
  - **Genérico**: paga la lista general menos el descuento de su nivel (arrancan LISTA 0%, MEDIO 3%, AGRESIVO 6%, DIEGO 10%, MATAR 15%; se editan en la pantalla Niveles). Sus precios se guardan solos al **crearlo**, al **cambiarle el nivel**, al **tildarle un SKU** (mes actual, con la lista vigente) y al **publicar** cada lista general. Los meses anteriores no se tocan.
  - **Especial**: tiene su lista propia. La primera se arma con la lista general menos un descuento elegido; después se maneja con % y a mano en Ajuste mensual.
  - **Cotiza** sí/no: un cliente que no cotiza queda bloqueado sin borrarlo.
- **skus**: el número de SKU es la clave permanente (siempre entero). **Admite descuento** = no: vale el precio de lista en todos los niveles.
- **lista_general**: un precio de LISTA por SKU y mes, más el **precio mínimo** (piso) de referencia. Los niveles se calculan: LISTA × (1 − descuento), redondeado a 1 decimal.
- **cliente_skus**: mapa SKU × cliente, qué SKUs se le cotizan a cada uno. Un cliente nuevo arranca con todos los SKUs activos tildados; un SKU nuevo se tilda en todos los genéricos.
- **precios_cliente**: un precio por cliente, SKU y mes, para todos los clientes, con su **origen** (lista, aumento %, manual, migración). Si se corrige un precio ya guardado, el valor anterior queda en **precios_cliente_cambios**.
- **precios_competencia**: precios de la competencia por cliente, SKU y mes (pantalla pendiente).

## Pantallas

| Pantalla | Para qué |
|---|---|
| Ajuste mensual | Precios del mes de los clientes especiales: % de aumento, edición a mano, lista y mínimo de referencia (en rojo si quedás debajo del piso). |
| Lista general | Cargar la lista del mes (a mano, con % sobre la anterior o pegando desde Excel), el mínimo, y publicarla a los genéricos. |
| Clientes | Índice, alta y edición. En la ficha: historial, mapa de SKUs y, para un especial nuevo, armar su primera lista. |
| Consultas | Por SKU (mín., máx., promedio, mediana y detalle ordenable), ranking de clientes, brecha contra la lista, ficha, ajustes del mes, desactualizados y cobertura. Todo se exporta a Excel. |
| Cotizar | Precios vigentes de cualquier cliente (filtro genéricos/especiales y búsqueda), con unidades por pallet, en texto compacto para pegar en el correo. |
| Niveles | Agregar niveles de descuento, cambiar nombre, % y orden. Al cambiar el % se recalculan los precios del mes de sus genéricos. Un nivel con clientes no se borra. |
| SKUs | Alta y edición, estado, si admite descuento, peso, unidades por pallet y color (también pegando desde Excel). |
