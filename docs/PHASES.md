# Fases del proyecto — Stocktill

> **Stocktill es una marca ficticia** para un proyecto de portafolio.

Cada fase termina con: pruebas en verde (las que existan hasta ese momento), **commit local** (sin push)
y un **REPORTE** (qué se hizo, archivos, comandos y resultados, pruebas, decisiones, dudas/riesgos).

---

## Fase 0 — Planeación ✅ terminada
**Objetivos:** revisar el entorno, definir arquitectura, modelo de datos, estrategia de RLS, stock,
pruebas y despliegue; acordar reglas de trabajo.
**Terminado cuando:**
- [x] Repositorio git inicializado.
- [x] `CLAUDE.md`, `docs/DESIGN.md`, `docs/PHASES.md` y `.gitignore` creados.
- [x] 5 nombres de marca propuestos → elegido **Stocktill**.
- [x] Commit local y REPORTE entregado; preguntas respondidas y decisiones registradas en `CLAUDE.md`.

## Fase 1 — Base del proyecto ✅ terminada (falta solo el primer run de CI en GitHub, tras el push)
**Objetivos:** Next.js (App Router, TS estricto, Tailwind) con **npm**, ESLint, Docker Compose solo para
la app, Supabase CLI local (devDependency), Drizzle configurado (solo esquema/migraciones), clientes
supabase-js, Vitest, CI básico en GitHub Actions, `.env.example`, archivo `LICENSE` (MIT).
UI en inglés desde el inicio. (Prettier no se incluyó; se puede añadir si se desea.)
**Terminado cuando:**
- [x] `LICENSE` MIT presente.
- [x] `npm run dev` y `docker compose up` sirven la app y `/api/health` en `localhost:3000`.
- [x] `npx supabase start` levanta Supabase local y el contenedor de la app alcanza su API.
- [x] `drizzle-kit generate` funciona contra `supabase/migrations` (sin cambios: aún no hay tablas).
- [x] `npm run lint`, `npm run typecheck`, `npm test` y `npm run build` pasan en local y en un clon limpio.
- [ ] El workflow de CI pasa en GitHub (pendiente: GitHub Actions bloqueado temporalmente en la cuenta).
- [x] `.env.example` documenta todas las variables (sin valores reales).

## Fase 2 — Base de datos, migraciones, RLS y seeds ✅ terminada (CI de GitHub pendiente: Actions bloqueado por facturación)
**Objetivos:** esquema completo de `docs/DESIGN.md`, RLS en todas las tablas, funciones auxiliares de
membresía/rol, funciones de stock, historial de actividad, seeds con dos tiendas y usuarios de prueba,
pruebas de aislamiento.
**Terminado cuando:**
- [x] Seed con una tienda de demo en **USD con precios que incluyen impuesto** y una segunda tienda para pruebas de aislamiento.
- [x] `CHECK (stock >= 0)` y cantidades `integer` en el esquema.
- [x] `supabase db reset` aplica migraciones y seeds sin errores.
- [x] Prueba que falla si alguna tabla de `public` no tiene RLS.
- [x] Pruebas: usuario de tienda A no puede leer/insertar/editar/borrar datos de B (todas las tablas).
- [x] Pruebas: cajero no lee costos ni modifica precios (ni configura la tienda, ni devuelve, ni recibe stock).
- [x] Funciones `create_stock_entry`, `create_sale`, `create_return` definidas y probadas.
- [x] Historial de actividad por triggers, inmutable (probado).
- [x] Pruebas de BD en el CI (job `database`), verificado localmente con el mismo flujo.
- [ ] El job `database` pasa en GitHub (cuando Actions vuelva a estar disponible).

Quedan para otras fases: prueba de concurrencia real con dos conexiones (Fase 6), tabla
`import_batches` (Fase 5), funciones `create_store` y `accept_invitation` (Fase 3).

## Fase 3 — Autenticación, tiendas, roles e invitaciones ✅ terminada (CI de GitHub pendiente)
**Objetivos:** registro/login con Supabase Auth (correo y contraseña, confirmación por correo,
recuperación de contraseña), sesión con cookies (`@supabase/ssr`), Proxy + Data Access Layer,
`create_store` y onboarding, selector de tienda activa, invitaciones por correo con `accept_invitation`,
gestión del equipo, configuración de la tienda y layout privado con navegación por rol.
Regla decidida: **solo el owner gestiona admins**; el admin solo invita, cambia y quita cajeros.
**Terminado cuando:**
- [x] Registro → correo en Mailpit → confirmar → crear tienda → entrar al panel funciona de punta a punta.
- [x] Owner/admin configuran moneda, tasa de impuesto y si los precios incluyen impuesto; el cajero no.
- [x] Owner/admin invitan; el invitado acepta y queda con el rol correcto; tokens expiran y son de un uso.
- [x] Rutas y Server Actions rechazan roles no autorizados (pruebas de integración y E2E).
- [x] El Proxy refresca la sesión y protege el área privada.
- [x] pgTAP de `create_store` y `accept_invitation` (vencida, otro correo, ya usada, rol no permitido).
- [x] Playwright adelantado: prueba E2E del flujo completo en Chromium.
- [ ] Jobs de CI pasan en GitHub (Actions bloqueado temporalmente en la cuenta).

