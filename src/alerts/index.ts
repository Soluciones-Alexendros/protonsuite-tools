import { mkdir } from "node:fs/promises";
import type { Config } from "../config.js";
import { FileAlertSink } from "./file.js";
import { NtfyAlertSink } from "./ntfy.js";
import { SEVERITY_RANK, type AlertEvent, type AlertSeverity, type AlertSink } from "./types.js";
import { WebhookAlertSink } from "./webhook.js";

export type { AlertEvent, AlertSeverity } from "./types.js";
export { classifyEmail, detectThreats, inferStateLabels } from "./rules.js";

export interface Logger {
  error: (msg: string, extra?: unknown) => void;
  warn: (msg: string, extra?: unknown) => void;
  info: (msg: string, extra?: unknown) => void;
  debug: (msg: string, extra?: unknown) => void;
}

export class AlertSystem {
  private readonly fileSink: FileAlertSink;
  private readonly sinks: AlertSink[] = [];
  private readonly minRank: number;
  /** Escrituras de auditoría en curso, para poder drenarlas al apagar. */
  private readonly pendientes = new Set<Promise<boolean>>();

  constructor(
    private readonly cfg: Config["alerts"],
    private readonly log: Logger,
  ) {
    this.fileSink = new FileAlertSink(cfg.logDir);
    this.sinks.push(this.fileSink);
    this.minRank = SEVERITY_RANK[cfg.minSeverity];
    if (cfg.webhookUrl) {
      this.sinks.push(new WebhookAlertSink(cfg.webhookUrl));
    }
    if (cfg.ntfy?.url && cfg.ntfy.topic) {
      this.sinks.push(
        new NtfyAlertSink(cfg.ntfy.url, cfg.ntfy.topic, cfg.ntfy.token),
      );
    }
  }

  async init(): Promise<void> {
    await mkdir(this.cfg.logDir, { recursive: true });
  }

  emit(severity: AlertSeverity, category: string, message: string, source: string, context?: Record<string, unknown>): void {
    if (!this.cfg.enabled) return;
    const event: AlertEvent = {
      severity,
      category,
      message,
      timestamp: new Date().toISOString(),
      source,
      ...(context !== undefined ? { context } : {}),
    };

    // Always log to stderr if the base logger level permits (info and above).
    this.log.info("alert", event);

    // File and webhook only for configured minimum severity.
    if (SEVERITY_RANK[severity] < this.minRank) return;

    for (const sink of this.sinks) {
      const result = sink.emit(event);
      if (result instanceof Promise) {
        void result.catch((err: unknown) => {
          this.log.error("alert sink failed", { error: String(err) });
        });
      }
    }
  }

  info(category: string, message: string, source: string, context?: Record<string, unknown>): void {
    this.emit("info", category, message, source, context);
  }

  warning(category: string, message: string, source: string, context?: Record<string, unknown>): void {
    this.emit("warning", category, message, source, context);
  }

  alert(category: string, message: string, source: string, context?: Record<string, unknown>): void {
    this.emit("alert", category, message, source, context);
  }

  critical(category: string, message: string, source: string, context?: Record<string, unknown>): void {
    this.emit("critical", category, message, source, context);
  }

  /**
   * Registro de auditoría.
   *
   * Devuelve una promesa que resuelve a `true` si la entrada quedó escrita. Antes
   * era «best effort» y se tragaba el error: si el disco estaba lleno o el
   * directorio no existía, la operación se ejecutaba y no quedaba rastro, sin que
   * nadie se enterara (hallazgo F42).
   *
   * Quien necesite garantía debe esperar el resultado. Para las operaciones de
   * riesgo, el motor de autorización ya lo exige antes del efecto.
   */
  audit(
    action: string,
    source: string,
    context?: Record<string, unknown>,
  ): Promise<boolean> {
    const event: AlertEvent = {
      severity: "info",
      category: "audit",
      message: action,
      timestamp: new Date().toISOString(),
      source,
      ...(context !== undefined ? { context } : {}),
    };

    const pendiente = this.writeAudit(event);
    this.pendientes.add(pendiente);
    void pendiente.finally(() => {
      this.pendientes.delete(pendiente);
    });
    return pendiente;
  }

  private async writeAudit(event: AlertEvent): Promise<boolean> {
    try {
      await this.fileSink.emit(event);
      return true;
    } catch (err) {
      // Visible, no silenciado: un fallo de auditoría es un incidente.
      this.log.error("audit sink failed", {
        action: event.message,
        source: event.source,
        error: String(err),
      });
      return false;
    }
  }

  /**
   * Espera a que terminen las escrituras de auditoría en curso.
   *
   * Se llama al apagar, para no perder las últimas entradas.
   */
  async flush(): Promise<void> {
    while (this.pendientes.size > 0) {
      await Promise.allSettled([...this.pendientes]);
    }
  }
}
