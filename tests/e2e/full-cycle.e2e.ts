/**
 * E2E real (sin mocks) contra un servidor IMAP/SMTP de verdad: GreenMail.
 *
 * Ejercita el ciclo completo a través de los clientes REALES `ImapClient` y
 * `SmtpClient`, no a través de stubs: enviar por SMTP, esperar la entrega,
 * leer por IMAP, marcar, mover entre carpetas y borrar. Es la prueba que el
 * unit-test mockeado no puede dar — descubre fricciones de protocolo reales
 * (fue así como se detectó que el SMTP estaba cableado a STARTTLS-only).
 *
 * Requiere un GreenMail accesible (CI: service container; local:
 * `scripts/e2e-greenmail.sh`). Config vía env GREENMAIL_HOST/IMAP_PORT/SMTP_PORT.
 * GreenMail corre con auth deshabilitada → auto-crea el usuario al primer uso.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ImapClient } from "../../src/imap.js";
import { SmtpClient } from "../../src/smtp.js";

const HOST = process.env.GREENMAIL_HOST ?? "127.0.0.1";
const IMAP_PORT = Number(process.env.GREENMAIL_IMAP_PORT ?? 3143);
const SMTP_PORT = Number(process.env.GREENMAIL_SMTP_PORT ?? 3025);
const USER = "e2e@local";

const bridge = {
  user: USER,
  pass: "e2e-secret",
  passwordResolver: () => Promise.resolve("e2e-secret"),
  host: HOST,
  imapPort: IMAP_PORT,
  smtpPort: SMTP_PORT,
  from: USER,
  tlsInsecure: true,
  // GreenMail 2.1.x no anuncia STARTTLS en IMAP :3143 ni lo exige en SMTP
  // :3025. Producción sigue en starttls (F34); el harness usa plain.
  imapSecurity: "plain",
  smtpSecurity: "plain",
} as any;

const silentLog = { error() {}, warn() {}, info() {}, debug() {} };
const imap = new ImapClient(bridge, silentLog as never);
const smtp = new SmtpClient(bridge, silentLog as never);

// Subject único por proceso para no colisionar con corridas previas en el
// mismo GreenMail (el INBOX acumula entre tests).
const tag = `E2E-${process.pid}`;

/** Espera (poll) a que aparezca un email con `subject` en INBOX y devuelve su UID. */
async function waitForUid(subject: string, tries = 40): Promise<number> {
  for (let i = 0; i < tries; i++) {
    const { items } = await imap.listEmails("INBOX", 50, 0);
    const hit = items.find((m) => m.subject === subject);
    if (hit) return hit.uid;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timeout esperando el email "${subject}" en INBOX`);
}

beforeAll(async () => {
  // Falla ruidosamente si GreenMail no está accesible: en CI eso ES un fallo,
  // no un skip silencioso (que daría falso verde).
  try {
    await imap.listMailboxes();
  } catch (err) {
    throw new Error(
      `GreenMail no accesible en ${HOST}:${IMAP_PORT} — ${(err as Error).message}. ` +
        `Lanza 'scripts/e2e-greenmail.sh' o el service container de CI.`,
    );
  }
});

afterAll(async () => {
  await imap.close().catch(() => {});
  smtp.close();
});

describe("E2E · ciclo completo contra GreenMail", () => {
  it("envía por SMTP y el mensaje llega y se lee íntegro por IMAP", async () => {
    const subject = `${tag} read`;
    const res = await smtp.send({
      to: [USER],
      subject,
      text: "cuerpo íntegro de prueba E2E",
    });
    expect(res.accepted).toContain(USER);

    const uid = await waitForUid(subject);
    const full = await imap.getEmail("INBOX", uid);
    expect(full).not.toBeNull();
    expect(full!.subject).toBe(subject);
    expect(full!.from).toContain(USER);
    expect(full!.textBody?.trim()).toBe("cuerpo íntegro de prueba E2E");
  });

  it("marca como leído y como no leído (flags reales)", async () => {
    const subject = `${tag} flag`;
    await smtp.send({ to: [USER], subject, text: "flag" });
    const uid = await waitForUid(subject);

    expect(await imap.setFlags("INBOX", uid, ["\\Seen"], [])).toBe(true);
    let full = await imap.getEmail("INBOX", uid);
    expect(full!.flags).toContain("\\Seen");

    expect(await imap.setFlags("INBOX", uid, [], ["\\Seen"])).toBe(true);
    full = await imap.getEmail("INBOX", uid);
    expect(full!.flags).not.toContain("\\Seen");
  });

  it("crea carpeta, mueve el mensaje y cuadra los conteos", async () => {
    const folder = `${tag}-Archivo`;
    await imap.createMailbox(folder).catch(() => {});
    const subject = `${tag} move`;
    await smtp.send({ to: [USER], subject, text: "move" });
    const uid = await waitForUid(subject);

    const before = await imap.mailboxStatus(folder).catch(() => ({ messages: 0 }));
    expect(await imap.moveEmail("INBOX", uid, folder)).toBe(true);
    const after = await imap.mailboxStatus(folder);
    expect(after.messages).toBe(before.messages + 1);
  });

  it("borra a Trash (fallback de resolveTrashPath) y luego permanente", async () => {
    await imap.createMailbox("Trash").catch(() => {});
    const subject = `${tag} delete`;
    await smtp.send({ to: [USER], subject, text: "delete" });
    const uid = await waitForUid(subject);

    // GreenMail no expone special-use \Trash → resolveTrashPath cae al literal
    // "Trash" creado arriba. Se ejercita moviendo el mensaje allí.
    expect(await imap.moveEmail("INBOX", uid, "Trash")).toBe(true);
    const { items } = await imap.listEmails("Trash", 50, 0);
    const inTrash = items.find((m) => m.subject === subject);
    expect(inTrash).toBeTruthy();

    // Borrado permanente (expunge) sobre el que está en Trash.
    expect(await imap.deleteEmail("Trash", inTrash!.uid)).toBe(true);
  });
});
