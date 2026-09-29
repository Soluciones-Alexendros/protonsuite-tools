export type BadgeKind = "ok" | "limit" | "idle";

export interface SuiteRow {
  name: string;
  badge: string;
  kind: BadgeKind;
  detail: string;
}

export interface PlanStep {
  summary: string;
  executes: false;
}

export interface DryRunPlan {
  title: string;
  mode: "dry-run";
  steps: readonly PlanStep[];
  note: string;
}

export interface EcoRow {
  name: string;
  badge: string;
  kind: BadgeKind;
  detail: string;
}

export interface ExampleSnapshot {
  source: "example";
  sourceLabel: "datos de ejemplo";
  observedOn: string;
  suite: readonly SuiteRow[];
  plan: DryRunPlan;
  ecosystem: readonly EcoRow[];
}

export const exampleSnapshot: ExampleSnapshot = {
  source: "example",
  sourceLabel: "datos de ejemplo",
  observedOn: "2026-09-24",
  suite: [
    {
      name: "Mail",
      badge: "ilustrativo",
      kind: "idle",
      detail: "Bandeja de ejemplo, sin cuerpos de correo. Bridge no se ha consultado.",
    },
    {
      name: "Pass",
      badge: "presencia",
      kind: "ok",
      detail: "Tres entradas de ejemplo. Solo se indica presencia: ningún valor.",
    },
    {
      name: "Drive",
      badge: "ilustrativo",
      kind: "idle",
      detail: "Carpeta sintética «notas-ejemplo». No hay listado real de la CLI.",
    },
    {
      name: "Calendar",
      badge: "stub",
      kind: "limit",
      detail: "No disponible hasta que Bridge exponga CalDAV (ADR-005). Esta pantalla no implementa CalDAV.",
    },
  ],
  plan: {
    title: "Organizar la bandeja de ejemplo",
    mode: "dry-run",
    steps: [
      {
        summary: "Clasificar tres asuntos sintéticos: recordatorio, nota y aviso de ejemplo.",
        executes: false,
      },
      {
        summary: "Proponer la carpeta «Revision» sin crearla.",
        executes: false,
      },
      {
        summary: "Dejar el informe en esta pantalla.",
        executes: false,
      },
    ],
    note: "Plan de ejemplo. La interfaz no lo envía al agente y no hay acción de aplicar.",
  },
  ecosystem: [
    {
      name: "pass",
      badge: "presente en el ejemplo",
      kind: "ok",
      detail: "No se ha ejecutado el binario.",
    },
    {
      name: "gopass",
      badge: "no comprobado",
      kind: "idle",
      detail: "El ejemplo no llama al sistema.",
    },
    {
      name: "proton-drive",
      badge: "ausente en el ejemplo",
      kind: "limit",
      detail: "No hay sesión de Drive en estos datos.",
    },
    {
      name: "proton-bridge",
      badge: "no comprobado",
      kind: "idle",
      detail: "La SPA no abre IMAP ni SMTP.",
    },
  ],
};
