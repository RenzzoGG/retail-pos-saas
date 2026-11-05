# Diseño técnico — POS SaaS multitienda

> Estado: propuesta de la Fase 0. Las decisiones marcadas como **[pendiente]** se confirman antes de la Fase 1.

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
| Supabase | Supabase CLI (`supabase start`, levanta sus propios contenedores) | Proyecto Supabase cloud |
| Stripe | Modo prueba + `stripe listen` para reenviar webhooks | Modo prueba, webhook al dominio de Railway |

*Por qué Supabase CLI y no meter Supabase en nuestro Compose:* el CLI ya orquesta ~10 servicios
(Postgres, GoTrue, PostgREST, Storage, Studio...) con versiones probadas entre sí; replicarlo a mano en
Compose es frágil. Compose se usa para la app (y servicios auxiliares si hacen falta). **[pendiente]**

### Acceso a datos — recomendación **[pendiente]**
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

## 2. Modelo de datos

Convenciones: PK `id uuid default gen_random_uuid()`, `created_at`/`updated_at timestamptz`,
dinero en `numeric(12,2)`, cantidades en `integer` (o `numeric(12,3)` si se venden productos a granel
**[pendiente]**). Todas las tablas de negocio llevan `store_id` (clave del aislamiento).

### Identidad y tiendas
| Tabla | Columnas principales | Notas |
|---|---|---|
| `stores` | id, name, slug, currency, tax_rate, ticket_footer, created_by | Una por negocio |
| `profiles` | id (= `auth.users.id`), full_name, avatar_url | Datos públicos del usuario |
| `store_members` | store_id → stores, user_id → auth.users, role (`owner`\|`admin`\|`cashier`), active | Único (store_id, user_id). Un usuario puede pertenecer a varias tiendas |
| `invitations` | store_id, email, role, token_hash, expires_at, accepted_at, invited_by | El token se guarda hasheado |

### Inventario
| Tabla | Columnas principales | Notas |
|---|---|---|
| `products` | store_id, sku, barcode, name, category, sale_price, stock, low_stock_threshold, active, deleted_at | Únicos parciales (store_id, sku) y (store_id, barcode) donde `deleted_at is null`. `CHECK (stock >= 0)` |
| `product_costs` | product_id (PK) → products, store_id, cost_price | Separada para que el cajero no la vea |
| `stock_entries` | store_id, supplier, note, created_by | Entrada de mercancía (cabecera) |
| `stock_entry_items` | entry_id, product_id, quantity, unit_cost | Actualiza stock y costo |
| `stock_movements` | store_id, product_id, type (`sale`\|`return`\|`entry`), quantity (±), ref_table, ref_id, created_by | Libro mayor: la suma de movimientos = stock actual |
| `import_batches` | store_id, file_path, status, total_rows, error_rows, errors jsonb, created_by | Importación Excel |

### Ventas y clientes
| Tabla | Columnas principales | Notas |
|---|---|---|
| `customers` | store_id, name, document_id, phone, email | Historial = sus `sales` |
| `sales` | store_id, number (consecutivo por tienda), customer_id?, cashier_id, subtotal, discount_total, tax_total, total, status (`completed`\|`partially_returned`\|`returned`), idempotency_key | Único (store_id, idempotency_key) |
| `sale_items` | sale_id, store_id, product_id, product_name, unit_price, quantity, discount, line_total | *Snapshot* del precio: si el producto cambia, la venta no |
| `sale_item_costs` | sale_item_id (PK), store_id, unit_cost | Snapshot del costo para utilidad; oculto al cajero |
| `sale_payments` | sale_id, store_id, method (`cash`\|`card`\|`transfer`), amount, received, change | Permite pago mixto |
| `returns` | store_id, sale_id → sales, reason, refund_total, created_by | Siempre ligada a la venta original |
| `return_items` | return_id, sale_item_id → sale_items, quantity, refund_amount | No puede superar lo vendido − lo ya devuelto |

### Auditoría y suscripción
| Tabla | Columnas principales | Notas |
|---|---|---|
| `activity_log` | store_id, actor_id, table_name, record_id, action (`insert`\|`update`\|`delete`), before jsonb, after jsonb, created_at | Escrita por triggers; solo lectura para owner/admin |
| `subscriptions` | store_id (único), stripe_customer_id, stripe_subscription_id, status, price_id, current_period_end, cancel_at_period_end | Fuente de verdad: webhooks |
| `stripe_events` | id (= event.id de Stripe), type, processed_at | Evita procesar un evento dos veces |

### Relaciones (resumen)
```
auth.users 1─1 profiles
auth.users 1─N store_members N─1 stores
stores 1─N products 1─1 product_costs
stores 1─N sales 1─N sale_items 1─1 sale_item_costs
              sales 1─N sale_payments
              sales 1─N returns 1─N return_items N─1 sale_items
customers 1─N sales
products 1─N stock_movements ; stock_entries 1─N stock_entry_items
stores 1─1 subscriptions ; stores 1─N activity_log
```

## 3. Estrategia de RLS multitienda y roles

1. **RLS activado en todas las tablas** del esquema `public`. Sin política = sin acceso (denegar por defecto).
2. **Funciones auxiliares** (`security definer`, `stable`, `set search_path = ''`):
   - `app.is_store_member(store_id uuid) → boolean`
   - `app.has_store_role(store_id uuid, roles app.store_role[]) → boolean`

   Consultan `store_members` con `auth.uid()`. *Por qué `security definer`:* si la política de
   `store_members` consultara `store_members`, habría recursión infinita; la función la evita y además se
   cachea por consulta (`(select auth.uid())` para rendimiento).
3. **Políticas tipo** (ejemplo `products`):
   - SELECT: `is_store_member(store_id)`
   - INSERT/UPDATE/DELETE: `has_store_role(store_id, '{owner,admin}')`
