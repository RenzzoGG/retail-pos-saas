/**
 * Reads emails from the local Mailpit inbox (http://localhost:54324) through
 * its HTTP API, so the E2E test can follow confirmation and invitation links.
 */
const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://localhost:54324";

type MailpitSummary = { ID: string; Subject: string };

export async function waitForLink(to: string, subjectIncludes: string, linkPattern: RegExp): Promise<string> {
  const query = encodeURIComponent(`to:"${to}"`);
  for (let attempt = 0; attempt < 40; attempt++) {
    const res = await fetch(`${MAILPIT_URL}/api/v1/search?query=${query}`);
    if (res.ok) {
      const { messages = [] } = (await res.json()) as { messages?: MailpitSummary[] };
      const message = messages.find((m) => m.Subject.includes(subjectIncludes));
      if (message) {
        const detail = (await (await fetch(`${MAILPIT_URL}/api/v1/message/${message.ID}`)).json()) as { HTML: string };
        const hrefs = [...detail.HTML.matchAll(/href="([^"]+)"/g)].map((m) => (m[1] ?? "").replaceAll("&amp;", "&"));
        const link = hrefs.find((h) => linkPattern.test(h));
        if (link) return link;
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No email "${subjectIncludes}" with a matching link arrived for ${to}`);
}
