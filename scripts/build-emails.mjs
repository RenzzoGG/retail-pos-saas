// Generates the Supabase Auth email templates (supabase/templates/*.html)
// from the single source in src/lib/email/layout.ts.
//
//   npm run emails:build
//
// Node 24 loads the TypeScript source directly (type stripping). The files are
// written as generated, without a header comment: Supabase strips HTML
// comments, and tests/unit/email-templates.test.ts fails if they drift from
// the source. After changing them, copy each file into the Supabase dashboard
// (docs/DEPLOY.md, "Correos de Supabase") and restart local Supabase
// (`npm run supabase:stop && npm run supabase:start`) so it reloads them.
import { readFileSync, writeFileSync } from "node:fs";
import { SUPABASE_AUTH_EMAILS } from "../src/lib/email/layout.ts";

let changed = 0;
for (const [name, email] of Object.entries(SUPABASE_AUTH_EMAILS)) {
  let current = "";
  try {
    current = readFileSync(email.file, "utf8");
  } catch {
    // new file
  }
  if (current === email.html) {
    console.log(`= ${email.file} (${name}) is up to date`);
    continue;
  }
  writeFileSync(email.file, email.html);
  changed++;
  console.log(`✓ ${email.file} (${name}) written. Subject: "${email.subject}"`);
}
if (changed > 0) {
  console.log("\nNext: restart local Supabase to reload them, and paste them into the Supabase dashboard (docs/DEPLOY.md).");
}
