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

## Fase 1 — Base del proyecto
**Objetivos:** Next.js (App Router, TS, Tailwind) con **npm**, ESLint/Prettier, Docker Compose solo para
la app, Supabase CLI local (devDependency), Drizzle configurado (solo esquema/migraciones), clientes
supabase-js, Vitest, CI básico en GitHub Actions, `.env.example`, archivo `LICENSE` (MIT).
UI en inglés desde el inicio.
**Terminado cuando:**
- [ ] `LICENSE` MIT presente.
- [ ] `npm run dev` y `docker compose up` sirven la app en `localhost:3000`.
- [ ] `npx supabase start` levanta Supabase local y la app se conecta (página de salud).
- [ ] `drizzle-kit generate` produce una migración en `supabase/migrations`.
- [ ] `npm run lint`, `npm run typecheck` y `npm test` pasan en local y en CI.
- [ ] `.env.example` documenta todas las variables (sin valores reales).

## Fase 2 — Base de datos, migraciones, RLS y seeds
**Objetivos:** esquema completo de `docs/DESIGN.md`, RLS en todas las tablas, funciones auxiliares de
membresía/rol, seeds con dos tiendas y usuarios de prueba, pruebas de aislamiento.
**Terminado cuando:**
- [ ] Seed con una tienda de demo en **USD con precios que incluyen impuesto** y una segunda tienda para pruebas de aislamiento.
- [ ] `CHECK (stock >= 0)` y cantidades `integer` en el esquema.
- [ ] `supabase db reset` aplica migraciones y seeds sin errores.
- [ ] Prueba que falla si alguna tabla de `public` no tiene RLS.
- [ ] Pruebas: usuario de tienda A no puede leer/insertar/editar/borrar datos de B (todas las tablas).
- [ ] Pruebas: cajero no lee costos ni modifica precios.
- [ ] Pruebas de BD corriendo en CI.

## Fase 3 — Autenticación, tiendas, roles e invitaciones
**Objetivos:** registro/login con Supabase Auth, creación de tienda (el creador es owner), selector de
tienda activa, invitaciones por enlace con rol, gestión de miembros, guards de rol en el servidor.
**Terminado cuando:**
- [ ] Registro → crear tienda → entrar al panel funciona de punta a punta.
- [ ] Owner/admin configuran moneda, tasa de impuesto y si los precios incluyen impuesto; el cajero no.
- [ ] Owner/admin invitan; el invitado acepta y queda con el rol correcto; tokens expiran y son de un uso.
- [ ] Rutas y Server Actions rechazan roles no autorizados (pruebas).
- [ ] Middleware refresca la sesión y protege el área privada.

## Fase 4 — Inventario e historial de actividad
**Objetivos:** CRUD de productos (SKU, código de barras, precios, umbral de stock bajo), entradas de
mercancía vía función SQL, alertas de stock bajo, triggers de `activity_log` y vista del historial.
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
- [ ] Pruebas: concurrencia del último artículo, idempotencia ante doble clic, stock insuficiente.
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
- [ ] Playwright cubre registro, invitación, venta con lector simulado, devolución, importación y roles; pasa en CI.
- [ ] `docker build` produce una imagen pequeña que arranca con `docker run` y pasa el healthcheck.
- [ ] App desplegada en Railway y funcionando con datos de demo (el usuario configura variables y hace push).
- [ ] README con descripción, capturas, arquitectura, cómo correrlo en local y decisiones técnicas.
- [ ] README aclara que **Stocktill es una marca ficticia**, advierte que el proyecto gratuito de
      Supabase se pausa por inactividad (y cómo reactivarlo) y menciona la licencia MIT.
