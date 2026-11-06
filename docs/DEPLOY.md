# Despliegue en producción — Stocktill

> **Stocktill es una marca ficticia** creada para un proyecto de portafolio.

Esta guía la sigues **tú** con tus cuentas. Ninguna clave pasa por el repositorio ni por el asistente.

Arquitectura de producción:

```
Navegador ──https──▶ Cloudflare (proxy, SSL Full) ──https──▶ Railway (contenedor Docker, Next.js standalone)
                                                                │
                                         supabase-js (RLS) ─────┼──▶ Supabase Cloud (Postgres, Auth)
                                                                ├──▶ Resend (SMTP: invitaciones)
Stripe (modo prueba) ──webhook firmado──▶ /api/stripe/webhook ──┘
Supabase Auth ──SMTP──▶ Resend (confirmación de registro, reset de contraseña)
pg_cron (dentro de Supabase) ──cada noche──▶ public.reset_demo_store()
```

Orden recomendado. Cada paso deja algo que el siguiente necesita:

1. [Supabase Cloud: proyecto y migraciones](#1-supabase-cloud-proyecto-y-migraciones)
2. [Resend: correo de producción](#2-resend-correo-de-producción)
3. [Supabase Auth: URLs, plantillas y SMTP](#3-supabase-auth-urls-plantillas-y-smtp)
4. [Railway: servicio desde GitHub](#4-railway-servicio-desde-github)
5. [Cloudflare: dominio `stocktill.renzzogg.com`](#5-cloudflare-dominio-stocktillrenzzoggcom)
6. [Stripe: webhook de producción (modo prueba)](#6-stripe-webhook-de-producción-modo-prueba)
7. [Demo pública: cuentas y reinicio nocturno](#7-demo-pública-cuentas-y-reinicio-nocturno)
8. [Prueba de humo y checklist final](#8-prueba-de-humo-y-checklist-final)

Al final está la [tabla con todas las variables de entorno](#variables-de-entorno-de-producción).

---

## 1. Supabase Cloud: proyecto y migraciones

1. En <https://supabase.com/dashboard> → **New project**.
   - Plan **Free**.
   - Región cercana a Railway (por ejemplo `us-east-1` si el servicio de Railway está en US East). Así cada
     consulta hace menos viaje.
   - Genera una **contraseña de base de datos** fuerte y guárdala en tu gestor de contraseñas. La pide el
     CLI en el paso 3.
2. Cuando el proyecto esté listo, copia el **Project ref**. Es la parte `abcdefgh` de
   `https://abcdefgh.supabase.co` y aparece en Project Settings → General.
3. Aplica las migraciones desde tu terminal, en la carpeta del repo:

   ```bash
   npx supabase login                         # abre el navegador; el token queda en tu equipo
   npx supabase link --project-ref <ref>      # pide la contraseña de la BD
   npx supabase db push --dry-run             # lista las migraciones que se aplicarán
   npx supabase db push                       # aplica supabase/migrations/*.sql
   ```

   - `db push` **no** ejecuta `supabase/seed.sql`. Ese seed es solo para local: crea usuarios con
     contraseñas conocidas. La demo de producción se crea en el paso 7.
   - Comprueba en **Table Editor** que existen `stores`, `products`, `sales`… y en **Database → Policies**
     que todas tienen RLS.
4. Copia en un sitio seguro (lo usarás en Railway y en el paso 7), desde **Project Settings → API Keys**:
   - **Publishable key** (`sb_publishable_…`): es pública, va en el navegador.
   - **Secret key** (`sb_secret_…`): es **secreta** y se salta RLS. Solo la usa el webhook de Stripe.

> **El plan gratuito pausa el proyecto tras 7 días sin actividad.** La app responderá con errores
> hasta que lo reactives desde el panel de Supabase (**Restore project**, tarda unos minutos). El
> reinicio nocturno de la demo (paso 7) genera actividad en la BD cada día, lo que en la práctica suele
> evitar la pausa. Aun así, Supabase puede cambiar el criterio, así que revisa el proyecto si la demo deja
> de responder.

## 2. Resend: correo de producción

**Por qué no basta el SMTP integrado de Supabase:** está pensado para pruebas. Solo envía a los correos
del equipo de tu organización de Supabase y tiene un límite muy bajo (unos pocos correos por hora). Un
visitante que se registre no recibiría la confirmación.

**Opción gratuita propuesta: [Resend](https://resend.com).** El plan Free incluye 3000 correos al mes
(100 al día), SMTP estándar y verificación de dominio con DNS. Un solo proveedor sirve para los dos tipos de
correo:

| Correo | Quién lo envía | Configuración |
| --- | --- | --- |
| Confirmación de registro, reset de contraseña | Supabase Auth | SMTP personalizado en Supabase (paso 3) |
| Invitaciones al equipo | La app (nodemailer) | Variables `SMTP_*` en Railway (paso 4) |

Pasos:

1. Crea la cuenta en Resend → **Domains → Add domain** → `renzzogg.com`. También puedes usar un
   subdominio de envío como `mail.renzzogg.com` para no tocar el correo del dominio raíz.
2. Resend te muestra registros **MX, TXT (SPF) y TXT (DKIM)**. Créalos en Cloudflare → DNS **con la
   nube gris (DNS only)**: los registros de correo nunca van con proxy. Opcional y recomendado: un TXT
   `_dmarc` con `v=DMARC1; p=none;`.
3. Espera a que Resend marque el dominio como **Verified**.
4. **API Keys → Create API key**, con permiso *Sending access* limitado a ese dominio. Esa clave es la
   **contraseña SMTP** y es **secreta**.
5. Datos SMTP de Resend (los usarás en los pasos 3 y 4):
   - Host: `smtp.resend.com`
   - Puerto: `465`. Es TLS implícito y la app activa `secure` automáticamente con ese puerto.
   - Usuario: `resend`
   - Contraseña: la API key
   - Remitente: `Stocktill <no-reply@renzzogg.com>`, o la dirección del subdominio que verificaste

Alternativa si no quieres verificar un dominio: Brevo (300 correos al día gratis). En la práctica también
pide un dominio para que los correos no acaben en spam.

## 3. Supabase Auth: URLs, plantillas y SMTP

En el panel del proyecto:

1. **Authentication → URL Configuration**
   - **Site URL:** `https://stocktill.renzzogg.com`. Las plantillas lo usan como `{{ .SiteURL }}`.
   - **Redirect URLs:** añade `https://stocktill.renzzogg.com/**`. Opcionalmente añade también la URL
     `https://<servicio>.up.railway.app/**` mientras pruebas sin dominio.
2. **Authentication → Sign In / Providers → Email**
   - **Confirm email:** activado. Sin confirmar no se puede iniciar sesión (igual que en local).
   - **Secure email change:** activado, para que el cambio de email se confirme en las dos direcciones.
   - **Minimum password length:** `8`, como en `supabase/config.toml`.
3. **Authentication → Emails → Templates.** Copia el HTML de las plantillas del repo. Usan `/auth/confirm`
   con `token_hash`, así que el enlace funciona aunque el correo se abra en otro navegador.
   - **Confirm signup**: asunto `Confirm your Stocktill account`, cuerpo de `supabase/templates/confirmation.html`.
   - **Reset password**: asunto `Reset your Stocktill password`, cuerpo de `supabase/templates/recovery.html`.
4. **Authentication → Emails → SMTP Settings → Enable custom SMTP**
   - Host `smtp.resend.com`, puerto `465`, usuario `resend` y contraseña: tu API key de Resend.
   - Sender email `no-reply@renzzogg.com` y sender name `Stocktill`.
5. **Authentication → Rate Limits:** con SMTP propio, Supabase permite subir el límite de correos por
   hora. Déjalo en un valor modesto (por ejemplo 30 por hora): limita el abuso y sobra para una demo.
6. **Database → Extensions:** activa **pg_cron**. Lo usa el paso 7.

## 4. Railway: servicio desde GitHub

> Railway lee la configuración del **panel**. No hay `railway.json` en el repo a propósito.

1. <https://railway.com> → **New Project → Deploy from GitHub repo** → `RenzzoGG/retail-pos-saas`, rama
   `main`. Si es la primera vez, autoriza la app de Railway en GitHub solo para ese repositorio.
2. Railway detecta el `Dockerfile` de la raíz y lo usa como builder. Antes de que termine el primer build
   (fallará sin variables, es normal), abre el servicio y configura:

   **Settings → Build**
   - **Builder:** `Dockerfile`. **Dockerfile Path:** `Dockerfile`.
   - **Watch Paths** (opcional): vacío, para que cualquier push a `main` despliegue.

   **Settings → Deploy**
   - **Custom Start Command:** **vacío**. Se usa el `CMD ["node", "server.js"]` del Dockerfile.
   - **Healthcheck Path:** `/api/health`. Railway solo enruta tráfico a la nueva versión cuando responde
     200, así que un despliegue roto nunca reemplaza al que funciona. Railway **no** usa el
     `HEALTHCHECK` del Dockerfile; ese es para `docker run`.
   - **Healthcheck Timeout:** `120` segundos.
   - **Restart Policy:** `On Failure`, con 3 reintentos como máximo.
   - **Replicas:** `1`. La app no guarda estado en memoria, pero una réplica gasta menos crédito.
   - **Serverless / App Sleeping** (opcional): ahorra crédito apagando el contenedor sin tráfico, a cambio
     de que la primera visita tarde unos segundos.
   - **Region:** la misma zona que Supabase.

   **Variables** (pestaña *Variables* → *Raw Editor*): todas las de la
   [tabla final](#variables-de-entorno-de-producción).
   - Las `NEXT_PUBLIC_*` se usan **al construir**. Railway las pasa como *build args* porque el Dockerfile
     declara un `ARG` con su nombre. Si cambias una, hay que **volver a desplegar** (Deployments →
     Redeploy).
   - Marca como *sealed* las secretas (`SUPABASE_SECRET_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` y
     `SMTP_PASS`): ni tú las vuelves a ver en el panel.
3. **Settings → Networking → Generate Domain**: crea `<servicio>.up.railway.app`. Usa el puerto `3000`,
   porque fijamos `PORT=3000` en las variables. Con eso ya puedes probar:
   `curl https://<servicio>.up.railway.app/api/health` → `{"status":"ok"}`.
   - Mientras usas este dominio, pon `NEXT_PUBLIC_SITE_URL=https://<servicio>.up.railway.app` y
     redespliega. Cámbialo al dominio final en el paso 5.
4. Revisa **Deployments → View logs**. Debe aparecer `✓ Ready` y `Network: http://0.0.0.0:3000`.

## 5. Cloudflare: dominio `stocktill.renzzogg.com`

Igual que en tus otros proyectos:

1. Railway → servicio → **Settings → Networking → Custom Domain** → `stocktill.renzzogg.com`, con el
   puerto `3000`. Railway te muestra dos registros:
   - un **CNAME** `stocktill` → `<algo>.up.railway.app`;
   - un **TXT** `_railway-verify.stocktill` con un valor `railway-verify=…`.
2. Cloudflare → `renzzogg.com` → **DNS → Add record**:
   - `CNAME`, nombre `stocktill`, destino el que dio Railway, **Proxied (nube naranja)**;
   - `TXT`, nombre `_railway-verify.stocktill`, valor el que dio Railway (los TXT no tienen proxy).
3. Cloudflare → **SSL/TLS → Overview → Full**. Railway sirve https con su propio certificado; *Flexible*
   provocaría un bucle de redirecciones. *Full (strict)* también funciona en cuanto Railway emita el
   certificado del dominio.
4. **SSL/TLS → Edge Certificates → Always Use HTTPS:** activado. La app manda HSTS y
   `upgrade-insecure-requests` cuando `NEXT_PUBLIC_SITE_URL` es https.
5. Espera a que Railway marque el dominio como verificado (de minutos a una hora).
6. En Railway, cambia `NEXT_PUBLIC_SITE_URL=https://stocktill.renzzogg.com` y **redespliega**. El valor se
   usa en el build: enlaces de correo, Open Graph, sitemap y el CSP.
7. Vuelve a Supabase → URL Configuration (paso 3) y confirma que el Site URL es el dominio final.

> **Cache de Cloudflare:** el proxy no cachea HTML por defecto, solo estáticos por extensión. No crees
> reglas de *Cache Everything*: las páginas privadas dependen de la sesión.

## 6. Stripe: webhook de producción (modo prueba)

> Todo en **Test mode** (interruptor arriba a la derecha del Dashboard). La app rechaza claves `sk_live_`.

1. Si aún no existe el producto, créalo con tu clave de prueba, en tu terminal:
   `node --env-file=.env.local scripts/stripe-setup.mjs`. Es idempotente e imprime el `STRIPE_PRICE_ID`.
   Más detalle en `docs/STRIPE.md`.
2. **Developers → Webhooks → Add endpoint**
   - **Endpoint URL:** `https://stocktill.renzzogg.com/api/stripe/webhook`
   - **Events:** `checkout.session.completed`, `customer.subscription.created`,
     `customer.subscription.updated`, `customer.subscription.deleted`,
     `customer.subscription.trial_will_end`, `invoice.payment_failed` (los mismos que `stripe listen`).
3. Abre el endpoint → **Signing secret → Reveal** (`whsec_…`) y ponlo en Railway como
   `STRIPE_WEBHOOK_SECRET`. **Es distinto del `whsec_` que imprime `stripe listen` en local.** Cada
   endpoint tiene su propio secreto, y con el de local todas las firmas de producción darían 400.
4. **Settings → Billing → Customer portal:** activa el portal de prueba. Es el mismo paso de
   `docs/STRIPE.md` y lo usa "Manage billing".
5. Prueba: regístrate con un correo tuyo, crea una tienda → Billing → *Start free trial* → tarjeta
   `4242 4242 4242 4242`. En Stripe → Webhooks → el endpoint, los eventos deben salir con **200**; en la
   app, Billing muestra *Trialing*.

## 7. Demo pública: cuentas y reinicio nocturno

Los visitantes entran con tres cuentas publicadas (owner, admin, cajero) desde el panel *Try the live
demo* de `/login`. Lo que podría romper la demo para el siguiente visitante está bloqueado en la BD:
equipo, invitaciones, ajustes de la tienda, crear tiendas y renombrar el perfil. El resto (vender, devolver,
importar, editar productos) se deshace cada noche. Detalle en `docs/DESIGN.md` §7b.

1. **Elige la contraseña pública de la demo**, por ejemplo `stocktill-demo`. Es pública a propósito porque
   aparece en el login, así que **no** reutilices una contraseña tuya.
2. En Railway: `NEXT_PUBLIC_DEMO_ENABLED=true` y `NEXT_PUBLIC_DEMO_PASSWORD=<esa contraseña>` → redespliega.
3. **Crea las cuentas y la tienda demo** desde tu terminal, con un archivo de entorno **tuyo**. Ya está
   ignorado por git (`.env.*`):

   ```bash
   # .env.production.local  (NO se versiona)
   SUPABASE_URL=https://<ref>.supabase.co
   SUPABASE_SECRET_KEY=sb_secret_…
   DEMO_PASSWORD=stocktill-demo
   ```

   ```bash
   node --env-file=.env.production.local scripts/demo-provision.mjs
   ```

   Usa la Admin API para crear (o reparar) los tres usuarios confirmados con `app_metadata.demo_role` y
   llama a `reset_demo_store`. Debe terminar con `demo store ready: ~338 sales, 11 returns, locked=true`.
   Puedes repetirlo sin problema.
4. **Programa el reinicio nocturno** en Supabase → **SQL Editor** (pg_cron ya activado en el paso 3):

   ```sql
   select cron.schedule(
     'reset-demo-store',
     '0 3 * * *',                                    -- todos los días a las 03:00 UTC
     $$ select public.reset_demo_store('stocktill-demo') $$  -- tu contraseña pública de la demo
   );
   ```

   - Comprobar: `select * from cron.job;` y, al día siguiente,
     `select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;`.
   - Cambiar el horario o la contraseña: vuelve a ejecutar `cron.schedule` con el mismo nombre (lo
     reemplaza). Si cambias la hora, actualiza `DEMO_RESET_TIME` en `src/features/demo/config.ts`.
   - Reinicio manual inmediato: `select public.reset_demo_store('stocktill-demo');` en el SQL Editor.
   - El job corre dentro de Supabase como `postgres`: no hay claves fuera de Supabase.
5. Prueba en `https://stocktill.renzzogg.com/login` → *Try as Cashier* → vende algo. Después *Try as Owner* →
   Team → invitar debe decir *"That's locked in the public demo…"*.

## 8. Prueba de humo y checklist final

Desde tu terminal (solo lee: no inicia sesión ni escribe datos):

```bash
npx playwright install chromium            # una vez
SMOKE_BASE_URL=https://stocktill.renzzogg.com npm run test:smoke
```

Comprueba:
- que `/api/health` responde;
- que la landing y `/login` cargan sin errores de consola;
- que `/app` redirige al login;
- los encabezados de seguridad, HSTS y la redirección http → https;
- `robots.txt` y `sitemap.xml`.

Checklist:
- [ ] `curl https://stocktill.renzzogg.com/api/health` → `{"status":"ok"}`
- [ ] Registro con un correo real → llega la confirmación (Resend → Logs) → onboarding
- [ ] Invitación desde una tienda propia → llega el correo
- [ ] Checkout de prueba → webhook en 200 → Billing *Trialing*
- [ ] *Try the live demo* funciona con los tres roles
- [ ] `select * from cron.job` muestra `reset-demo-store`
- [ ] <https://securityheaders.com/?q=stocktill.renzzogg.com> muestra los encabezados
- [ ] `npm run test:smoke` en verde

---

## Variables de entorno de producción

Se configuran en **Railway → Variables**. "Build" significa que se incrusta en el bundle al construir,
así que cambiarla requiere redesplegar.

| Variable | Valor en producción | Para qué sirve | ¿Secreta? | Cuándo |
| --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | `https://stocktill.renzzogg.com` | URL base: enlaces de correo, Open Graph, sitemap; activa HSTS y `upgrade-insecure-requests` | No | Build |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` | API de Supabase (servidor y navegador); entra en `connect-src` del CSP | No | Build + runtime |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` | Clave pública de Supabase: cada consulta va con la sesión del usuario y RLS la limita | No (pública por diseño) | Build + runtime |
| `NEXT_PUBLIC_DEMO_ENABLED` | `true` | Muestra el panel *Try the live demo* y el CTA de la landing | No | Build |
| `NEXT_PUBLIC_DEMO_PASSWORD` | p. ej. `stocktill-demo` | Contraseña **publicada** de las cuentas demo (no reutilices una real) | No (pública a propósito) | Build |
| `SUPABASE_SECRET_KEY` | `sb_secret_…` | **Se salta RLS.** Solo la usa el webhook de Stripe para actualizar la suscripción | **Sí** | Runtime |
| `STRIPE_SECRET_KEY` | `sk_test_…` | Crear sesiones de Checkout y del portal de facturación (modo prueba; `sk_live_` se rechaza) | **Sí** | Runtime |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` del endpoint de producción | Verifica la firma de cada evento del webhook | **Sí** | Runtime |
| `STRIPE_PRICE_ID` | `price_…` | Precio del plan mensual de 19 USD | No | Runtime |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_test_…` (opcional) | No se usa todavía (Checkout está alojado en Stripe) | No | Build |
| `SMTP_HOST` | `smtp.resend.com` | Servidor SMTP de las invitaciones | No | Runtime |
| `SMTP_PORT` | `465` | Puerto (465 = TLS implícito) | No | Runtime |
| `SMTP_USER` | `resend` | Usuario SMTP | No | Runtime |
| `SMTP_PASS` | API key de Resend (`re_…`) | Contraseña SMTP | **Sí** | Runtime |
| `EMAIL_FROM` | `Stocktill <no-reply@renzzogg.com>` | Remitente de las invitaciones (dominio verificado en Resend) | No | Runtime |
| `PORT` | `3000` | Puerto en el que escucha `server.js`; debe coincidir con el *target port* del dominio | No | Runtime |

No se configuran en Railway:
- `SUPABASE_INTERNAL_URL`: solo para Docker Compose en local.
- `DATABASE_URL`: solo lo usa `drizzle-kit` en local. Las migraciones de producción se aplican con
  `supabase db push`.
- `HOSTNAME`: el Dockerfile ya lo fija a `0.0.0.0`.
- `NODE_ENV`: el Dockerfile ya lo fija a `production`.

Solo en **tu** `.env.production.local` (paso 7, nunca en Railway ni en git): `SUPABASE_URL`,
`SUPABASE_SECRET_KEY` y `DEMO_PASSWORD`, para `scripts/demo-provision.mjs`.

## Problemas frecuentes

| Síntoma | Causa probable | Solución |
| --- | --- | --- |
| La app arranca pero el login o `/app` dan error 500 ("Missing environment variable") | Faltaban `NEXT_PUBLIC_*` cuando se construyó la imagen | Añádelas en Variables y **redespliega** (se incrustan al construir) |
| Healthcheck nunca pasa | El dominio apunta a otro puerto | `PORT=3000` y *target port* 3000 |
| `ERR_TOO_MANY_REDIRECTS` | SSL de Cloudflare en *Flexible* | Cámbialo a **Full** |
| El enlace del correo lleva a `localhost` | Site URL de Supabase sin cambiar | Paso 3.1 |
| "That link is invalid or has expired" | Redirect URL no permitida, o el enlace ya se usó | Paso 3.1; pide otro enlace |
| Webhook en 400 | `STRIPE_WEBHOOK_SECRET` es el de `stripe listen` | Usa el del endpoint de producción (paso 6.3) |
| *Try as …* dice que la demo no está disponible | No se corrió `demo-provision.mjs` o la contraseña no coincide | Paso 7.3, con la misma contraseña que `NEXT_PUBLIC_DEMO_PASSWORD` |
| Todo da error de conexión de repente | Proyecto de Supabase pausado por inactividad | Panel de Supabase → **Restore project** |
| Correos de registro que no llegan | SMTP sin configurar o dominio sin verificar | Pasos 2 y 3.4; revisa Resend → Logs |
