import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { EmailDeliveryError } = await import("@/lib/email/delivery");
const { RESEND_API_URL, sendWithResend } = await import("@/lib/email/resend");

const API_KEY = "re_test_not_a_real_key_123";
const email = {
  from: "Stocktill <no-reply@stocktill.test>",
  to: "new.member@example.com",
  subject: "You're invited",
  text: "Plain text",
  html: "<p>HTML</p>",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** A fetch that never answers, until the request is aborted (like a dropped connection). */
const hangingFetch = vi.fn(
  (_url: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }),
);

async function failure(promise: Promise<unknown>): Promise<InstanceType<typeof EmailDeliveryError>> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  // By name: tests that re-import the mailer (vi.resetModules) get a fresh copy of the class.
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).name).toBe(EmailDeliveryError.name);
  return error as InstanceType<typeof EmailDeliveryError>;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("sendWithResend", () => {
  it("POSTs the email to Resend's API with the bearer key, html and text", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => json(200, { id: "email_1" }));
    await sendWithResend(email, { apiKey: API_KEY, timeoutMs: 10_000, fetch: fetchMock });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(RESEND_API_URL);
    expect(url).toBe("https://api.resend.com/emails");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" });
    expect(JSON.parse(String(init?.body))).toEqual({
      from: email.from,
      to: [email.to],
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    [422, { statusCode: 422, name: "validation_error", message: "The from address domain is not verified." }, "HTTP 422 (validation_error)"],
    [401, { statusCode: 401, name: "missing_api_key", message: `Bad key ${API_KEY}` }, "HTTP 401 (missing_api_key)"],
    [500, { statusCode: 500, name: "internal_server_error", message: "Oops" }, "HTTP 500 (internal_server_error)"],
    [503, "not json", "HTTP 503"],
  ])("fails with HTTP %i, without leaking the key or Resend's message", async (status, body, expected) => {
    const fetchMock = vi.fn(async () => (typeof body === "string" ? new Response(body, { status }) : json(status, body)));
    const error = await failure(sendWithResend(email, { apiKey: API_KEY, timeoutMs: 10_000, fetch: fetchMock }));
    expect(error.reason).toBe("rejected");
    expect(error.message).toBe(`Resend rejected the email: ${expected}`);
    expect(error.message).not.toContain(API_KEY);
    expect(JSON.stringify(error)).not.toContain(API_KEY);
  });

  it("fails on a network error without leaking the key", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError(`fetch failed for Bearer ${API_KEY}`);
    });
    const error = await failure(sendWithResend(email, { apiKey: API_KEY, timeoutMs: 10_000, fetch: fetchMock }));
    expect(error.reason).toBe("network");
    expect(error.message).not.toContain(API_KEY);
    expect(error.cause).toBeUndefined();
  });

  it("gives up after the timeout when Resend doesn't answer", async () => {
    vi.useFakeTimers();
    const sending = failure(sendWithResend(email, { apiKey: API_KEY, timeoutMs: 10_000, fetch: hangingFetch }));
    await vi.advanceTimersByTimeAsync(9_999);
    expect(vi.getTimerCount()).toBe(1); // still waiting
    await vi.advanceTimersByTimeAsync(1);
    const error = await sending;
    expect(error.reason).toBe("timeout");
    expect(error.message).toBe("Resend did not answer within 10000 ms");
  });
});

describe("sendEmail", () => {
  const content = { subject: email.subject, text: email.text, html: email.html };

  it("uses Resend over HTTPS when RESEND_API_KEY is set, with a 10 s timeout", async () => {
    vi.stubEnv("RESEND_API_KEY", ` ${API_KEY} `);
    vi.stubEnv("EMAIL_FROM", "Stocktill <no-reply@renzzogg.test>");
    vi.useFakeTimers();
    vi.stubGlobal("fetch", hangingFetch);
    const { sendEmail } = await import("@/lib/email/mailer");

    const sending = failure(sendEmail(email.to, content));
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await sending).reason).toBe("timeout");
    const [url, init] = hangingFetch.mock.calls.at(-1)!;
    expect(url).toBe("https://api.resend.com/emails");
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${API_KEY}` });
    expect(JSON.parse(String(init?.body)).from).toBe("Stocktill <no-reply@renzzogg.test>");
    vi.unstubAllGlobals();
  });

  it("falls back to SMTP (nodemailer) with short timeouts when RESEND_API_KEY is not set", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const sendMail = vi.fn(async () => ({}));
    const createTransport = vi.fn(() => ({ sendMail }));
    vi.doMock("nodemailer", () => ({ default: { createTransport } }));
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { sendEmail } = await import("@/lib/email/mailer");

    await sendEmail(email.to, content);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 10_000 }),
    );
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: email.to, html: email.html, text: email.text }));
    vi.unstubAllGlobals();
    vi.doUnmock("nodemailer");
  });

  it("SMTP: gives up after 10 s even if nodemailer never settles", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.useFakeTimers();
    vi.doMock("nodemailer", () => ({
      default: { createTransport: () => ({ sendMail: () => new Promise(() => {}) }) },
    }));
    const { sendEmail } = await import("@/lib/email/mailer");

    const sending = failure(sendEmail(email.to, content));
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await sending).reason).toBe("timeout");
    vi.doUnmock("nodemailer");
  });

  it("fails fast with a clear error when no transport is configured (production without RESEND_API_KEY or SMTP_HOST)", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("SMTP_HOST", "");
    vi.stubEnv("SMTP_PORT", "");
    vi.stubEnv("NODE_ENV", "production");
    const { sendEmail } = await import("@/lib/email/mailer");
    const error = await failure(sendEmail(email.to, content));
    expect(error.reason).toBe("config");
    expect(error.message).toBe("Email is not configured: set RESEND_API_KEY (or SMTP_HOST and SMTP_PORT)");
  });
});
