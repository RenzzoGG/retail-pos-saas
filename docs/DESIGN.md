# Diseño técnico — Stocktill (POS SaaS multitienda)

> **Stocktill es una marca ficticia** creada para un proyecto de portafolio; no es un producto comercial.
>
> Estado: diseño aprobado al cierre de la Fase 0 (decisiones confirmadas por el usuario).
> Interfaz de usuario en inglés; documentación en español.

## 1. Arquitectura general

```
                         ┌──────────────────────────────────────────────┐
  Navegador              │  Contenedor Docker (Railway en producción)   │
  (POS, dashboard,       │                                              │
   landing GSAP)  ─────► │  Next.js (App Router)                        │
                  HTTPS  │   • Server Components  → lecturas            │
                         │   • Server Actions     → mutaciones          │
                         │   • Route Handlers     → /api/stripe/webhook │
                         │                          /api/tickets/[id]   │
                         │                          /api/exports/...    │
                         └───────┬───────────────────────┬──────────────┘
                                 │ JWT del usuario       │ firma del webhook
                                 ▼                       ▲
              ┌──────────────────────────────┐   ┌───────┴────────┐
              │ Supabase                     │   │ Stripe (test)  │
              │  • Auth (sesión por cookies) │   │  • Checkout    │
              │  • PostgreSQL + RLS          │   │  • Billing     │
              │  • Funciones SQL (RPC)       │   │    Portal      │
              │  • Storage (imágenes, Excel) │   │  • Webhooks    │
              └──────────────────────────────┘   └────────────────┘
```

**Flujo típico:** el navegador llama a una Server Action → la acción lee la sesión de Supabase desde
las cookies (`@supabase/ssr`), valida el rol y los datos (Zod) → llama a la BD **con el JWT del usuario**,
de modo que RLS se aplica siempre → para operaciones críticas (venta, devolución, entrada) llama a una
función SQL que hace todo en una sola transacción.

**Stripe:** la app crea una sesión de Checkout; Stripe cobra y envía eventos al webhook
`/api/stripe/webhook`. El webhook verifica la firma, registra el evento (idempotencia) y actualiza la tabla
`subscriptions`. Las páginas de la app consultan esa tabla para permitir o bloquear el acceso.

**Entornos:**

| | Local (WSL) | Producción |
|---|---|---|
| App | Docker Compose (`next dev`) o `npm run dev` | Contenedor en Railway (Dockerfile multi-stage) |
| Supabase | Supabase CLI (`supabase start`, levanta sus propios contenedores) | Supabase Cloud, plan gratuito (los proyectos inactivos se pausan) |
| Stripe | Modo prueba + `stripe listen` para reenviar webhooks | Modo prueba, webhook al dominio de Railway |

*Por qué Supabase CLI y no meter Supabase en nuestro Compose:* el CLI ya orquesta ~10 servicios
(Postgres, GoTrue, PostgREST, Storage, Studio...) con versiones probadas entre sí; replicarlo a mano en
Compose es frágil. **Decidido:** Compose se usa solo para la app.

**Cómo habla el contenedor de la app con Supabase local (Fase 1):** el CLI publica los puertos de
Supabase en el host (API `54321`, Postgres `54322`). Dentro del contenedor, `127.0.0.1` es el propio
contenedor, así que `compose.yaml` añade `extra_hosts: host.docker.internal:host-gateway` y define
`SUPABASE_INTERNAL_URL=http://host.docker.internal:54321` para el **servidor** de Next.js. El
**navegador** sigue usando `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`. Como `@supabase/ssr`
nombra la cookie de sesión según el hostname de la URL, ambos clientes usan un nombre fijo
(`sb-stocktill-auth-token`) para que la sesión coincida. Se descartó unir el contenedor a la red
interna del CLI (`supabase_network_<project_id>`, depende de nombres internos y solo existe tras
`supabase start`) y `network_mode: host` (menos portable y anula el mapeo de puertos).

### Acceso a datos — decidido
- **Drizzle** define el esquema en TypeScript y genera las migraciones SQL. RLS, funciones y triggers
  se escriben como SQL en migraciones personalizadas (Drizzle permite migraciones "custom").
- **En runtime** la app consulta con `supabase-js` usando el JWT del usuario: PostgREST ejecuta cada
  consulta con el rol `authenticated` y los claims del usuario, y RLS se aplica automáticamente.
- Los tipos de Drizzle (`InferSelectModel`) se reutilizan en la app.
- *Por qué no Drizzle directo en runtime:* una conexión directa a Postgres entra como un rol con
  privilegios y **se salta RLS**, salvo que en cada transacción hagamos `set local role authenticated` y
  `set local request.jwt.claims`. Es posible, pero un olvido = fuga de datos entre tiendas.
- La clave **service role** (salta RLS) solo se usa en: webhook de Stripe y scripts de seed. Nunca en
  código que atienda peticiones de usuarios.

## 2. Modelo de datos (implementado en la Fase 2)

Fuente de verdad: `db/schema/*.ts` (Drizzle) → `supabase/migrations/*_schema.sql`. RLS, privilegios,
triggers y funciones están en `*_security.sql` y `*_functions.sql` (migraciones SQL personalizadas,
registradas en el journal de Drizzle). `supabase db reset` aplica todo en orden y luego `supabase/seed.sql`.

**Convenciones**
- PK `uuid default gen_random_uuid()` (excepto `activity_log` y `stock_movements`: `bigint identity`,
  porque son registros de solo-añadir y ordenarlos por id es útil).
- `created_at`/`updated_at timestamptz` (`updated_at` lo mantiene el trigger `app.set_updated_at`).
- Dinero `numeric(12,2)`; tasas `numeric(5,4)`; cantidades `integer` (solo unidades enteras).
- Todas las tablas de negocio llevan `store_id` (la clave del aislamiento).
- **Claves foráneas compuestas** `(x_id, store_id) → padre(id, store_id)` en todas las tablas hijas.
  *Por qué:* RLS solo valida el `store_id` de la fila que escribes. Sin la FK compuesta, el usuario de
  la tienda A podría insertar en su tienda una fila que apunte a un producto o cliente de B si adivinara
  su UUID. Con la FK compuesta, la BD exige que el padre pertenezca a la **misma** tienda.
- `CHECK`: stock ≥ 0, cantidades > 0, montos ≥ 0, pagos > 0, descuento ≤ subtotal, moneda ISO
  (`^[A-Z]{3}$`), `tax_rate` entre 0 y 1, signo del movimiento acorde a su tipo, efectivo entregado ≥ monto.
- Índices en `store_id`, `(store_id, created_at)` para ventas/movimientos/log, y únicos parciales
  `(store_id, sku)` y `(store_id, barcode)` solo para productos no borrados (soft delete).

**Impuestos y moneda por tienda:** `stores.currency`, `stores.tax_rate`, `stores.prices_include_tax`.
- Impuesto incluido: `total = subtotal − descuento`, `tax = round(total · r / (1 + r), 2)`.
- Impuesto añadido: `tax = round((subtotal − descuento) · r, 2)`, `total = base + tax`.
- Cada venta copia `tax_rate` y `prices_include_tax`, así cambiar la configuración no altera el pasado.

**Costo promedio ponderado** (decidido en la Fase 2): cada entrada recalcula
`costo = (stock · costo_actual + cant · costo_entrada) / (stock + cant)`; si el stock era 0, el costo pasa a
ser el de la entrada. Cada venta copia el costo vigente en `sale_item_costs` para calcular la utilidad.

### Diagrama entidad-relación

