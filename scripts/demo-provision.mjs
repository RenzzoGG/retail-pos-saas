// Creates (or repairs) the three public demo accounts in a Supabase project
// and builds the demo store. Run it YOURSELF, once, after `supabase db push`
// (docs/DEPLOY.md, step 6). Safe to run again: it updates what exists.
//
//   node --env-file=.env.production.local scripts/demo-provision.mjs
//
// Needs (from YOUR env file, never committed):
//   SUPABASE_URL         https://<project-ref>.supabase.co
//   SUPABASE_SECRET_KEY  Dashboard → Project Settings → API Keys → Secret key
//   DEMO_PASSWORD        the public demo password (same as NEXT_PUBLIC_DEMO_PASSWORD)
//
// The secret key is only used here, in your terminal, to call the Auth Admin
// API (create confirmed users with app_metadata.demo_role, which users can't
// change) and the reset_demo_store() function (service_role only). Nothing is
// printed except emails and counts.
import { createClient } from "@supabase/supabase-js";

const ACCOUNTS = [
  { role: "owner", email: "owner@demo.stocktill.test", fullName: "Olivia Owner" },
  { role: "admin", email: "admin@demo.stocktill.test", fullName: "Adam Admin" },
  { role: "cashier", email: "cashier@demo.stocktill.test", fullName: "Carla Cashier" },
];

function need(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. See the header of scripts/demo-provision.mjs.`);
    process.exit(1);
  }
  return value;
}

const url = need("SUPABASE_URL");
const secretKey = need("SUPABASE_SECRET_KEY");
const password = need("DEMO_PASSWORD");
if (password.length < 8) {
  console.error("DEMO_PASSWORD must have at least 8 characters.");
  process.exit(1);
}

const admin = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function findUser(email) {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const user = data.users.find((u) => u.email?.toLowerCase() === email);
    if (user) return user;
    if (data.users.length < 200) return null;
  }
  return null;
}

for (const account of ACCOUNTS) {
  const attributes = {
    email: account.email,
    password,
    email_confirm: true,
    app_metadata: { demo_role: account.role },
    user_metadata: { full_name: account.fullName },
  };
  const existing = await findUser(account.email);
  const { error } = existing
    ? await admin.auth.admin.updateUserById(existing.id, attributes)
    : await admin.auth.admin.createUser(attributes);
  if (error) {
    console.error(`${account.email}: ${error.message}`);
    process.exit(1);
  }
  console.log(`${existing ? "updated" : "created"}  ${account.email} (${account.role})`);
}

const { data, error } = await admin.rpc("reset_demo_store", { p_password: password, p_lock: true });
if (error) {
  console.error(`reset_demo_store failed: ${error.message}`);
  process.exit(1);
}
console.log(`demo store ready: ${data.sales} sales, ${data.returns} returns, locked=${data.locked}`);