4. **Matriz de permisos:**

| Recurso | owner | admin | cashier |
|---|---|---|---|
| Productos (ver nombre, precio de venta, stock) | ✅ | ✅ | ✅ |
| Crear/editar productos, cambiar precios | ✅ | ✅ | ❌ |
| Costos y utilidades (`product_costs`, `sale_item_costs`, dashboard de utilidad) | ✅ | ✅ | ❌ |
| Registrar ventas | ✅ | ✅ | ✅ |
| Devoluciones | ✅ | ✅ | ❌ (**[pendiente]** ¿permitir con límite?) |
| Entradas de mercancía / importar Excel | ✅ | ✅ | ❌ |
| Clientes | ✅ | ✅ | ✅ (crear/ver) |
| Historial de actividad | ✅ | ✅ | ❌ |
| Invitar usuarios / cambiar roles | ✅ | ✅ (no puede crear owners) | ❌ |
| Suscripción y facturación | ✅ | ❌ | ❌ |

5. **Columnas sensibles:** RLS filtra *filas*, no *columnas*. Por eso los costos viven en tablas aparte
   con políticas más estrictas, en lugar de depender de ocultarlos en la UI.
6. **Defensa en capas:** (a) la UI oculta lo que no corresponde (comodidad), (b) cada Server Action
   valida sesión, tienda activa y rol (mensajes claros), (c) la BD aplica RLS y valida dentro de las
   funciones (garantía real).
7. **Tienda activa:** el usuario elige tienda; se guarda en cookie y se envía como parámetro. RLS no
   confía en ella: siempre verifica membresía.

## 4. Consistencia del stock

Objetivo: el stock **nunca** queda inconsistente, aunque dos cajeros vendan el último producto a la vez
o el usuario pulse "Cobrar" dos veces.

1. **Nadie actualiza `products.stock` directamente.** Se revoca `UPDATE (stock)` al rol `authenticated`
   y un trigger rechaza cambios de stock fuera de las funciones autorizadas.
2. **Funciones SQL transaccionales** (`security definer`, validan rol y tienda internamente):
   - `create_sale(store_id, items, payments, customer_id, discount, idempotency_key)`
   - `create_return(sale_id, items, reason)`
   - `create_stock_entry(store_id, items, supplier, note)`

   Cada función corre en **una sola transacción**: si algo falla, no se guarda nada.
3. **Descuento atómico con bloqueo de fila:**
   ```sql
   update products set stock = stock - p_qty
   where id = p_product_id and store_id = p_store_id and stock >= p_qty
   returning stock;
   -- si no devuelve fila → raise exception 'insufficient_stock'
   ```
   Postgres bloquea la fila durante el `update`, así que dos ventas simultáneas se serializan.
   Para evitar interbloqueos, los ítems se procesan ordenados por `product_id`.
4. **`CHECK (stock >= 0)`** como red de seguridad (**[pendiente]** confirmar que no se permite negativo).
5. **Libro de movimientos** (`stock_movements`): cada cambio inserta un movimiento. Una prueba verifica
   que `stock = suma de movimientos` (y sirve para auditar).
6. **Idempotencia:** el cliente genera un `idempotency_key` (UUID) por intento de cobro; si se repite,
   la función devuelve la venta existente en vez de crear otra.
7. **Totales calculados en el servidor:** la función recalcula precios desde `products` (no confía en
   precios enviados por el navegador) y valida que la suma de pagos cubra el total.
8. **Devoluciones:** validan `cantidad ≤ vendida − ya devuelta` con bloqueo de la venta original
   (`select ... for update`), reponen stock y actualizan `sales.status`.

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
| Unitarias | Vitest | Cálculo de totales/descuentos/impuestos, utilidades de dinero, esquemas Zod, parser y validador del Excel, buffer del lector de código de barras |
| Base de datos | Vitest + Supabase local | **Aislamiento:** usuario de tienda A no lee/escribe datos de B (cada tabla). **Roles:** cajero no lee costos ni cambia precios. **Stock:** ventas concurrentes del último artículo, idempotencia, devoluciones que exceden lo vendido, `stock = Σ movimientos` |
| Integración | Vitest | Server Actions con usuarios de prueba; webhook de Stripe con payloads firmados de prueba (`stripe.webhooks.generateTestHeaderString`) |
| Navegador | Playwright | Registro + crear tienda, invitar cajero, venta con "lector" simulado (tecleo rápido + Enter), devolución, importación Excel, restricción de páginas por rol |

- Los usuarios y datos de prueba los crean los propios tests/seeds (registro vía Auth local). No se
  usan tokens fabricados con secretos.
- **CI (GitHub Actions):** `lint` → `typecheck` → `test:unit` → `supabase start` + migraciones +
  `test:db` → build → `test:e2e`. Con protección de rama en `main` (configurada por el usuario en
  GitHub) para que no se pueda fusionar si falla.

## 7. Despliegue con Docker en Railway

1. **Dockerfile multi-stage:**
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
4. **Base de datos:** proyecto Supabase cloud (**[pendiente]**). Migraciones con
   `supabase db push` (paso manual o job de CI con aprobación).
5. **Stripe:** endpoint de webhook apuntando a `https://<dominio>/api/stripe/webhook` en modo prueba.

## 8. Riesgos y mitigaciones

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
| Límites de planes gratuitos (Supabase pausa proyectos inactivos, créditos de Railway) | Documentarlo en el README; seed de demo reproducible |
| WSL + Docker: memoria y rendimiento | Ajustar `.wslconfig`; código dentro del filesystem de Linux (ya está en `~/proyectos`) |
| Variables `NEXT_PUBLIC_*` fijadas en build | Build args en Railway; documentarlo |