```mermaid
erDiagram
  AUTH_USERS ||--|| PROFILES : "1 perfil"
  AUTH_USERS ||--o{ STORE_MEMBERS : "pertenece"
  STORES ||--o{ STORE_MEMBERS : "equipo (owner/admin/cashier)"
  STORES ||--o{ INVITATIONS : "invita"
  STORES ||--o{ PRODUCTS : "catálogo"
  PRODUCTS ||--o| PRODUCT_COSTS : "costo (oculto al cajero)"
  STORES ||--o{ STOCK_ENTRIES : "recibe"
  STOCK_ENTRIES ||--|{ STOCK_ENTRY_ITEMS : "líneas"
  PRODUCTS ||--o{ STOCK_ENTRY_ITEMS : "recibido en"
  PRODUCTS ||--o{ STOCK_MOVEMENTS : "libro de stock"
  STORES ||--o{ CUSTOMERS : "clientes"
  CUSTOMERS |o--o{ SALES : "historial"
  STORES ||--o{ SALES : "vende"
  SALES ||--|{ SALE_ITEMS : "líneas"
  PRODUCTS ||--o{ SALE_ITEMS : "vendido en"
  SALE_ITEMS ||--|| SALE_ITEM_COSTS : "costo copiado (oculto al cajero)"
  SALES ||--o{ SALE_PAYMENTS : "pagos (mixtos)"
  SALES ||--o{ RETURNS : "devoluciones"
  RETURNS ||--|{ RETURN_ITEMS : "líneas"
  SALE_ITEMS ||--o{ RETURN_ITEMS : "devuelve"
  STORES ||--o| SUBSCRIPTIONS : "plan Stripe"
  STORES ||--o{ ACTIVITY_LOG : "historial (sin FK)"

  STORES {
    uuid id PK
    text slug UK
    text currency
    numeric tax_rate
    bool prices_include_tax
    int last_sale_number
  }
  PRODUCTS {
    uuid id PK
    uuid store_id FK
    text sku
    text barcode
    numeric sale_price
    int stock "CHECK >= 0"
    timestamptz deleted_at
  }
  SALES {
    uuid id PK
    uuid store_id FK
    int number "único por tienda"
    numeric subtotal
    numeric tax_total
    numeric total
    uuid idempotency_key "único por tienda"
  }
  STOCK_MOVEMENTS {
    bigint id PK
    uuid product_id FK
    enum type "sale|return|entry"
    int quantity "con signo"
    int stock_after
  }
  ACTIVITY_LOG {
    bigint id PK
    uuid store_id
    uuid actor_id
    text table_name
    enum action
    jsonb before
    jsonb after
  }
```

### Tablas (19)
| Grupo | Tabla | Para qué |
|---|---|---|
| Identidad | `stores` | Negocio: nombre, slug, moneda, impuestos, pie de ticket, contador de ventas |
| | `profiles` | Nombre del usuario (1-1 con `auth.users`, creado por trigger) |
| | `store_members` | Usuario ↔ tienda con rol `owner`/`admin`/`cashier` |
| | `invitations` | Invitaciones por email con rol (nunca `owner`), token guardado como hash |
| Inventario | `products` | SKU, código de barras, precio de venta, stock, umbral de stock bajo, soft delete |
| | `product_costs` | Costo promedio ponderado (tabla aparte: el cajero no la ve) |
| | `stock_entries` / `stock_entry_items` | Entradas de mercancía con costo unitario |
| | `stock_movements` | Libro mayor de stock: `stock = Σ quantity` por producto |
| Ventas | `customers` | Clientes; su historial son sus `sales` |
| | `sales` | Cabecera: número por tienda, totales, impuesto copiado, estado, clave de idempotencia |
| | `sale_items` | Líneas con copia de nombre/SKU/precio |
| | `sale_item_costs` | Costo copiado por línea (utilidad; oculto al cajero) |
| | `sale_payments` | Pagos `cash`/`card`/`transfer`, mixtos, con efectivo entregado |
| | `returns` / `return_items` | Devoluciones ligadas a la venta y a cada línea |
| Auditoría | `activity_log` | Quién creó/editó/borró qué (antes/después), inmutable |
| Stripe | `subscriptions` | Estado del plan por tienda (lo escribe el webhook) |
| | `stripe_events` | Eventos procesados (idempotencia del webhook) |

`import_batches` (importación de Excel) se crea en la Fase 5.

## 3. Seguridad: RLS, privilegios y roles (implementado en la Fase 2)

### Cómo funciona RLS (resumen para aprender)
- PostgREST (la API de Supabase) verifica el JWT del usuario y ejecuta cada consulta como el rol
  `authenticated` con los *claims* del token en `request.jwt.claims`; `auth.uid()` lee de ahí el `sub`.
  Sin sesión, la consulta corre como `anon`.
- Con RLS activado, Postgres añade a cada consulta la condición de la política:
  - **`USING`** filtra qué filas existentes ves, actualizas o borras. Una fila que no pasa es invisible:
    un `UPDATE`/`DELETE` sobre otra tienda afecta **0 filas** sin dar error.
  - **`WITH CHECK`** valida la fila nueva en `INSERT`/`UPDATE`. Si no pasa → error `42501`.
  - Sin ninguna política para una operación → denegada (**negar por defecto**).
- RLS decide **filas**; los **privilegios (`GRANT`)** deciden operaciones y **columnas**. Usamos ambos.
- El dueño de las tablas (`postgres`) y `service_role` saltan RLS. Por eso la clave `service_role` solo
  existe en el servidor (webhook de Stripe, seeds) y las funciones `SECURITY DEFINER` revalidan todo.

### Capas de defensa (todas deben permitir la acción)
1. **Privilegios mínimos:** `anon` no tiene ningún privilegio en `public`. `authenticated` solo lo
   necesario, con **privilegios por columna**: nunca puede escribir `products.stock`,
   `stores.last_sale_number`, `id`, `store_id` (al actualizar) ni `created_by`/`invited_by` (los llena un
   trigger con `auth.uid()`, así nadie se hace pasar por otro). Las tablas de ventas, devoluciones, libro
   de stock, historial y suscripción no tienen INSERT/UPDATE/DELETE para `authenticated`.
   `alter default privileges` evita que futuras tablas se concedan a `anon` automáticamente.
2. **RLS en las 19 tablas** con las políticas de abajo.
3. **Funciones `SECURITY DEFINER`** como única vía para escribir ventas, devoluciones, entradas y stock.
4. **Triggers de integridad:** `app.guard_stock` (el stock no cambia fuera de las funciones, ni siquiera
   con `service_role`), `app.ensure_store_has_owner` (una tienda nunca se queda sin owner),
   `app.block_activity_log_changes` (historial inmutable para todos).
5. **Constraints:** FKs compuestas y `CHECK`.

### Funciones auxiliares (schema `app`)
`app.is_store_member(store_id)`, `app.has_store_role(store_id, roles[])`, `app.is_store_manager(store_id)`
(= owner o admin) y `app.shares_store_with(user_id)`.
- **Por qué `SECURITY DEFINER`:** la política de `store_members` necesita consultar `store_members`; si la
  consulta pasara por RLS habría recursión infinita. Como *definer*, la función lee la tabla con los
  privilegios de su dueño y devuelve solo un booleano.
- **Por qué es seguro:** (1) responden solo sobre el usuario actual (`auth.uid()` del JWT), nunca sobre un
  usuario pasado por parámetro, así no sirven para espiar membresías ajenas; (2) `set search_path = ''`
  y nombres totalmente calificados (`public.store_members`, `auth.uid()`) impiden el secuestro por
  `search_path` (crear un objeto con el mismo nombre en otro schema para que la función lo use);
  (3) el schema `app` no está expuesto por PostgREST, así que no se pueden llamar como `/rpc`;
  (4) `EXECUTE` revocado a `PUBLIC`/`anon`. Una prueba pgTAP falla si alguna función definer no fija
  `search_path`.

### Políticas por tabla (todas `to authenticated`)
"miembro" = `app.is_store_member(store_id)`; "manager" = owner o admin.
Desde la fase 8, las políticas **SELECT** expresan lo mismo como
`store_id in (select app.member_store_ids())` / `app.managed_store_ids()`, que se evalúa una vez por
consulta en lugar de por fila (20 veces más rápido en reportes; ver 4f).

| Tabla | SELECT | INSERT | UPDATE | DELETE | Por qué |
|---|---|---|---|---|---|
| `stores` | miembro | — | manager (solo columnas de config) | — | La creación llega en la Fase 3 con una función que crea tienda + owner en una transacción |
| `profiles` | uno mismo o compañeros de tienda | — (trigger) | uno mismo (`full_name`) | — | Ver nombres del equipo sin exponer a usuarios ajenos |
| `store_members` | miembro | `app.can_manage_role`: owner cualquier rol; admin solo `cashier` | ídem (USING = fila actual, WITH CHECK = fila nueva) | ídem | Desde la Fase 3 **solo el owner gestiona admins**: el admin no puede invitar, ascender, degradar ni quitar admins ni owners |
| `invitations` | manager | `app.can_manage_role` (owner: admin/cashier; admin: cashier) | — | ídem | Aceptar = `accept_invitation()`; el CHECK impide invitar owners; un solo pendiente por email y tienda |
| `products` | miembro | manager (sin `stock`) | manager (sin `stock`) | — | El POS necesita nombre/precio/stock; borrar = `deleted_at` (las ventas siguen apuntando al producto) |
| `product_costs` | manager | manager | manager (`cost_price`) | — | Costos fuera del alcance del cajero |
| `stock_entries`, `stock_entry_items`, `stock_movements` | manager | — | — | — | Incluyen costos; se escriben solo con funciones |
| `customers` | miembro | miembro | miembro | manager | El cajero registra clientes en caja |
| `sales`, `sale_items`, `sale_payments`, `returns`, `return_items` | miembro | — | — | — | El cajero ve todas las ventas de su tienda (reimprimir ticket, decidido en Fase 2); escribir solo con funciones |
| `sale_item_costs` | manager | — | — | — | Es la utilidad |
| `activity_log` | manager | — | — | — | Lo escribe un trigger `SECURITY DEFINER`; inmutable |
| `subscriptions` | miembro | — | — | — | Todos necesitan saber si la tienda está activa; solo el webhook escribe |
| `stripe_events` | — | — | — | — | Sin políticas ni privilegios: solo `service_role` |

