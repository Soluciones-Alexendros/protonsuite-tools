import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ResolvedBridgeConfig } from "../src/config.js";
import type { EmailFull } from "../src/imap.js";
import { SmtpClient, buildReplyOptions, buildForwardOptions, prefixSubject, collectReferences } from "../src/smtp.js";

// ---------------------------------------------------------------------------
// SmtpClient
// ---------------------------------------------------------------------------

const sendMailMock = vi.fn();

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: sendMailMock,
      close: vi.fn(),
    })),
  },
}));

function makeCfg(overrides?: Partial<ResolvedBridgeConfig>): ResolvedBridgeConfig {
  return {
    user: "me@proton.me",
    pass: "secret",
    host: "127.0.0.1",
    imapPort: 1143,
    smtpPort: 1025,
    from: "me@proton.me",
    tlsInsecure: true,
    smtpSecurity: "starttls" as const,
    passwordResolver: vi.fn().mockResolvedValue("resolved-pass"),
    ...overrides,
  };
}

const silentLog = {
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
};

describe("SmtpClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("constructs without error", () => {
    const smtp = new SmtpClient(makeCfg(), silentLog);
    expect(smtp).toBeInstanceOf(SmtpClient);
  });

  it("send() returns SendResult with messageId", async () => {
    sendMailMock.mockResolvedValueOnce({
      messageId: "<abc@local>",
      accepted: ["bob@example.com"],
      rejected: [],
      response: "250 OK",
    });

    const smtp = new SmtpClient(makeCfg(), silentLog);
    const result = await smtp.send({
      to: ["bob@example.com"],
      subject: "Hello",
      text: "Body",
    });

    expect(result.messageId).toBe("<abc@local>");
    expect(result.accepted).toEqual(["bob@example.com"]);
    expect(sendMailMock).toHaveBeenCalledOnce();
  });

  it("send() handles attachments", async () => {
    sendMailMock.mockResolvedValueOnce({
      messageId: "<att@local>",
      accepted: [],
      rejected: [],
      response: "250 OK",
    });

    const smtp = new SmtpClient(makeCfg(), silentLog);
    const result = await smtp.send({
      to: ["bob@example.com"],
      subject: "With attachment",
      text: "See attached",
      attachments: [{
        filename: "doc.pdf",
        contentBase64: Buffer.from("pdf-content").toString("base64"),
        contentType: "application/pdf",
      }],
    });

    expect(result.messageId).toBe("<att@local>");
    expect(sendMailMock).toHaveBeenCalledOnce();
  });

  it("send() with implicit TLS security", async () => {
    sendMailMock.mockResolvedValueOnce({
      messageId: "<tls@local>",
      accepted: [],
      rejected: [],
      response: "250 OK",
    });

    const smtp = new SmtpClient(makeCfg({ smtpSecurity: "implicit" }), silentLog);
    const result = await smtp.send({
      to: ["bob@example.com"],
      subject: "Secure",
      text: "Body",
    });

    expect(result.messageId).toBe("<tls@local>");
  });

  it("send() with insecure TLS disabled", async () => {
    sendMailMock.mockResolvedValueOnce({
      messageId: "<no-insecure@local>",
      accepted: [],
      rejected: [],
      response: "250 OK",
    });

    const smtp = new SmtpClient(makeCfg({ tlsInsecure: false }), silentLog);
    const result = await smtp.send({
      to: ["bob@example.com"],
      subject: "Strict TLS",
      text: "Body",
    });

    expect(result.messageId).toBe("<no-insecure@local>");
  });

  it("send() with cc and bcc", async () => {
    sendMailMock.mockResolvedValueOnce({
      messageId: "<cc@local>",
      accepted: [],
      rejected: [],
      response: "250 OK",
    });

    const smtp = new SmtpClient(makeCfg(), silentLog);
    const result = await smtp.send({
      to: ["bob@example.com"],
      cc: ["carol@example.com"],
      bcc: ["dave@example.com"],
      subject: "Group",
      text: "All",
    });

    expect(result.messageId).toBe("<cc@local>");
  });

  it("send() logs the result", async () => {
    sendMailMock.mockResolvedValueOnce({
      messageId: "<log@local>",
      accepted: ["bob@example.com"],
      rejected: [],
      response: "250 OK",
    });

    const smtp = new SmtpClient(makeCfg(), silentLog);
    await smtp.send({
      to: ["bob@example.com"],
      subject: "Log test",
      text: "Body",
    });

    expect(silentLog.info).toHaveBeenCalledWith("Email sent", expect.objectContaining({
      messageId: "<log@local>",
    }));
  });

  it("send() handles empty accepted/rejected arrays", async () => {
    sendMailMock.mockResolvedValueOnce({
      messageId: "<undef@local>",
      accepted: [],
      rejected: [],
      response: "250 OK",
    });

    const smtp = new SmtpClient(makeCfg(), silentLog);
    const result = await smtp.send({
      to: ["bob@example.com"],
      subject: "Empty arrays",
      text: "Body",
    });

    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([]);
  });

  it("close() resets the transporter after send() readies it", async () => {
    sendMailMock.mockResolvedValueOnce({
      messageId: "<close-test@local>",
      accepted: [],
      rejected: [],
      response: "250 OK",
    });

    const smtp = new SmtpClient(makeCfg(), silentLog);
    // Primero enviamos para que ensureConnected() cree el transporter
    await smtp.send({ to: ["bob@example.com"], subject: "s", text: "b" });
    // close() debe ejecutar el if (this.transporter) true branch
    expect(() => { smtp.close(); }).not.toThrow();
    // close() again with null transporter should be noop
    expect(() => { smtp.close(); }).not.toThrow();
  });

  it("close() noops when transporter is null", () => {
    const smtp = new SmtpClient(makeCfg(), silentLog);
    // Sin send() previo, this.transporter es null → entra en else implícito
    expect(() => { smtp.close(); }).not.toThrow();
  });

  it("send() twice — second call hits ensureConnected cache (transporter already set)", async () => {
    sendMailMock.mockResolvedValue({
      messageId: "<cache@local>",
      accepted: [],
      rejected: [],
      response: "250 OK",
    });

    const smtp = new SmtpClient(makeCfg(), silentLog);
    // Primera llamada: crea el transporter
    await smtp.send({ to: ["a@b.com"], subject: "First", text: "1" });
    // Segunda llamada: ensureConnected() ve transporter ya seteado → early return
    await smtp.send({ to: ["b@c.com"], subject: "Second", text: "2" });

    // sendMail debe haberse llamado dos veces (una por cada send())
    expect(sendMailMock).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// escapeHtml (internal helper)
// ---------------------------------------------------------------------------

describe("escapeHtml", () => {
  // Importamos via buildForwardOptions que usa escapeHtml internamente
  it("passes through plain characters (no MAP match → ?? c fallback)", async () => {
    const email: EmailFull = {
      ...baseEmail,
      htmlBody: undefined,
      textBody: "hello world plain text",
    };
    (mockImap as any).getEmail.mockResolvedValueOnce(email);
    // buildForwardOptions con HTML body → ejecuta escapeHtml(textBody) en htmlBody fallback
    const result = await buildForwardOptions(
      mockImap as any, "INBOX", 1, ["bob@example.com"], { html: "<b>Reply</b>" }, false,
    );
    expect(result!.html).toContain("hello world");
    expect(result!.html).toContain("<b>Reply</b>");
  });
});

// ---------------------------------------------------------------------------
// buildReplyOptions
// ---------------------------------------------------------------------------

const baseEmail: EmailFull = {
  uid: 1,
  seq: 1,
  messageId: "<msg-1@example.com>",
  from: "alice@example.com",
  to: ["me@proton.me"],
  cc: [],
  bcc: [],
  replyTo: [],
  subject: "Original subject",
  date: "Mon, 01 Jan 2026 10:00:00 +0000",
  flags: [],
  size: 100,
  textBody: "Original body text",
  htmlBody: undefined,
  attachments: [],
  headers: {},
};

const mockImap = {
  getEmail: vi.fn(),
  getAttachment: vi.fn(),
} as never;

describe("buildReplyOptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when original email not found", async () => {
    (mockImap as any).getEmail.mockResolvedValueOnce(null);
    const result = await buildReplyOptions({
      imap: mockImap as any, mailbox: "INBOX", uid: 42, body: { text: "Reply" }, includeQuote: false, replyAll: false, ownAddress: "me@proton.me",
    });
    expect(result).toBeNull();
  });

  it("builds reply options preserving thread", async () => {
    (mockImap as any).getEmail.mockResolvedValueOnce(baseEmail);
    const result = await buildReplyOptions({
      imap: mockImap as any, mailbox: "INBOX", uid: 1, body: { text: "Reply body" }, includeQuote: false, replyAll: false, ownAddress: "me@proton.me",
    });
    expect(result).not.toBeNull();
    expect(result!.to).toEqual(["alice@example.com"]);
    expect(result!.subject).toBe("Re: Original subject");
    expect(result!.inReplyTo).toBe("<msg-1@example.com>");
    expect(result!.references).toContain("<msg-1@example.com>");
  });

  it("uses replyTo when present", async () => {
    const email: EmailFull = {
      ...baseEmail,
      replyTo: ["reply@example.com"],
    };
    (mockImap as any).getEmail.mockResolvedValueOnce(email);
    const result = await buildReplyOptions({
      imap: mockImap as any, mailbox: "INBOX", uid: 1, body: { text: "Reply" }, includeQuote: false, replyAll: false, ownAddress: "me@proton.me",
    });
    expect(result!.to).toEqual(["reply@example.com"]);
  });

  it("replyAll adds cc excluding own address and existing to", async () => {
    const email: EmailFull = {
      ...baseEmail,
      to: ["me@proton.me", "bob@example.com"],
      cc: ["carol@example.com", "me@proton.me"],
    };
    (mockImap as any).getEmail.mockResolvedValueOnce(email);
    const result = await buildReplyOptions({
      imap: mockImap as any, mailbox: "INBOX", uid: 1, body: { text: "Reply" }, includeQuote: false, replyAll: true, ownAddress: "me@proton.me",
    });
    expect(result!.cc).toEqual(expect.arrayContaining(["carol@example.com"]));
    expect(result!.cc).not.toContain("me@proton.me");
  });

  it("replyAll with empty cc when none relevant", async () => {
    const email: EmailFull = {
      ...baseEmail,
      to: ["me@proton.me"],
      cc: [],
    };
    (mockImap as any).getEmail.mockResolvedValueOnce(email);
    const result = await buildReplyOptions({
      imap: mockImap as any, mailbox: "INBOX", uid: 1, body: { text: "Reply" }, includeQuote: false, replyAll: true, ownAddress: "me@proton.me",
    });
    expect(result!.cc).toEqual([]);
  });

  it("includes quote when includeQuote is true", async () => {
    (mockImap as any).getEmail.mockResolvedValueOnce(baseEmail);
    const result = await buildReplyOptions({
      imap: mockImap as any, mailbox: "INBOX", uid: 1, body: { text: "My reply" }, includeQuote: true, replyAll: false, ownAddress: "me@proton.me",
    });
    expect(result!.text).toContain("> Original body text");
    expect(result!.text).toContain("My reply");
  });

  it("includes html quote with html body", async () => {
    const email: EmailFull = {
      ...baseEmail,
      htmlBody: "<p>Original HTML</p>",
    };
    (mockImap as any).getEmail.mockResolvedValueOnce(email);
    const result = await buildReplyOptions({
      imap: mockImap as any, mailbox: "INBOX", uid: 1, body: { html: "<b>My HTML</b>" }, includeQuote: true, replyAll: false, ownAddress: "me@proton.me",
    });
    expect(result!.html).toContain("Original HTML");
    expect(result!.html).toContain("<b>My HTML</b>");
  });

  it("html quote falls back to escaped textBody in blockquote when no htmlBody", async () => {
    const email: EmailFull = {
      ...baseEmail,
      textBody: "Line 1\nLine 2",
      htmlBody: undefined,
    };
    (mockImap as any).getEmail.mockResolvedValueOnce(email);
    const result = await buildReplyOptions({
      imap: mockImap as any, mailbox: "INBOX", uid: 1, body: { html: "<b>Reply</b>" }, includeQuote: true, replyAll: false, ownAddress: "me@proton.me",
    });
    expect(result!.html).toContain("<b>Reply</b>");
    expect(result!.html).toContain("<blockquote");
    expect(result!.html).toContain("Line 1<br>Line 2");
  });

  it("html is undefined when body has no html and original has no htmlBody", async () => {
    (mockImap as any).getEmail.mockResolvedValueOnce(baseEmail);
    const result = await buildReplyOptions({
      imap: mockImap as any, mailbox: "INBOX", uid: 1, body: { text: "Plain only" }, includeQuote: true, replyAll: false, ownAddress: "me@proton.me",
    });
    expect(result!.html).toBeUndefined();
  });

  it("buildQuote handles undefined from/date/textBody with ?? fallbacks", async () => {
    const email: EmailFull = {
      ...baseEmail,
      from: undefined,
      date: undefined,
      textBody: undefined,
      htmlBody: undefined,
    };
    (mockImap as any).getEmail.mockResolvedValueOnce(email);
    // includeQuote: true + html body → buildQuote ejecuta ambos ?? de from, date, textBody
    const result = await buildReplyOptions({
      imap: mockImap as any, mailbox: "INBOX", uid: 1, body: { html: "<b>Reply</b>" }, includeQuote: true, replyAll: false, ownAddress: "me@proton.me",
    });
    expect(result!.text).toContain("On ,  wrote:"); // date??'' + from??'' → ambos vacíos
    expect(result!.html).toContain("<b>Reply</b>");
    expect(result!.html).toContain("<blockquote");
  });

  it("handles empty to when no replyTo and no from", async () => {
    const email: EmailFull = {
      ...baseEmail,
      from: undefined,
      replyTo: [],
    };
    (mockImap as any).getEmail.mockResolvedValueOnce(email);
    const result = await buildReplyOptions({
      imap: mockImap as any, mailbox: "INBOX", uid: 1, body: { text: "Reply" }, includeQuote: false, replyAll: false, ownAddress: "me@proton.me",
    });
    expect(result!.to).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildForwardOptions
// ---------------------------------------------------------------------------

describe("buildForwardOptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when original email not found", async () => {
    (mockImap as any).getEmail.mockResolvedValueOnce(null);
    const result = await buildForwardOptions(
      mockImap as any, "INBOX", 42, ["bob@example.com"], { text: "Forward" }, false,
    );
    expect(result).toBeNull();
  });

  it("builds forward options with subject prefix", async () => {
    (mockImap as any).getEmail.mockResolvedValueOnce(baseEmail);
    const result = await buildForwardOptions(
      mockImap as any, "INBOX", 1, ["bob@example.com"], { text: "FYI" }, false,
    );
    expect(result!.subject).toBe("Fwd: Original subject");
    expect(result!.to).toEqual(["bob@example.com"]);
    expect(result!.text).toContain("FYI");
    expect(result!.text).toContain("Forwarded message");
  });

  it("includes attachments when requested", async () => {
    const email: EmailFull = {
      ...baseEmail,
      attachments: [{ filename: "file.pdf", contentType: "application/pdf" }],
    };
    (mockImap as any).getEmail.mockResolvedValueOnce(email);
    (mockImap as any).getAttachment.mockResolvedValueOnce({
      base64: Buffer.from("att-content").toString("base64"),
    });

    const result = await buildForwardOptions(
      mockImap as any, "INBOX", 1, ["bob@example.com"], { text: "With att" }, true,
    );
    expect(result!.attachments).toHaveLength(1);
    expect(result!.attachments![0]!.filename).toBe("file.pdf");
  });

  it("skips attachments when includeAttachments is false", async () => {
    const email: EmailFull = {
      ...baseEmail,
      attachments: [{ filename: "file.pdf", contentType: "application/pdf" }],
    };
    (mockImap as any).getEmail.mockResolvedValueOnce(email);
    const result = await buildForwardOptions(
      mockImap as any, "INBOX", 1, ["bob@example.com"], { text: "No att" }, false,
    );
    expect(result!.attachments).toBeUndefined();
  });

  it("attachment without filename falls back to attachment-N", async () => {
    const email: EmailFull = {
      ...baseEmail,
      attachments: [{ contentType: "image/png" }], // sin filename
    };
    (mockImap as any).getEmail.mockResolvedValueOnce(email);
    (mockImap as any).getAttachment.mockResolvedValueOnce({
      base64: Buffer.from("img-data").toString("base64"),
    });

    const result = await buildForwardOptions(
      mockImap as any, "INBOX", 1, ["bob@example.com"], { text: "No filename" }, true,
    );
    expect(result!.attachments).toHaveLength(1);
    expect(result!.attachments![0]!.filename).toBe("attachment-0");
  });

  it("skips attachment when getAttachment returns null", async () => {
    const email: EmailFull = {
      ...baseEmail,
      attachments: [{ filename: "lost.pdf", contentType: "application/pdf" }],
    };
    (mockImap as any).getEmail.mockResolvedValueOnce(email);
    (mockImap as any).getAttachment.mockResolvedValueOnce(null);

    const result = await buildForwardOptions(
      mockImap as any, "INBOX", 1, ["bob@example.com"], { text: "Lost" }, true,
    );
    expect(result!.attachments).toBeUndefined();
  });

  it("includes html forward body when html provided", async () => {
    const email: EmailFull = {
      ...baseEmail,
      htmlBody: "<p>Original</p>",
    };
    (mockImap as any).getEmail.mockResolvedValueOnce(email);
    const result = await buildForwardOptions(
      mockImap as any, "INBOX", 1, ["bob@example.com"], { html: "<b>My HTML</b>" }, false,
    );
    expect(result!.html).toContain("<b>My HTML</b>");
  });

  it("forward body handles missing fields (?? fallbacks)", async () => {
    const email: EmailFull = {
      ...baseEmail,
      from: undefined,
      date: undefined,
      subject: undefined,
      textBody: undefined,
      htmlBody: undefined,
    };
    (mockImap as any).getEmail.mockResolvedValueOnce(email);
    const result = await buildForwardOptions(
      mockImap as any, "INBOX", 1, ["bob@example.com"], { text: "Forward" }, false,
    );
    expect(result!.subject).toBe("Fwd: ");
    expect(result!.text).toContain("Forward");
    expect(result!.text).toContain("Forwarded message");
    // html debe ser undefined porque body no tiene html y original no tiene htmlBody
    expect(result!.html).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// prefixSubject
// ---------------------------------------------------------------------------

describe("prefixSubject", () => {
  it("adds prefix when missing", () => {
    expect(prefixSubject("Hello", "Re: ")).toBe("Re: Hello");
  });

  it("does not duplicate prefix (case-insensitive)", () => {
    expect(prefixSubject("Re: Hello", "Re: ")).toBe("Re: Hello");
    expect(prefixSubject("RE: hello", "Re: ")).toBe("RE: hello");
    expect(prefixSubject("re: test", "Re: ")).toBe("re: test");
  });

  it("handles undefined subject", () => {
    expect(prefixSubject(undefined, "Fwd: ")).toBe("Fwd: ");
  });

  it("handles empty string subject", () => {
    expect(prefixSubject("", "Re: ")).toBe("Re: ");
  });

  it("trims whitespace", () => {
    expect(prefixSubject("  Hello  ", "Re: ")).toBe("Re: Hello");
  });

  it("handles Fwd: prefix", () => {
    expect(prefixSubject("Meeting notes", "Fwd: ")).toBe("Fwd: Meeting notes");
  });
});

// ---------------------------------------------------------------------------
// collectReferences
// ---------------------------------------------------------------------------

describe("collectReferences", () => {
  const base: EmailFull = {
    uid: 1,
    seq: 1,
    messageId: "<msg-3@example.com>",
    from: "a@example.com",
    to: [],
    cc: [],
    bcc: [],
    replyTo: [],
    subject: "s",
    date: undefined,
    flags: [],
    size: 0,
    textBody: "",
    htmlBody: undefined,
    attachments: [],
    headers: {},
  };

  it("collects References from header and appends current messageId", () => {
    const msg: EmailFull = { ...base, headers: { references: "<msg-1@x> <msg-2@x>" } };
    const refs = collectReferences(msg);
    expect(refs).toEqual(["<msg-1@x>", "<msg-2@x>", "<msg-3@example.com>"]);
  });

  it("returns only current messageId when no References header", () => {
    const refs = collectReferences(base);
    expect(refs).toEqual(["<msg-3@example.com>"]);
  });

  it("returns empty array when no References and no messageId", () => {
    const msg: EmailFull = { ...base, messageId: undefined };
    expect(collectReferences(msg)).toEqual([]);
  });

  it("handles empty string references header", () => {
    const msg: EmailFull = { ...base, headers: { references: "" } };
    const refs = collectReferences(msg);
    expect(refs).toEqual(["<msg-3@example.com>"]);
  });
});
