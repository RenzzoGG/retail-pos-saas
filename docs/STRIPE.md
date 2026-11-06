# Stripe en modo de prueba — guía paso a paso

> Stocktill es un proyecto de portafolio con una marca ficticia. Usa **solo el modo de prueba de Stripe**:
> nunca se cobra dinero real. La app se niega a usar claves `sk_live_`.
>
> Tus claves van **solo** en `.env.local` (ignorado por git). No las pegues en el chat, en issues ni en
> commits.

## 1. Crear la cuenta (solo modo prueba)

1. Entra en <https://dashboard.stripe.com/register> y crea la cuenta con tu correo.
2. Si te pide **activar pagos** con datos de negocio o bancarios, sáltalo. Para el modo de prueba no hace
   falta.
3. Arriba en el Dashboard, activa el interruptor **"Test mode"** (modo de prueba). Todo lo que hagas debe
   tener ese interruptor encendido. Las claves de prueba empiezan por `pk_test_` y `sk_test_`.
4. Ve a **Developers → API keys** (en modo prueba) y copia:

   | Clave en Stripe | Variable en `.env.local` |
   | --- | --- |
   | Publishable key (`pk_test_…`) | `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` |
   | Secret key (`sk_test_…`, "Reveal test key") | `STRIPE_SECRET_KEY` |

5. Activa el **Customer Portal** en modo prueba:
   1. Ve a **Settings → Billing → Customer portal**.
   2. Activa "Customers can update payment methods" y "Customers can cancel subscriptions".
   3. Pulsa **Save**. Sin este paso, "Manage billing" no funciona.

## 2. Instalar el Stripe CLI en WSL (Ubuntu)

Necesita `sudo`. Ejecútalo tú en tu terminal:

```bash
curl -s https://packages.stripe.dev/api/security/keypair/stripe-cli-gpg/public \
  | gpg --dearmor | sudo tee /usr/share/keyrings/stripe.gpg > /dev/null
echo "deb [signed-by=/usr/share/keyrings/stripe.gpg] https://packages.stripe.dev/stripe-cli-debian-local stable main" \
  | sudo tee /etc/apt/sources.list.d/stripe.list
sudo apt update && sudo apt install stripe
stripe version
```

Luego ejecuta `stripe login`. Abre el navegador para enlazar el CLI con tu cuenta; el CLI trabaja en modo
prueba por defecto.

## 3. Crear el producto y el precio de 19 USD

```bash
node --env-file=.env.local scripts/stripe-setup.mjs
```

- Crea (o reutiliza, si ya existe) el producto **"Stocktill Monthly"** con un precio de **19.00 USD al mes**
  (`lookup_key: stocktill_monthly`).
- Se niega a funcionar con claves que no sean de prueba.
- Solo imprime el id del precio (`price_…`), que no es secreto. Ponlo en `.env.local` como
  `STRIPE_PRICE_ID=price_…`.
- Los **14 días de prueba** no son parte del precio: los pide la app al abrir Checkout
  (`subscription_data.trial_period_days = 14`).

## 4. Recibir webhooks en local

1. Arranca la app con `npm run dev:local` (puerto 3000).
2. En otra terminal ejecuta:

   ```bash
   stripe listen --forward-to localhost:3000/api/stripe/webhook \
     --events checkout.session.completed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,customer.subscription.trial_will_end,invoice.payment_failed
   ```

3. `stripe listen` imprime `Ready! Your webhook signing secret is whsec_…`. Ponlo en `.env.local` como
   `STRIPE_WEBHOOK_SECRET`.
4. Reinicia `npm run dev:local` para que la app lo lea. Deja `stripe listen` abierto mientras pruebas.

## 5. Probar el flujo completo

1. **Crea un owner y su tienda.** Regístrate con un correo nuevo en <http://localhost:3000/signup> (el
   correo de confirmación llega a Mailpit, <http://localhost:54324>) y crea la tienda. Verás el aviso
   **"Setup mode"**: puedes cargar productos, pero la caja está cerrada.
2. **Empieza la prueba.** Ve a **Billing → Start 14-day free trial**. En Checkout usa la tarjeta
   **4242 4242 4242 4242**, una fecha futura, cualquier CVC y cualquier código postal.
3. **Comprueba el estado.** Al volver, Billing muestra **"Free trial · 14 days left"** (si pone
   "Processing", recarga en unos segundos). En la terminal de `stripe listen` verás los eventos con `200`.
   La caja ya funciona.
4. **Prueba el Portal.** Usa **Manage billing**: cambia la tarjeta o cancela. Si cancelas "al final del
   periodo", Billing muestra la fecha de fin. Si cancelas inmediatamente, la tienda queda en **solo
   lectura**.
5. **Provoca un pago fallido.** Ejecuta `stripe trigger invoice.payment_failed`. Ese evento usa una
   suscripción de prueba propia que no es de tu tienda, así que la app lo registra como `ignored`. Para tu
   tienda:
   1. en el Portal, pon la tarjeta **4000 0000 0000 0341** (se acepta, pero falla al cobrar);
   2. con un **test clock** en el Dashboard, adelanta el tiempo hasta el fin de la prueba.

   La tienda pasará a **"Payment past due"**, con un aviso pero pudiendo vender.
6. **Repite un evento.** En el Dashboard → Developers → Events → **Resend** sobre un evento ya entregado,
   la respuesta dice `"result":"duplicate"` y no se aplica dos veces.

## 6. Pruebas que usan el Stripe real (opcionales)

```bash
npm run test:stripe
```

- Carga `.env.local` con `node --env-file`, comprueba que el precio sea de 19 USD al mes y crea una sesión
  de Checkout real, que luego expira sin pagar.
- Se **salta** si no hay `STRIPE_SECRET_KEY=sk_test_…` y `STRIPE_PRICE_ID`.
- El CI nunca la ejecuta. El resto de pruebas firma los eventos con un secreto inventado y no necesita
  Stripe.

## Variables de Stripe

| Variable | Qué es | ¿Secreta? |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | API key de prueba (`sk_test_…`), solo en el servidor | **Sí** |
| `STRIPE_WEBHOOK_SECRET` | Secreto de firma del webhook (`whsec_…`) | **Sí** |
| `STRIPE_PRICE_ID` | Precio de 19 USD (`price_…`) | No |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Clave publicable (`pk_test_…`). Hoy no se usa: Checkout y Portal están alojados en Stripe | No |

En producción (fase 11) el webhook se registra en Dashboard → Developers → Webhooks con la URL pública
`https://<tu-app>/api/stripe/webhook` y esos mismos eventos. Su `whsec_…` es distinto del de
`stripe listen`.