### Matriz de permisos por rol
| Recurso | owner | admin | cashier |
|---|---|---|---|
| Productos (ver nombre, precio de venta, stock) | ✅ | ✅ | ✅ |
| Crear/editar productos, cambiar precios | ✅ | ✅ | ❌ |
| Costos y utilidades | ✅ | ✅ | ❌ |
| Registrar ventas | ✅ | ✅ | ✅ |
| Ver ventas de la tienda | ✅ | ✅ | ✅ |
| Devoluciones | ✅ | ✅ | ❌ |
| Configurar tienda (moneda, impuestos, ticket) | ✅ | ✅ | ❌ |
| Entradas de mercancía / importar Excel | ✅ | ✅ | ❌ |
| Clientes (ver, crear, editar) | ✅ | ✅ | ✅ |
| Borrar clientes | ✅ | ✅ | ❌ |
| Historial de actividad | ✅ | ✅ | ❌ |
| Invitar / cambiar rol / quitar cajeros | ✅ | ✅ | ❌ |
| Invitar / cambiar rol / quitar admins | ✅ | ❌ | ❌ |
| Asignar el rol owner | ✅ | ❌ | ❌ |
| Suscripción y facturación | ✅ | ❌ | ❌ (Fase 9) |

**Tienda activa:** ver §3b.

## 3b. Autenticación, sesión y protección de rutas (implementado en la Fase 3)

### Cómo funciona la sesión con cookies
1. **Login** (`signInWithPassword` en una Server Action): Supabase Auth devuelve un *access token*
   (JWT firmado, vive ~1 h) y un *refresh token*. `@supabase/ssr` los guarda en cookies del dominio de la
   app (`sb-stocktill-auth-token`, troceada si es grande) mediante `cookies().set()`.
2. **En cada petición**, el navegador envía esas cookies. El servidor crea un cliente de Supabase con
   ellas, así cada consulta a la API viaja con el JWT del usuario y **RLS** sabe quién es.
3. **Refresco:** `src/proxy.ts` (el antiguo *middleware*; en Next 16 se llama **Proxy**) corre antes de
   cada ruta y llama `supabase.auth.getClaims()`. Si el access token caducó, usa el refresh token y
   escribe las cookies nuevas en la petición (para que las vea el render actual) y en la respuesta (para
   que el navegador las guarde). Los Server Components no pueden escribir cookies; por eso se hace ahí.
4. **Verificación:** `getClaims()` valida la firma y caducidad del JWT (con las claves públicas JWKS
   del proyecto; si no hay claves asimétricas, pregunta al servidor de Auth). Nunca usamos
   `getSession()` para autorizar: solo decodifica la cookie sin verificarla.
5. **Logout:** `signOut()` invalida la sesión en Auth y borra las cookies.

### Protección de rutas (dos capas)
- **Proxy (optimista):** sin sesión en `/app`, `/onboarding` o `/invite` → `/login?next=…`; con sesión
  en `/login`/`/signup` → `/app`. Es rápido pero **no es la barrera de seguridad** (la doc de Next lo
  advierte: solo lee la cookie).
- **Data Access Layer** (`src/lib/auth/dal.ts`, `server-only`, memoizada con `cache()` de React):
  `requireUser()`, `getMemberships()`, `requireStoreContext()` y `requireRole(roles)`. Cada página
  privada y cada Server Action la llama; las páginas de managers responden **404** a otros roles (no
  revelan que existen). Debajo, RLS sigue siendo la garantía final.
- Con `cacheComponents`, leer cookies fuera de `<Suspense>` es error de build: el layout privado
  envuelve el contenido dependiente de la sesión en `<Suspense>` (estructura estática + streaming), y
  cada sección de `/app` tiene un `loading.tsx` (su propio límite de Suspense) para que las navegaciones
  muestren "Loading…" al instante.
- `getSessionUser()` llama `await connection()` antes de verificar el JWT: supabase-js compara la
  caducidad del token con la hora actual (`Date.now()`), y Next exige marcar ese trabajo como "solo en
  tiempo de petición" para no intentar prerenderizarlo.
- **Estado HTTP de las páginas prohibidas:** como el área privada se transmite por streaming, la
  respuesta ya empezó con `200` cuando la DAL comprueba el rol dentro de `<Suspense>`; `notFound()`
  muestra la pantalla 404 (con `noindex`) pero el código queda en 200 ("soft 404", comportamiento
  documentado de Next 16). No se filtra contenido. Un 404 real exigiría consultar el rol en el Proxy
  (una consulta a la BD en cada petición), que Next desaconseja.

### Tienda activa
Cookie `stocktill_active_store` (`httpOnly`, `SameSite=Lax`, `Secure` en producción, 1 año). Solo
**recuerda** la elección: en cada petición la DAL comprueba que el usuario sea miembro de esa tienda;
si no (cookie manipulada o membresía quitada) usa su primera tienda. Sin membresías → `/onboarding`.
Cambiar de tienda = Server Action `switchStore`, que también valida la membresía.

### Correos (local: Mailpit)
- Confirmación y recuperación los envía **Supabase Auth** con plantillas propias
  (`supabase/templates/*.html`) cuyo enlace va a `/auth/confirm?token_hash=…&type=…`. Esa ruta llama
  `verifyOtp` y crea la sesión. Funciona aunque el correo se abra en otro navegador (el flujo PKCE con
  `code` exige el mismo navegador).
- Invitaciones: las envía **la app** por SMTP con `nodemailer` (`src/lib/email`). En local,
  Mailpit expone SMTP en `54325` (`[local_smtp] smtp_port`). En producción, cualquier proveedor SMTP vía
  `SMTP_*`.
- Redirecciones post-login/confirmación pasan por `safeNextPath` (solo rutas relativas del propio
  sitio: evita *open redirects*).

### Invitaciones
1. Owner/admin envía email + rol. El servidor valida el rol con `invitableRoles` (owner: admin o
   cajero; admin: solo cajero) y la BD lo repite con RLS (`app.can_manage_role`).
2. Se generan **32 bytes aleatorios** (`base64url`); el enlace del correo lleva el token y la BD guarda
   solo su **SHA-256** (`token_hash`). Expira en **7 días**; reenviar reemplaza el pendiente.
3. El invitado abre `/invite/<token>`: si no tiene sesión inicia sesión o se registra (el `next` lo trae
   de vuelta); `invitation_preview` muestra tienda y rol.
4. `accept_invitation(token)` (definer) bloquea la invitación (`for update`) y valida que exista, no esté
   usada ni vencida, y que **el email del usuario sea el invitado**; crea la membresía y marca
   `accepted_at`/`accepted_by`. Estado mostrado: `pending`, `expired` o `accepted` (calculado).

### Funciones SQL de la Fase 3
| Función | Quién | Qué hace |
|---|---|---|
| `create_store(name, currency, tax_rate, prices_include_tax)` | cualquier usuario autenticado | Tienda + configuración + membresía owner en una transacción; slug con sufijo aleatorio |
| `invitation_preview(token)` | autenticado con el token | Tienda, rol, email y estado de la invitación |
| `accept_invitation(token)` | el usuario invitado | Valida y crea la membresía |
| `app.can_manage_role(store, role)` | (políticas) | owner → cualquier rol; admin → solo `cashier` |
| `app.hash_token(token)` | (interno) | SHA-256 hex; nadie la puede llamar desde la API |

`profiles.email` se copia de `auth.users` por trigger para que la página del equipo muestre correos.

## 4. Consistencia del stock (implementado en la Fase 2)

Funciones en `public` (expuestas como `/rpc/...` solo para `authenticated`), todas `SECURITY DEFINER`,
`search_path = ''`, y cada una corre en **una transacción**: si algo falla no queda nada a medias.

