# CLAUDE.md — POS SaaS multitienda

## Resumen del proyecto
SaaS de punto de venta (POS) e inventario para tiendas pequeñas. Proyecto de portafolio.
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

## Convenciones
- Documentación y comunicación en español; código, nombres de tablas y commits en inglés.
- Commits con Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `test:`...).
- Los permisos se validan en el servidor **y** en la base de datos (RLS/funciones), nunca solo en la UI.
- El stock solo cambia mediante ventas, devoluciones y entradas de mercancía (funciones de BD).
- Dinero como `numeric(12,2)` en la BD; nunca `float`.
