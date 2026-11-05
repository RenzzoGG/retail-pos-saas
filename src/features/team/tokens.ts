import { createHash, randomBytes } from "node:crypto";

export const INVITATION_TTL_DAYS = 7;

/** 32 random bytes, URL-safe. This is what goes in the email link. */
export function generateInvitationToken(): string {
  return randomBytes(32).toString("base64url");
}

/** What the database stores. Must match app.hash_token() in SQL (SHA-256, hex). */
export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