| Función | Quién | Qué hace |
|---|---|---|
| `create_stock_entry(store_id, items, supplier?, note?)` | owner/admin | Suma stock, recalcula costo promedio ponderado, registra movimiento `entry` |
| `create_sale(store_id, items, payments, idempotency_key, customer_id?, discount?, note?)` | cualquier miembro | Descuenta stock, toma precios de la BD, calcula impuestos, valida pagos = total, numera, copia costos, registra movimientos `sale` |
| `create_return(sale_id, items, reason?, refund_method?)` | owner/admin | Valida cantidad ≤ vendida − devuelta, reembolso proporcional, repone stock, movimiento `return`, estado de la venta |

Garantías:
1. **Nadie escribe `products.stock` directamente**: sin privilegio de columna para `authenticated`, y
   `app.guard_stock` lo rechaza incluso a `service_role`/`postgres` salvo que la transacción venga de una
   de las tres funciones (bandera local `app.stock_write`, que la API no permite fijar).
2. **Descuento atómico con bloqueo de fila:**
   `update products set stock = stock - q where id = … and stock >= q returning …`. Si no devuelve fila
   → `insufficient_stock`. Dos ventas simultáneas del último artículo se serializan en la fila.
   Los productos se procesan **ordenados por id** en todas las funciones para evitar interbloqueos.
3. **`CHECK (stock >= 0)`** como última red. Cantidades enteras > 0 validadas (rechaza `1.5`, `0`, `-2`).
4. **Libro de movimientos:** cada cambio inserta en `stock_movements` (con `stock_after`); una prueba
   verifica `stock = Σ movimientos` y el saldo acumulado de cada movimiento.
5. **Idempotencia:** `pg_advisory_xact_lock` por (tienda, clave) y, si la clave ya existe, se devuelve la
   venta original sin cobrar dos veces. Restricción única `(store_id, idempotency_key)`.
6. **El servidor manda en los números:** precio desde `products`, impuestos desde `stores`, y la suma de
   pagos debe ser exactamente el total.
7. **Devoluciones:** bloquean la venta (`for update`); reembolso = parte proporcional del total (prorratea
   descuentos e impuestos); la devolución que completa la venta reembolsa exactamente el resto, así la suma
   nunca supera el total por redondeo. Si la venta es de otra tienda responde `sale_not_found` (no revela
   que existe).
8. **Número de venta consecutivo por tienda** con `update stores set last_sale_number = last_sale_number + 1`
   (bloquea la fila de la tienda durante la venta; aceptable para tiendas pequeñas).

Errores de las funciones (el `message` es un código estable para mostrar mensajes en la UI):
`not_authenticated`, `forbidden` (42501); `invalid_items`, `invalid_quantity`, `invalid_amount`,
`invalid_discount`, `invalid_payments`, `payments_mismatch`, `duplicate_product`,
`missing_idempotency_key` (22023); `product_not_found`, `customer_not_found`, `sale_not_found`,
`sale_item_not_found` (P0002); `insufficient_stock`, `return_exceeds_sold`, `store_needs_owner` (23514);
`stock_is_read_only`, `activity_log_is_append_only` (42501).

**Pendiente (Fase 6):** prueba de concurrencia real con dos conexiones simultáneas (Vitest + `postgres`);
pgTAP corre en una sola sesión.

### Historial de actividad
`app.log_activity` (trigger `AFTER INSERT/UPDATE/DELETE`) en `stores`, `store_members`, `invitations`,
`products`, `product_costs`, `customers`, `stock_entries`, `sales` y `returns`: guarda tienda, actor
(`auth.uid()`, nulo si fue el servidor), tabla, id, acción y el registro antes/después en JSON (sin
`token_hash`). Ignora los cambios que solo tocan `updated_at`, `stock` o `last_sale_number` (la historia del
stock está en `stock_movements`). `store_id`/`actor_id` no tienen FK a propósito: el historial es
inmutable y debe sobrevivir aunque se borre la tienda o el usuario.

## 4b. Inventario e historial (implementado en la Fase 4)

### Rutas
| Ruta | Quién | Qué |
|---|---|---|
| `/app/products` | todos | Catálogo: búsqueda (nombre, SKU o código), categoría, "Low stock only", orden por columnas, paginación en el servidor. Costo y margen solo para owner/admin |
| `/app/products/new`, `/app/products/[id]` | owner/admin | Crear/editar/borrar (lógico) y libro de movimientos del producto |
| `/app/products/receive` | owner/admin | Entrada de mercancía con escaneo de código de barras |
| `/app/products/entries(/[id])` | owner/admin | Historial y detalle de entradas |
| `/app/activity` | owner/admin | Historial de actividad con filtros (usuario, acción, fechas) y paginación |
| `/app` | todos | Aviso de stock bajo con enlace a la lista filtrada |

### Decisiones
- **Costo solo por entradas:** el costo es el promedio ponderado que calcula `create_stock_entry`; el
  formulario de producto lo muestra pero no lo edita. Sin entradas, el costo es "—".
- **Margen sobre el precio neto:** si los precios incluyen impuesto, el impuesto no es ingreso:
  `margen = precio / (1 + tasa) − costo` (`src/lib/money.ts#marginInfo`, aritmética en centavos).
- **`products.is_low_stock`** es una columna **generada** (`stock <= low_stock_threshold`): PostgREST
  no puede comparar dos columnas en un filtro, así que la condición se materializa para filtrar y contar.
  Stock 0 cuenta como bajo. `app.log_activity` la ignora (como `stock`) para que una venta no aparezca
  como edición del producto.
- **Zona horaria por tienda** (`stores.timezone`, IANA, validada por trigger contra
  `pg_timezone_names`): fechas mostradas y filtros "desde/hasta" se calculan en la hora de la tienda
  (`src/lib/timezone.ts`, solo `Intl`). La Fase 8 la reutiliza para ventas diarias.
- **Costos y RLS:** la lista pide `product_costs(cost_price)` solo para managers; aunque un cajero lo
  pidiera, RLS devuelve `[]` (probado).
- **Búsqueda segura:** el texto del usuario se limpia (`escapeSearchTerm`) y va entre comillas en el
  filtro `or(...)` de PostgREST, así no puede alterar la consulta (probado con un intento de inyección).
- **Escaneo:** un lector USB teclea el código y pulsa Enter. En "Scan or search", Enter busca el código o
  SKU **exacto**; si el producto ya está en la lista suma 1. El campo se vacía en el mismo momento del
  Enter (escaneos seguidos no se pisan) y está fuera del `<form>` (un Enter nunca envía la entrada).
- **Historial legible:** `src/features/activity/describe.ts` convierte el JSON antes/después en frases
  ("Product “X” updated: sale price 9.99 → 12.50"), ocultando campos internos. Actor desconocido =
  "Former member"; sin actor = "System".

## 4c. Importación de productos desde Excel/CSV (implementado en la Fase 5)

**Ruta:** `/app/products/import` (owner/admin; pestaña "Import"). Plantillas en
`/app/products/import/template?format=xlsx|csv`. Ejemplos en `docs/samples/` (se regeneran con
`node scripts/generate-import-samples.mjs`).

### Librería: SheetJS CE 0.20.3, vendorizada
- El paquete `xlsx` del registro de npm quedó en 0.18.5 (vulnerabilidades conocidas: prototype pollution y
  ReDoS, corregidas en 0.19.3 y 0.20.2). SheetJS publica las versiones actuales solo en su CDN.
- npm 12 rechaza por defecto dependencias de URLs remotas (`allow-remote`), así que el tarball oficial se
  guardó en `vendor/xlsx-0.20.3.tgz` (verificado: Apache-2.0, sin dependencias, sin scripts de instalación) y
  se instala como `file:`. `package-lock.json` fija su `sha512`; CI y Docker no dependen del CDN.
- Una sola librería lee `.xlsx`/`.csv` y escribe la plantilla.

### El archivo es dato no confiable
| Defensa | Detalle |
|---|---|
| Tamaño | Máx. **1 MB** (`bodySizeLimit` de Server Actions subido a 2 MB para el envío) |
| Filas | Máx. **2.000** productos (también lo exige `import_products`) |
| Tipo | Extensión + firma (`.xlsx` debe ser ZIP; `.csv` texto sin bytes NUL) |
| Zip bomb | Antes de parsear un `.xlsx` se lee el directorio central del ZIP: tamaño descomprimido declarado ≤ 20 MB, ≤ 200 entradas, sin ZIP64 |
| Parser | Solo la primera hoja, `sheetRows` acotado, sin fórmulas/estilos/HTML/VBA; CSV con `raw` (no convierte "0012" en 12) |
| Persistencia | El archivo se procesa en memoria y no se guarda |
| SKU | Debe empezar con letra o dígito, sin espacios (`CHECK products_sku_format`): nunca parece una fórmula |
| Reporte CSV | Celdas que empiezan con `= + - @` se prefijan con `'` (inyección de fórmulas) |

