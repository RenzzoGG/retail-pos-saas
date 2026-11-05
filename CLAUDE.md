# CLAUDE.md — Stocktill (POS SaaS multitienda)

> **Stocktill es una marca ficticia** creada para un proyecto de portafolio. No es un producto comercial
> ni está asociada a ninguna empresa real.

## Resumen del proyecto
**Stocktill**: SaaS de punto de venta (POS) e inventario para tiendas pequeñas. Proyecto de portafolio.
Repositorio: `retail-pos-saas` (licencia MIT).
Multitienda: cada negocio se registra y **solo ve sus propios datos** (aislamiento con RLS en PostgreSQL).

Funciones: roles (owner/admin/cashier), inventario con SKU/código de barras y alertas de stock bajo,
importación desde Excel con vista previa, venta rápida compatible con lectores USB, tickets PDF 80 mm,
devoluciones ligadas a la venta, clientes con historial, dashboard y exportación a Excel,
historial de actividad, suscripción con Stripe (modo prueba) y landing animada con GSAP.

Documentación clave:
- `docs/DESIGN.md` — arquitectura, modelo de datos, RLS, stock, pruebas, despliegue y riesgos.
- `docs/PHASES.md` — fases del proyecto con objetivos y criterios de "terminado".

## Stack
- Next.js (App Router) + TypeScript + Tailwind CSS
- Supabase (PostgreSQL, Auth, RLS, Storage) en local con el CLI de Supabase (Docker)
- Drizzle ORM para esquema y migraciones
- Stripe en modo de prueba (suscripción mensual)
- GSAP para la landing
- Docker: Dockerfile multi-stage (producción) y Docker Compose (local)
- Despliegue del contenedor en Railway (no Vercel)
- Pruebas: Vitest (unitarias), Playwright (navegador); CI con GitHub Actions que bloquea si fallan

## Reglas permanentes
1. **Git**: hacer commits locales al terminar cada fase. **NUNCA hacer `git push`**; los push los hace el usuario.
2. **Secretos**: nunca leer, mostrar ni usar secretos de archivos `.env` (claves de Supabase, Stripe,
   contraseñas, tokens). Si se necesita un valor, pedirlo al usuario o usar variables de ejemplo en `.env.example`.
3. **Sin suplantación**: nunca usar secretos para generar tokens ni para hacerse pasar por un usuario.
   Para probar, usar datos y usuarios de prueba creados por los propios tests o seeds.
4. **Trabajo por fases**: al final de cada fase entregar un **REPORTE** con:
   - qué se hizo,
   - archivos creados o modificados,
   - comandos ejecutados y su resultado,
   - pruebas y si pasaron,
   - decisiones tomadas,
   - dudas o riesgos.
5. **Ambigüedad**: si una decisión es ambigua o tiene varias opciones razonables, preguntar antes de seguir.
6. **Aprendizaje**: explicar brevemente el porqué de las decisiones técnicas importantes.

## Decisiones confirmadas (Fase 0)
1. Gestor de paquetes: **npm**.
2. Acceso a datos: **supabase-js** con el usuario autenticado para leer y escribir (RLS siempre aplica);
   **Drizzle solo** para el esquema y las migraciones.
3. **Docker Compose solo para la app**; Supabase corre con su propio CLI.
4. **Interfaz en inglés.** Moneda, tasa de impuesto y si los precios incluyen impuesto se configuran
   **por tienda**. La tienda de demo usa **USD con precios que incluyen impuesto**.
5. **No se permite stock negativo.** Solo **unidades enteras** (sin productos a granel) en esta versión.
6. **Devoluciones: solo owner y admin**; el cajero no.
7. Producción: **Supabase Cloud (plan gratuito)** + Railway. El README debe advertir que los proyectos
   inactivos del plan gratuito se pausan.
8. Stripe (modo prueba): **un solo plan mensual de 19 USD con 14 días de prueba gratis**.
9. Repositorio **`retail-pos-saas`**, licencia **MIT**.
10. Marca: **Stocktill** (ficticia; dejarlo claro en la documentación y el README).

## Convenciones
- Documentación y comunicación en español; **interfaz de usuario en inglés**; código, nombres de tablas y commits en inglés.
- Gestor de paquetes: npm (`npm ci` en CI y Docker).
- Next.js 16 tiene cambios incompatibles con versiones anteriores: antes de escribir código de Next, consultar `node_modules/next/dist/docs/` (ver `AGENTS.md`).
- Verificación mínima antes de cada commit: `npm run lint && npm run typecheck && npm test && npm run build`.
- Commits con Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `test:`...).
- Los permisos se validan en el servidor **y** en la base de datos (RLS/funciones), nunca solo en la UI.
- El stock solo cambia mediante ventas, devoluciones y entradas de mercancía (funciones de BD).
- Dinero como `numeric(12,2)` en la BD; nunca `float`.
