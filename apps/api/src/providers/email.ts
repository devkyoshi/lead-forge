import { randomUUID } from "node:crypto";
import { env } from "../env.js";

export interface OutgoingEmail {
  to: string;
  from: { email: string; name?: string };
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  /** RFC 8058 one-click unsubscribe target, added as List-Unsubscribe headers. */
  unsubscribeUrl?: string;
  /** Echoed back by the provider on webhook events so we can find our message. */
  customArgs?: Record<string, string>;
}

export interface EmailProvider {
  readonly name: string;
  send(msg: OutgoingEmail): Promise<{ providerMessageId: string }>;
}

/** Fatal = retrying will not help (bad address, auth). Anything else is retried with backoff. */
export class EmailSendError extends Error {
  constructor(
    message: string,
    public fatal = false,
  ) {
    super(message);
  }
}

/** Dev provider: logs instead of sending. Pair with POST /dev/simulate-event to exercise webhooks. */
class ConsoleEmailProvider implements EmailProvider {
  readonly name = "console";
  async send(msg: OutgoingEmail) {
    console.log(`[email:console] to=${msg.to} subject=${JSON.stringify(msg.subject)}`);
    return { providerMessageId: `console-${randomUUID()}` };
  }
}

class SendGridEmailProvider implements EmailProvider {
  readonly name = "sendgrid";
  constructor(private apiKey: string) {}
  async send(msg: OutgoingEmail) {
    const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: msg.to }], custom_args: msg.customArgs }],
        from: { email: msg.from.email, name: msg.from.name },
        reply_to: msg.replyTo ? { email: msg.replyTo } : undefined,
        subject: msg.subject,
        content: [
          { type: "text/plain", value: msg.text },
          { type: "text/html", value: msg.html },
        ],
        headers: msg.unsubscribeUrl
          ? { "List-Unsubscribe": `<${msg.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }
          : undefined,
        tracking_settings: { click_tracking: { enable: true }, open_tracking: { enable: true } },
      }),
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 300);
      // 4xx other than rate-limit/timeouts will not succeed on retry.
      throw new EmailSendError(`SendGrid ${res.status}: ${body}`, res.status >= 400 && res.status < 500 && res.status !== 429 && res.status !== 408);
    }
    return { providerMessageId: res.headers.get("x-message-id") ?? randomUUID() };
  }
}

/** Provider abstraction: add SMTP / Resend here without touching the send pipeline. */
export function createEmailProvider(apiKey?: string): EmailProvider {
  if (env.EMAIL_PROVIDER === "sendgrid") {
    if (!apiKey) throw new EmailSendError("SendGrid API key is not configured (Settings > API keys or SENDGRID_API_KEY)", true);
    return new SendGridEmailProvider(apiKey);
  }
  return new ConsoleEmailProvider();
}