### Flujo
1. **Vista previa** (`previewImportAction`): parsea, mapea encabezados (cualquier orden, sin importar
   mayúsculas, con alias), interpreta números "raros" (`$1,234.50`, `1.234,50`, `12,5`) y valida cada fila
   y columna: obligatorios, precio ≥ 0 con 2 decimales, enteros ≥ 0, costo obligatorio con stock (y no
   permitido sin stock: el costo solo viene de entradas), duplicados de SKU/código dentro del archivo y
   contra la tienda. Carga solo los productos existentes con esos SKU/códigos (en lotes). No guarda nada.
2. **Existentes:** casilla "Update existing products" por importación (decisión del usuario). Apagada → un
   SKU existente es error. Encendida → actualiza nombre, código, categoría, precio y umbral; **una celda
   opcional vacía conserva el valor actual** (un archivo corto no borra datos) y el stock se **suma**.
3. **Confirmación** (`confirmImportAction`): el navegador reenvía el mismo `File`; el servidor comprueba
   su SHA-256 contra el de la vista previa, **revalida contra la BD actual** y llama
   `public.import_products` con las filas válidas.
4. **`import_products`** (definer, una transacción): owner/admin, ≤ 2.000 filas, revalida cada fila, crea
   o actualiza por SKU, junta el stock inicial en **una entrada de mercancía** `source = 'import'` vía
   `app.receive_stock` (la misma lógica de `create_stock_entry`: promedio ponderado y libro de
   movimientos) e inserta `import_batches` (archivo, quién, creadas/actualizadas/omitidas). Si algo falla,
   no se guarda nada.
5. **Reporte de errores:** CSV generado en el navegador con las filas rechazadas, sus valores y motivos.

`import_batches`: lectura solo owner/admin; sin escritura desde la API; su trigger escribe en el historial
("Product import “archivo” created — created: N, updated: N, skipped: N").

## 4d. Punto de venta e historial de ventas (implementado en la Fase 6)

**Rutas:** `/app/pos` (todos los miembros) y `/app/sales`, `/app/sales/[id]` (todos; utilidad solo
owner/admin). En la navegación, "POS" y "Sales".

### Flujo de venta
1. **Escaneo:** el campo "Scan or search" está enfocado al cargar. Enter busca el código o SKU **exacto**
   (`lookupForSale`, solo productos activos y sin costo); el campo se vacía en el mismo Enter (escaneos
   seguidos no se pisan). Protecciones: si nada editable tiene el foco, lo que se teclea va al campo de
   escaneo; Enter en cantidad/descuento devuelve el foco al escaneo; si un lector escribe un código en un
   campo de cantidad (6+ dígitos + Enter) se trata como escaneo y la cantidad no cambia.
2. **Carrito** (`src/features/pos/calc.ts`, centavos, mismas fórmulas que `create_sale`): cantidades,
   descuento por renglón y de venta en **% o monto** (el % se convierte a monto en el navegador; la BD
   recibe montos y valida que no superen lo que descuentan), impuesto incluido o añadido, aviso si la
   cantidad supera el stock conocido. Es solo una vista previa: la BD recalcula con sus precios.
3. **Límite de descuento del cajero:** `stores.max_cashier_discount_pct` (10 % por defecto, editable por
   owner/admin en Settings). `create_sale` rechaza (`discount_limit_exceeded`) si un **cajero** descuenta
   en total (renglones + venta) más de ese % del importe bruto. Owner/admin sin límite. La UI lo anticipa
   y deshabilita "Charge".
4. **Cobro:** `<dialog>` nativo (atrapa el foco, Esc cierra). Varias líneas de pago (efectivo, tarjeta,
   transferencia); "Cash received" calcula el cambio. "Complete sale" solo se habilita si los pagos suman
   **exactamente** el total y el efectivo entregado alcanza.
5. **Idempotencia en el cliente:** la clave se genera al abrir el cobro y se guarda con el carrito en
   `sessionStorage`; cambiar el carrito la descarta. Doble clic (además, un `ref` bloquea el segundo envío),
   reintentos tras un error de red o una recarga durante el cobro reutilizan la clave, y `create_sale`
   devuelve la venta existente. El carrito vive en `sessionStorage`, así que la terminal se monta solo en
   el navegador (`useSyncExternalStore`) para evitar errores de hidratación.
6. **Errores** con el carrito intacto: `insufficient_stock` nombra el producto y lo resalta,
   `discount_limit_exceeded`, `payments_mismatch` (los precios cambiaron), producto inactivo.
7. **Venta completada:** número, total, pagos, efectivo recibido y cambio; "New sale" con Enter.

### Atajos de teclado
`F2` escanear · `F4` cliente · `F8` cobrar · `F9` completar el pago · `Esc` volver al carrito ·
`Alt+Shift+Backspace` vaciar la venta · `Enter` nueva venta (tras completar). Se evitan F1, F5, F11 y F12
porque los usa el navegador.

### Historial y utilidad
- Lista con búsqueda por número, desde/hasta (zona de la tienda), método de pago (embed
  `sale_payments!inner` filtrado) y cajero; paginación.
- **Utilidad = (total − impuesto) − Σ(cantidad × costo copiado en `sale_item_costs`)**. Solo se pide a la
  BD para owner/admin; para un cajero, RLS devolvería vacío igualmente (probado). Desde la Fase 7 se
  ajusta con las devoluciones (ver 4e).

### Concurrencia (probada)
Dos sesiones distintas (owner y cajero) venden a la vez el último artículo de 10 productos (20 peticiones
simultáneas, cada una en su propia conexión de PostgREST): siempre gana exactamente una por producto, la
otra recibe `insufficient_stock`, el stock queda en 0 y `stock = Σ movimientos`. 5 envíos paralelos con la
misma clave registran una sola venta.

## 4e. Tickets PDF, devoluciones y clientes (implementado en la Fase 7)

### Tickets PDF de 80 mm — librería: pdfkit 0.20.2
Mantenida, sin dependencias nativas, genera en el servidor (Node) y trae las 14 fuentes estándar de PDF
(no hay que descargar fuentes). Descartadas: `pdf-lib` (sin mantenimiento desde 2022), jsPDF (orientada
al navegador, pesada), `@react-pdf/renderer` (usa pdfkit por debajo y suma React). Va en
`serverExternalPackages` (no se empaqueta) y sus métricas de fuentes (`pdfkit/js/data/*.afm`) se añaden
al build standalone con `outputFileTracingIncludes`, porque pdfkit las lee con `fs` y el trazado no las ve.

- **Tres capas** en `src/features/receipts/`: `receipt-data.ts` copia de la venta **solo** los campos
  imprimibles (los tipos `SaleReceiptData`/`ReturnReceiptData` no tienen costo ni utilidad, así que no se
  pueden filtrar por error); `layout.ts` convierte eso en líneas de texto de 42 columnas (puro, probado con
  Vitest); `pdf.ts` dibuja las líneas con Courier 8 pt en una página de **80 mm (226.77 pt)** de ancho,
  márgenes de 4 mm y alto ajustado al contenido (rollo térmico).
- **Ticket de venta:** tienda, número, fecha y hora en la zona de la tienda, cajero, cliente, renglones
  (cantidad × precio, descuento), subtotal, descuentos, impuesto (incluido o añadido), total, pagos,
  efectivo recibido, cambio, pie configurable y, al reimprimir, sección **RETURNS** con el total neto.
- **Comprobante de devolución** aparte: venta original, quién, renglones devueltos (y si volvieron al
  stock), motivo, reembolso y método.
- **Route Handlers** `GET /app/sales/[id]/receipt` y `/app/sales/[id]/returns/[returnId]/receipt`: sesión
  + tienda activa + RLS (401/404). `?download=1` → `attachment`; sin él, `inline` para imprimir desde el
  visor del navegador. `Cache-Control: private, no-store`.

### Devoluciones
- Solo **owner/admin** (Server Action con `requireRole` + `create_return` comprueba el rol en la BD). Desde
  el detalle de la venta: cantidad por renglón (máx. vendido − devuelto), casilla **"Return to stock"**
  (marcada por defecto), motivo y método de reembolso, con vista previa del reembolso.