## Fase 4 — Inventario e historial de actividad
**Objetivos:** CRUD de productos (SKU, código de barras, precios, umbral de stock bajo), entradas de
mercancía vía `create_stock_entry` (ya existe, Fase 2), alertas de stock bajo y vista del historial
(los triggers de `activity_log` ya existen desde la Fase 2).
**Terminado cuando:**
- [ ] Owner/admin crean, editan y eliminan (soft delete) productos; el cajero solo consulta sin costos.
- [ ] El stock solo cambia por `create_stock_entry` (prueba: UPDATE directo falla).
- [ ] Lista de productos con stock bajo.
- [ ] Cada insert/update/delete queda en `activity_log` con actor, antes y después (pruebas).

## Fase 5 — Importación desde Excel
**Objetivos:** subir `.xlsx`, plantilla descargable, vista previa con validación por fila, reporte de
errores, confirmación que guarda todo en una transacción.
**Terminado cuando:**
- [ ] Vista previa muestra filas válidas/erróneas con motivo (SKU duplicado, precio inválido, etc.).
- [ ] Nada se guarda hasta confirmar; si falla, no se guarda nada.
- [ ] Reporte de errores descargable.
- [ ] Pruebas unitarias del parser/validador y límite de tamaño/filas.

## Fase 6 — Punto de venta
**Objetivos:** pantalla de venta rápida, búsqueda y escaneo con lector USB, carrito, descuentos por
línea y globales, pagos en efectivo/tarjeta/transferencia (y mixtos), cambio, venta vía `create_sale`.
**Terminado cuando:**
- [ ] Escanear un código agrega el producto sin usar el ratón; atajos de teclado para cobrar.
- [ ] Totales calculados en el servidor; el cajero no puede alterar precios.
- [ ] Prueba de concurrencia real (dos conexiones simultáneas, Vitest + `postgres`) del último artículo; idempotencia ante doble clic desde la UI (la lógica en BD ya está probada en la Fase 2).
- [ ] `stock = Σ stock_movements` tras las pruebas.

## Fase 7 — Tickets PDF, devoluciones y clientes
**Objetivos:** ticket PDF de 80 mm (reimprimible), devoluciones parciales/totales ligadas a la venta
original vía `create_return`, CRUD de clientes con historial de compras.
**Terminado cuando:**
- [ ] El PDF tiene ancho de 80 mm y contiene tienda, número, ítems, pagos, cambio y pie configurable.
- [ ] No se puede devolver más de lo vendido menos lo ya devuelto (pruebas); el stock se repone.
- [ ] Solo owner/admin pueden registrar devoluciones; el cajero es rechazado en servidor y BD (pruebas).
- [ ] La ficha del cliente muestra sus compras y devoluciones.

## Fase 8 — Dashboard y reportes
**Objetivos:** ventas diarias y mensuales, utilidad (solo owner/admin), productos más vendidos,
filtros por fecha, exportación de ventas a Excel.
**Terminado cuando:**
- [ ] Gráficas y KPIs coinciden con los datos del seed (pruebas de las consultas).
- [ ] El cajero no ve utilidades (prueba en servidor y BD).
- [ ] Exportación `.xlsx` con el rango filtrado.

## Fase 9 — Stripe
**Objetivos:** un solo plan mensual de **19 USD** en modo prueba con **14 días de prueba gratis**,
Checkout, Billing Portal, webhook con verificación de firma e idempotencia, bloqueo/aviso del área
privada según el estado de la suscripción.
**Terminado cuando:**
- [ ] Al suscribirse, la tienda queda en `trialing` con `trial_end` a 14 días.
- [ ] Flujo completo con tarjeta de prueba `4242…` usando `stripe listen` en local.
- [ ] Eventos duplicados no se procesan dos veces (prueba).
- [ ] Estados `trialing`, `active`, `past_due`, `canceled` se reflejan en la app.

## Fase 10 — Landing con GSAP
**Objetivos:** landing del producto con hero animado que muestra la interfaz del POS, secciones de
funciones y precios, accesible y responsive.
**Terminado cuando:**
- [ ] Animaciones con GSAP (ScrollTrigger) respetan `prefers-reduced-motion`.
- [ ] Lighthouse: rendimiento y accesibilidad ≥ 90 en escritorio.
- [ ] Se ve bien en móvil y escritorio.

## Fase 11 — Playwright, Dockerfile de producción, despliegue y README
**Objetivos:** suite E2E de los flujos clave, Dockerfile multi-stage, despliegue en Railway con Supabase
Cloud (plan gratuito), README de portafolio.
**Terminado cuando:**
- [ ] Playwright (ya instalado en la Fase 3, con el flujo de registro/invitación/roles) cubre además venta con lector simulado, devolución e importación; pasa en CI.
- [ ] `docker build` produce una imagen pequeña que arranca con `docker run` y pasa el healthcheck.
- [ ] App desplegada en Railway y funcionando con datos de demo (el usuario configura variables y hace push).
- [ ] README con descripción, capturas, arquitectura, cómo correrlo en local y decisiones técnicas.
- [ ] README aclara que **Stocktill es una marca ficticia**, advierte que el proyecto gratuito de
      Supabase se pausa por inactividad (y cómo reactivarlo) y menciona la licencia MIT.
