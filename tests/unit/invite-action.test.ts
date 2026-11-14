import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialFormState } from "@/lib/forms/state";

/**
 * inviteMemberAction / resendInvitationAction with the real mailer and a
 * Resend API that never answers (what Railway's SMTP block looked like): the
 * action must come back with a clear error instead of hanging, and the
 * invitation must already be saved.
 */
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

const store = { storeId: "11111111-1111-4111-8111-111111111111", storeName: "Corner Market", role: "owner", isDemo: false };
vi.mock("@/lib/auth/dal", () => ({
  ACTIVE_STORE_COOKIE: "active_store",
  activeStoreCookieOptions: () => ({}),
  requireUser: vi.fn(),
  requireRole: vi.fn(async () => ({ user: { id: "22222222-2222-4222-8222-222222222222" }, store })),
}));

const profileQuery = { select: () => profileQuery, eq: () => profileQuery, maybeSingle: async () => ({ data: { full_name: "Olivia Park", email: "o@example.com" } }) };
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: () => profileQuery }) }));

const createInvitation = vi.fn();
const getPendingInvitation = vi.fn();
vi.mock("@/features/team/service", () => ({
  createInvitation: (...args: unknown[]) => createInvitation(...args),
  getPendingInvitation: (...args: unknown[]) => getPendingInvitation(...args),
}));

const { inviteMemberAction, resendInvitationAction } = await import("@/features/team/actions");
const { revalidatePath } = await import("next/cache");

const INVITATION_ID = "33333333-3333-4333-8333-333333333333";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(values)) data.set(k, v);
  return data;
}

const hangingFetch = vi.fn(
  (_url: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }),
);

beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "re_test_not_a_real_key_123");
  vi.stubGlobal("fetch", hangingFetch);
  vi.spyOn(console, "error").mockImplementation(() => {});
  store.isDemo = false;
  createInvitation.mockReset().mockResolvedValue({
    ok: true,
    data: { id: INVITATION_ID, token: "tok_abc", expiresAt: new Date("2026-11-20T15:04:00Z") },
  });
  getPendingInvitation.mockReset().mockResolvedValue({ ok: true, data: { email: "new@example.com", role: "cashier" } });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("inviteMemberAction", () => {
  it("returns an error after the send timeout instead of hanging, with the invitation already saved", async () => {
    vi.useFakeTimers();
    let settled = false;
    const result = inviteMemberAction(initialFormState, form({ email: "new@example.com", role: "cashier" })).finally(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(9_000);
    expect(settled).toBe(false);
    expect(createInvitation).toHaveBeenCalledOnce();
    expect(revalidatePath).toHaveBeenCalledWith("/app/team"); // listed under Pending invitations

    await vi.advanceTimersByTimeAsync(1_000);
    expect(await result).toEqual({
      status: "error",
      message: "Invitation created, but the email couldn't be sent. Try resending.",
    });
  });

  it("never logs the API key", async () => {
    vi.useFakeTimers();
    const result = inviteMemberAction(initialFormState, form({ email: "new@example.com", role: "cashier" }));
    await vi.advanceTimersByTimeAsync(10_000);
    await result;
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).toContain("Resend did not answer");
    expect(logged).not.toContain("re_test_not_a_real_key_123");
  });

  it("reports success when the email goes out", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"id":"e1"}', { status: 200 })));
    expect(await inviteMemberAction(initialFormState, form({ email: "new@example.com", role: "cashier" }))).toEqual({
      status: "success",
      message: "Invitation sent to new@example.com.",
    });
  });

  it("is refused in the demo store before touching invitations", async () => {
    store.isDemo = true;
    const result = await inviteMemberAction(initialFormState, form({ email: "new@example.com", role: "cashier" }));
    expect(result).toMatchObject({ status: "error", message: expect.stringContaining("locked in the public demo") });
    expect(createInvitation).not.toHaveBeenCalled();
  });
});

describe("resendInvitationAction", () => {
  it("re-creates the invitation with the same email and role and sends it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"id":"e1"}', { status: 200 })));
    const result = await resendInvitationAction(initialFormState, form({ invitationId: INVITATION_ID }));
    expect(getPendingInvitation).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ storeId: store.storeId }), INVITATION_ID);
    expect(createInvitation).toHaveBeenCalledWith(expect.anything(), expect.anything(), { email: "new@example.com", role: "cashier" });
    expect(result).toEqual({ status: "success", message: "Invitation sent again to new@example.com." });
  });

  it("returns the email error instead of hanging", async () => {
    vi.useFakeTimers();
    const result = resendInvitationAction(initialFormState, form({ invitationId: INVITATION_ID }));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await result).toEqual({
      status: "error",
      message: "Invitation created, but the email couldn't be sent. Try resending.",
    });
  });

  it("keeps the permission errors of the service (RLS)", async () => {
    getPendingInvitation.mockResolvedValue({ ok: false, error: "You don't have permission to do that.", code: "forbidden" });
    const result = await resendInvitationAction(initialFormState, form({ invitationId: INVITATION_ID }));
    expect(result).toEqual({ status: "error", message: "You don't have permission to do that." });
    expect(createInvitation).not.toHaveBeenCalled();
  });

  it("is refused in the demo store", async () => {
    store.isDemo = true;
    const result = await resendInvitationAction(initialFormState, form({ invitationId: INVITATION_ID }));
    expect(result).toMatchObject({ status: "error", message: expect.stringContaining("locked in the public demo") });
    expect(getPendingInvitation).not.toHaveBeenCalled();
  });

  it("rejects a malformed id", async () => {
    expect(await resendInvitationAction(initialFormState, form({ invitationId: "nope" }))).toEqual({
      status: "error",
      message: "Invalid invitation.",
    });
  });
});