- **Reembolso proporcional** (`create_return`, replicado en `src/features/returns/calc.ts` para la vista
  previa): `round(total × total_renglón × cantidad / (vendidas × subtotal))`, es decir, la parte del
  renglón en lo que el cliente pagó (descuentos e impuesto incluidos). Cuando la devolución completa la
  venta, se reembolsa **exactamente lo que falta**, para que la suma de reembolsos sea el total sin
  centavos perdidos por redondeo.
- **Merma:** con la casilla desmarcada se reembolsa pero **no** sube el stock ni se crea movimiento
  (`return_items.restocked = false`); el costo de esa unidad sigue contando como pérdida.
- La venta pasa a `partially_returned` o `returned`; el historial lo muestra. El ledger `stock_movements`
  registra cada reposición (`stock = Σ movimientos`, probado).
- **Utilidad tras devoluciones** (`src/features/sales/profit.ts`):
  `(total − impuesto) × (total − reembolsado) / total − (Σ costo vendido − Σ costo de lo repuesto)`.

### Clientes
- `/app/customers` (búsqueda por nombre, teléfono, correo o documento; paginación), `/new` y `/[id]`
  (datos editables, compras con sus devoluciones, total gastado **neto de reembolsos**, última compra).
- Crear y editar: todos los miembros. **Borrar: solo owner/admin** vía `delete_customer` (definer): sin
  ventas se borra; **con ventas se archiva** (`deleted_at`) para no romper el historial. El cajero no puede
  escribir `deleted_at` (sin grant de columna). Los archivados no aparecen en listas ni búsquedas del POS
  y `create_sale` los rechaza.
- POS: "+ New customer" abre un `<dialog>` rápido (nombre, teléfono, correo) que crea y selecciona al
  cliente sin perder la venta; mientras está abierto, los atajos globales se desactivan.

## 4f. Dashboard, reportes y exportación a Excel (implementado en la Fase 8)

**Rutas:**
- `/app`: dashboard según el rol.
- `/app/reports`: solo owner/admin; cualquier otro rol recibe el 404 suave de `requireRole`.
- `/app/reports/export`: solo owner/admin; cualquier otro rol recibe un 404 real.

### Los cálculos viven en la base de datos
Migración `*_reports.sql`.

**Funciones (todas `SECURITY INVOKER`, `search_path = ''`, sin EXECUTE para `anon`):**
- Bloques internos en el schema `app`, que la API no expone:
  - `app.sale_facts`: una fila por venta, con su costo;
  - `app.return_facts`: reembolso, su parte de impuesto, costo repuesto y merma;
  - `app.product_facts`: unidades e ingresos por producto.
- Funciones públicas: `report_summary`, `report_timeseries` (día o mes, rellena huecos), `report_products`,
  `report_categories`, `report_payment_methods`, `report_cashiers`, `report_sales_export`,
  `report_sale_lines_export` y `dashboard_today`.

**Por qué INVOKER:** la función corre con los permisos de quien llama, así que **RLS se aplica a cada tabla**
que lee. Otra tienda es invisible sin filtros manuales que puedan olvidarse. Una función DEFINER se saltaría
RLS.

**La utilidad tiene dos capas de protección:**
1. Toda función con costos empieza con `app.is_store_manager()` y lanza `forbidden`. Si un cajero la llama
   directamente por PostgREST, recibe un **error**, nunca un número.
2. Aunque faltara ese chequeo, RLS le oculta `sale_item_costs` (el resultado sería erróneo, pero no se
   filtraría ningún costo). pgTAP prueba ambas capas.

El servidor vuelve a comprobar el rol antes de llamar (`src/features/reports/service.ts`), y
`dashboard_today` no tiene ninguna columna de costo.

**Periodos:**
- `[from, to)` en UTC; los calcula el servidor desde fechas locales de la tienda (`ranges.ts`).
- La agrupación por día o mes usa `created_at at time zone stores.timezone`, así que los días de 23 y 25
  horas salen bien (probado).
- **Las devoluciones cuentan en la fecha de la devolución**: los periodos cerrados no cambian. Sobre todo el
  historial, el total coincide con la utilidad por venta de la fase 7.

**Fórmulas:**
- **Utilidad bruta** = Σ(total − impuesto) − costo vendido − Σ(reembolso − su parte de impuesto) + costo de
  lo repuesto. La merma no se suma de vuelta: sigue siendo pérdida, y se muestra aparte.
- **Ventas netas** = ventas brutas − reembolsos.
- **Por método de pago** = cobrado − reembolsado con ese método. Su suma es igual a las ventas netas.

**Comparaciones del dashboard (`periodWindow`):** comparan el mismo tiempo transcurrido, según el reloj
local. Por ejemplo, 1–5 nov 15:00 contra 1–5 oct 15:00, y hoy contra ayer a la misma hora, aunque ayer
tuviera 23 horas. Si el mes anterior es más corto, se usa completo. La semana empieza el lunes.

### Rendimiento: RLS que se evalúa una vez por consulta
Medido con 50 000 ventas sintéticas y 100 000 renglones, en una transacción descartada:

| Consulta (como owner, con RLS) | Antes | Después |
| --- | --- | --- |
| `report_summary`, 30 días | 1,08 s | 46 ms |
| `report_summary`, 365 días | 13,7 s | 0,52 s |
| `report_timeseries`, 365 días por mes | 13,3 s | 0,52 s |
| `report_products`, 365 días | 1,9 s | 0,25 s |
| `report_sales_export`, 30 días | 1,2 s | 0,13 s |
| `dashboard_today` | 2,5 ms | 1,2 ms |

**La causa:** las políticas SELECT llamaban `app.is_store_member(store_id)` **por fila**. Esas funciones
son DEFINER, porque tienen que leer `store_members`, y Postgres no puede integrarlas en la consulta. La misma
consulta sin RLS tardaba 0,6 s.

**La solución** (migración `*_rls_read_performance.sql`): `store_id in (select app.member_store_ids())`
(o `managed_store_ids()` para costos, entradas, movimientos e historial).
- La subconsulta no depende de la fila, así que Postgres la ejecuta **una vez** y cada fila solo se compara
  contra una tabla hash.
- El significado es el mismo y pasan las 310 pruebas de pgTAP.
- Las políticas de escritura no cambian, porque tocan una fila a la vez.

**Índices:**
- Ya existían `(store_id, created_at)` en ventas, devoluciones y pagos, y `sale_items(sale_id)`,
  `return_items(return_id)` y la PK de `sale_item_costs`.
- Se añadió `sales(store_id, cashier_id, created_at)` para "mis ventas de hoy" y el reporte por cajero.

### Gráficas: SVG propio, sin librería
Son pocas y simples (columnas por día o mes y barras horizontales), y se renderizan en el servidor.
- **Sin librería:** 0 KB de JS en el cliente. Recharts o Chart.js añadirían más de 100 KB y obligarían a usar
  componentes de cliente.
- **La geometría es pura y está probada** (`chart-data.ts`): escala "bonita", columnas de 24 px como máximo
  con la punta redondeada y la base recta, 2 px entre barras, y etiquetas espaciadas.
- **El texto es HTML** (ejes y etiquetas), así que no se encoge en el móvil. El SVG solo dibuja barras y
  líneas de guía.
- **Accesibilidad:** cada gráfica es un `<figure>` con `role="img"` y un nombre que resume los datos.
  Incluye una tabla equivalente ("Show data table") y un tooltip por barra (`<title>`, con un área de clic
  mayor que la barra). En las tarjetas, la variación se indica con flecha y texto, nunca solo con color.
- **Color:** una sola serie, `--viz-series-1`. Se validó con los chequeos de paleta (contraste ≥ 3:1)
  contra la tarjeta clara y la oscura.

### Exportación a Excel
`src/features/reports/export.ts` usa SheetJS vendorizado y genera tres hojas:
- **Summary:** totales del rango y notas.
- **Sales:** una fila por venta, con lo reembolsado a la fecha, el neto, los métodos de pago, el costo y la
  utilidad tras devoluciones.
- **Items:** renglones con unidades devueltas y mermadas, y el costo unitario.

El archivo es solo para managers, por eso incluye costos.

**Detalles:**
- Las fechas son celdas de fecha con la hora local de la tienda.
- Los números son celdas numéricas.
- **El texto nunca es fórmula**: siempre es una celda de tipo `s`. Además, el texto que empieza por
  `= + - @` (o tabulador o retorno de carro) lleva un apóstrofo delante. Es el mismo helper que usa el CSV de
  la fase 5 (`src/lib/spreadsheet-safe.ts`).
- Se lee de 1000 en 1000 filas (`max_rows` de PostgREST), con un tope de 50 000 ventas por archivo.

### Datos de demo
El seed genera 60 días de historia de forma determinista (`setseed`):
- **Ventas:** de 3 a 9 por día, con más los fines de semana, en horario de apertura. Las hacen los tres
  usuarios demo, con clientes, descuentos dentro del límite del cajero y pagos en efectivo, tarjeta,
  transferencia o mixtos.
- **Devoluciones:** 11, de las cuales 3 son merma.

Todo pasa por `create_sale` y `create_return` en orden cronológico; después el seed mueve los `created_at`
al pasado. Para hacerlo desactiva un momento los triggers de esas tablas: corre en local y es dueño de las
tablas.

El stock de apertura se calcula para que el **stock de hoy sea el mismo de antes**: los productos con stock
bajo siguen bajos y las pruebas E2E no cambian.

## 4g. Landing con GSAP (implementado en la Fase 10)

**Ruta `/`:** es un Server Component estático (`○` en el build). Todo el texto, los encabezados y los
enlaces llegan en el HTML. Solo hay unas pocas **islas cliente**:
- `HeroDemo`, el POS vivo;
- `ScrollReveals`, invisible, anima los bloques `[data-reveal-group]`;
- las ilustraciones `*Art` y `SecurityArt`.

Interfaz en inglés y datos **de ejemplo** rotulados como tales. No hay testimonios, logos ni cifras
inventadas presentadas como reales.

**Licencia de GSAP 3.15.0** (verificada en gsap.com/standard-license): la "Standard no-charge license"
cubre el uso comercial y **todos los plugins** (ScrollTrigger y SplitText incluidos). Solo prohíbe usar
GSAP en herramientas visuales de animación que compitan con Webflow, y no pide atribución. Stocktill
(un POS) puede usarlo. `@gsap/react` 2.1.2 aporta el hook `useGSAP`. Ambos están fijados a versión
exacta.

### Animaciones
**Limpieza:**
- `useGSAP` crea un `gsap.context`, así que al desmontar se revierten tweens, timelines, ScrollTriggers
  y SplitText.
- `gsap.matchMedia()` con `(prefers-reduced-motion: no-preference)`: con *reduce* no se crea nada y, si
  la preferencia cambia en vivo, se revierte solo.

**Hero:**
- Un **timeline** con `repeat: -1` dirige el ritmo (teclea el código, barre el láser, pulsa "Charge") y
  avanza con `.call()` el reducer puro `demo-cart.ts`, probado.
- Cada elemento que React monta (renglón, nota de pago, tarjeta del dashboard) se anima a sí mismo con
  su propio `useGSAP`.
- Los números se animan con *proxy tweens*.
- Se pausa fuera de pantalla con un IntersectionObserver.

**Secciones:**
- `ScrollTrigger` (con `once`, `scrub`, `toggleActions` y `pin`) y `SplitText` (por líneas, con
  máscara y `aria` automático).
- La sección de seguridad se fija con `pin` y avanza con `scrub` solo en escritorio.
- El texto informativo se anima con `opacity`, nunca con `visibility: hidden`, así que siempre se puede
  leer con lector de pantalla.

### Rendimiento
Medido con Lighthouse 13.5 en móvil sobre el build de producción. La puntuación de rendimiento pasó de
74 a una mediana de 96 (escritorio: 100) con estos cambios:
1. **Configurar cada sección al acercarse** (`useNearViewport`): crear ScrollTriggers y dividir el texto
   mide el layout, y hacerlo todo en la carga generaba tareas largas.
2. **Una sola isla para las animaciones de scroll** en lugar de envolver el texto en componentes
   cliente: así hay menos que hidratar.
3. **ScrollTrigger y SplitText con `import()` dinámico** cuando hacen falta (en tiempo idle o al
   acercarse una sección). Solo el núcleo de GSAP carga con la página, y con reduced motion los plugins
   ni se descargan.
4. **Geist Mono sin precarga** y Geist Sans explícita en la landing.

### SEO
- Metadatos con canonical, Open Graph y Twitter, y `metadataBase` desde `NEXT_PUBLIC_SITE_URL`.
- `opengraph-image.tsx` (`next/og`, 1200×630) se genera en el build.
- `sitemap.ts` y `robots.ts`: `/app`, `/api`, `/auth`, `/invite` y `/onboarding` quedan fuera del
  índice. El proxy de sesión no se ejecuta para esas rutas.

## 5. Estructura de carpetas (propuesta)

```
.
├── CLAUDE.md
├── docs/                      # DESIGN.md, PHASES.md
├── src/
│   ├── app/
│   │   ├── (marketing)/       # landing GSAP, precios
│   │   ├── (auth)/            # login, registro, aceptar invitación
│   │   ├── (app)/             # área privada: pos, inventory, sales, customers, reports, settings
│   │   └── api/               # stripe/webhook, tickets/[id], exports/...
│   ├── features/              # lógica por dominio (inventory, pos, sales, customers, reports, import, billing)
│   │   └── <feature>/         # actions.ts, queries.ts, schemas.ts, components/
│   ├── components/ui/         # componentes reutilizables
│   └── lib/
│       ├── supabase/          # clientes server/browser/middleware
│       ├── auth/              # sesión, tienda activa, guards de rol
│       ├── stripe/
│       ├── money.ts           # aritmética de dinero sin floats
│       └── validation/
├── db/
│   └── schema/                # esquema Drizzle (TS)
├── supabase/
│   ├── config.toml
│   ├── migrations/            # SQL generado por Drizzle + SQL de RLS/funciones
│   └── seed.sql
├── tests/
│   ├── unit/                  # Vitest
│   ├── db/                    # Vitest contra Supabase local (RLS, funciones)
│   └── e2e/                   # Playwright
├── docker/                    # archivos auxiliares
├── Dockerfile
├── compose.yaml
├── .env.example
└── .github/workflows/ci.yml
```

*Por qué `features/`:* agrupar por dominio (no por tipo de archivo) mantiene juntas las acciones,
consultas y validaciones de cada módulo, y escala mejor que carpetas gigantes de `components/`.

## 6. Plan de pruebas

| Nivel | Herramienta | Qué cubre |
|---|---|---|
| Unitarias | Vitest | Cálculo de totales/descuentos/impuestos (precios con impuesto incluido y sin incluir, redondeo), utilidades de dinero, esquemas Zod, parser y validador del Excel, buffer del lector de código de barras |
| Base de datos | **pgTAP** (`npm run test:db` = `supabase test db`), en `supabase/tests/database/` | Estructura (RLS en todas las tablas, privilegios, `search_path` de funciones definer), **aislamiento** A/B en lectura/escritura/RPC, **roles**, **stock** (sin escritura directa, sin negativos, sin sobreventa, `stock = Σ movimientos`), funciones (impuestos, idempotencia, promedio ponderado, devoluciones), historial inmutable y tablas de Stripe |
| Integración | Vitest (`npm run test:integration`) contra Supabase local | Inician sesión como los usuarios demo con la publishable key (leída en tiempo de ejecución de `supabase status`, nunca impresa) y llaman a las mismas *services* que las Server Actions: permisos por rol, invitación de ida y vuelta, entrega del correo en Mailpit |
| E2E | **Playwright** (adelantado de la Fase 11, `npm run test:e2e`) | Chromium real contra el **build de producción standalone** (`npm run build && npm start`, igual que la imagen Docker): registro → confirmación leyendo Mailpit → crear tienda → invitar → aceptar con otro usuario → cambiar rol; comprueba la navegación por rol, la pantalla 404 de páginas de managers y el login con contraseña |
| Concurrencia | Vitest + `postgres` contra Supabase local (Fase 6) | Dos ventas simultáneas del último artículo; reintentos con la misma clave de idempotencia |
| Integración | Vitest | Server Actions con usuarios de prueba; webhook de Stripe con payloads firmados de prueba (`stripe.webhooks.generateTestHeaderString`) |
| Navegador | Playwright | Registro + crear tienda, invitar cajero, venta con "lector" simulado (tecleo rápido + Enter), devolución, importación Excel, restricción de páginas por rol |

- Los usuarios y datos de prueba los crean los propios tests/seeds (registro vía Auth local). No se
  usan tokens fabricados con secretos.
- **Por qué pgTAP:** las pruebas corren dentro de Postgres, cada archivo en una transacción que se
  revierte (no ensucian la BD), y pueden actuar como un usuario igual que PostgREST
  (`set role authenticated` + `request.jwt.claims`) sin claves ni tokens. Los usuarios y tiendas los crea
  cada prueba (`supabase/tests/database/_helpers.psql`).
- **CI (GitHub Actions):** job `checks` (`lint` → `typecheck` → `test` → `build`) y job `database`
  (`supabase start` solo con Postgres → `db:check` → sin deriva esquema/migraciones → `test:db` →
  `db:lint`); `test:e2e` se añade en la Fase 11. Con protección de rama en `main` (configurada por el usuario en
  GitHub) para que no se pueda fusionar si falla.

## 7. Despliegue con Docker en Railway

1. **Dockerfile multi-stage** (npm):
   - `deps`: `node:24-slim`, `npm ci`.
   - `build`: copia código, `next build` con `output: 'standalone'`.
   - `runner`: `node:24-slim`, solo `.next/standalone`, `.next/static` y `public`; usuario no root;
     `HEALTHCHECK`; `CMD ["node", "server.js"]`.

   *Por qué multi-stage + standalone:* la imagen final no lleva herramientas de build ni
   `node_modules` completos → más pequeña (~150–250 MB), arranca más rápido y tiene menos superficie
   de ataque.
2. **Variables públicas en build:** `NEXT_PUBLIC_*` se incrustan al construir, así que Railway debe
   pasarlas como build args.
3. **Railway:** servicio conectado al repo de GitHub, construye con el Dockerfile, variables de entorno
   configuradas en el panel (el usuario las introduce), dominio `*.up.railway.app`, healthcheck en
   `/api/health`.
4. **Base de datos:** Supabase Cloud, **plan gratuito**. Migraciones con `supabase db push` (paso manual
   o job de CI con aprobación). El README advertirá que los proyectos gratuitos inactivos se pausan y
   cómo reactivarlos desde el panel de Supabase.
5. **Stripe:** endpoint de webhook apuntando a `https://<dominio>/api/stripe/webhook` en modo prueba.

## 8. Suscripción (Stripe, modo prueba) — implementado en la Fase 9

- **Un solo plan:** *Stocktill Monthly*, **19 USD/mes**, con **14 días de prueba gratis**
  (`subscription_data.trial_period_days = 14` en Checkout). La prueba solo se da la primera vez, cuando la
  tienda nunca tuvo una suscripción en Stripe.
- El producto y el precio los crea el usuario con `scripts/stripe-setup.mjs`, de forma idempotente
  (`lookup_key`). El ID del precio llega por `STRIPE_PRICE_ID` y nunca se escribe en el código.
- **Solo el owner** ve `/app/billing` (`requireRole(["owner"])`; admin y cajero reciben 404). Desde ahí
  inicia **Checkout** y abre el **Billing Portal** (tarjeta, cancelación, facturas), ambos alojados en
  Stripe.
- Guía para el usuario: `docs/STRIPE.md`.
- **SDK `stripe` 23.1.0**, con `apiVersion` fijada en `2026-10-28.endive`. Desde la versión `basil`,
  `current_period_end` vive en los items de la suscripción.
- Las claves `sk_live_` se rechazan. Sin claves (CI), Billing lo indica y todo lo demás funciona.

### Acceso según el estado (`app.store_access`)
| Estado | Acceso | Qué se puede hacer |
| --- | --- | --- |
| sin suscripción, `incomplete` | `setup` | Productos, stock, importación, clientes, equipo y ajustes. **No** se vende ni se devuelve. |
| `trialing`, `active` | `full` | Todo. |
| `past_due` | `full` | Todo, con un aviso para actualizar la tarjeta (Stripe reintenta el cobro). |
| `canceled`, `unpaid`, `incomplete_expired`, `paused` | `read_only` | Ver datos, reportes y exportaciones; Billing, Settings y Team. Se bloquean ventas, devoluciones, entradas, importación, productos y clientes. |

**Dónde se aplica:**
- **En la base de datos:** con triggers `BEFORE INSERT/UPDATE/DELETE`. `sales` y `returns` exigen `full`;
  `products`, `product_costs`, `stock_entries`, `import_batches` y `customers` exigen `full` o `setup`.
  Usar triggers cubre **todos** los caminos de escritura (las funciones DEFINER como `create_sale` y los
  INSERT/UPDATE con RLS) sin reescribir esas funciones. Solo aplican a usuarios con sesión
  (`auth.uid()`): el webhook y el seed no son usuarios.
- **En el servidor:** `checkAccess` (`src/features/billing/service.ts`) en cada servicio de escritura, que
  devuelve un mensaje claro.
- **En la interfaz:** banner global, la caja cerrada y sin formulario de devolución.

La demo usa suscripciones del seed no vinculadas a Stripe (`stripe_customer_id` nulo): la tienda demo está
`active` y Other Shop `trialing`.

### Webhook (`POST /api/stripe/webhook`)
**Pasos:**
1. Verifica la firma `Stripe-Signature` (HMAC del timestamp y el cuerpo crudo, con 5 minutos de
   tolerancia) usando `STRIPE_WEBHOOK_SECRET`. Si falta o no es válida responde **400** y no escribe nada.
2. `toChange(event)` (pura) traduce el evento en un cambio de la suscripción de la tienda. La tienda viene
   de `client_reference_id` o de `metadata.store_id`, que se fija en la sesión **y** en la suscripción.
3. `apply_stripe_event` (SQL, solo `service_role`) registra y aplica el evento **en una sola
   transacción**:
   - el `id` del evento es la clave de idempotencia: un evento repetido devuelve `duplicate` y no se
     aplica;
   - un evento más viejo que el último aplicado (`last_event_at`, comparado con `event.created`) devuelve
     `stale`;
   - una tienda desconocida devuelve `ignored`.
   - Si algo falla, no queda registrado: la ruta responde 500 y Stripe reintenta.

**Eventos que procesa:**

| Evento | Para qué |
| --- | --- |
| `checkout.session.completed` | Vincula tienda, customer y suscripción. No trae estado, así que no adelanta `last_event_at`. |
| `customer.subscription.created` / `.updated` / `.deleted` | Fuente de verdad: estado, fin de la prueba, fin del periodo, cancelación al final del periodo. Con `deleted` queda `canceled`. |
| `invoice.payment_failed` | `past_due` al instante (el aviso aparece aunque `subscription.updated` llegue después). |
| `customer.subscription.trial_will_end` | Se registra; todavía no hay correos. |

Cualquier otro evento responde 200 y se ignora. No hay llamadas a la API de Stripe dentro del webhook, así
que se puede probar sin red.

**Clave secreta de Supabase:** la ruta del webhook es **el único lugar** que la usa
(`src/lib/supabase/admin.ts`). Una regla de ESLint (`no-restricted-imports`) impide importarla en
cualquier otro archivo.

## 9. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Fuga entre tiendas por una política RLS olvidada | Prueba automática que lista todas las tablas de `public` y falla si alguna no tiene RLS; pruebas de aislamiento por tabla |
| Uso indebido de la service role | Cliente admin en un módulo `server-only`, usado solo en webhook/seeds; revisión en cada fase |
| Cajero ve costos | Tablas separadas para costos + pruebas de rol |
| Ventas concurrentes / doble clic | Funciones transaccionales, bloqueo de fila, `CHECK`, idempotencia |
| Webhooks duplicados o desordenados | Tabla `stripe_events`; al procesar, releer la suscripción desde la API de Stripe |
| Drizzle y RLS/funciones (Drizzle no modela todo) | SQL manual en migraciones personalizadas; pruebas de BD en CI |
| Precisión del dinero | `numeric` en BD y enteros (centavos) o librería decimal en TS |
| Impresión térmica 80 mm (márgenes, fuentes) | PDF de ancho fijo 80 mm (~72 mm útiles), prueba en impresora real o emulador; opción de imprimir HTML |
| Lectores de código de barras (tecleo rápido + Enter, foco) | Captura global con buffer y umbral de tiempo entre teclas; pruebas unitarias |
| Excel grande o malformado | Límite de tamaño/filas, validación por fila, vista previa antes de confirmar, inserción en una transacción |
| Supabase Cloud gratuito pausa proyectos inactivos (la demo deja de responder) | Aviso en el README con pasos para reactivarlo; seed de demo reproducible |
| Créditos limitados de Railway | Documentarlo en el README; imagen pequeña y una sola instancia |
| Redondeo de impuestos incluidos | Funciones de dinero con pruebas unitarias; redondeo a 2 decimales en un solo lugar |
| WSL + Docker: memoria y rendimiento | Ajustar `.wslconfig`; código dentro del filesystem de Linux (ya está en `~/proyectos`) |
| Variables `NEXT_PUBLIC_*` fijadas en build | Build args en Railway; documentarlo |
