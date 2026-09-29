import { loadSnapshot } from "./adapter";
import type { BadgeKind } from "./example-data";

function badge(kind: BadgeKind, text: string): HTMLSpanElement {
  const node = document.createElement("span");
  node.className = `badge badge-${kind}`;
  node.textContent = text;
  return node;
}

export function renderPanel(parent: HTMLElement): void {
  const snapshot = loadSnapshot();

  const h1 = document.createElement("h1");
  h1.textContent = "Panel de estado";

  const banner = document.createElement("p");
  banner.className = "banner";
  banner.setAttribute("role", "status");
  banner.textContent = `Adaptador local: ${snapshot.sourceLabel}. No conectado a MCP ni a Bridge. No se ejecutan mutaciones. Fecha del ejemplo: ${snapshot.observedOn}.`;

  const suite = document.createElement("section");
  suite.className = "section";
  const h2suite = document.createElement("h2");
  h2suite.textContent = "Estado de la suite";
  const grid = document.createElement("div");
  grid.className = "grid";
  for (const row of snapshot.suite) {
    const card = document.createElement("article");
    card.className = "card";
    const head = document.createElement("div");
    head.className = "card-head";
    const h3 = document.createElement("h3");
    h3.textContent = row.name;
    head.append(h3, badge(row.kind, row.badge));
    const detail = document.createElement("p");
    detail.textContent = row.detail;
    card.append(head, detail);
    grid.append(card);
  }
  suite.append(h2suite, grid);

  const plan = document.createElement("section");
  plan.className = "section";
  const h2plan = document.createElement("h2");
  h2plan.textContent = "Plan en dry-run";
  const planCard = document.createElement("article");
  planCard.className = "card";
  const planTitle = document.createElement("h3");
  planTitle.textContent = snapshot.plan.title;
  const mode = document.createElement("p");
  mode.textContent = `Modo ${snapshot.plan.mode}. Ningún paso sale de esta página.`;
  const steps = document.createElement("ol");
  for (const step of snapshot.plan.steps) {
    const li = document.createElement("li");
    li.textContent = step.executes ? step.summary : `${step.summary} No se ejecuta.`;
    steps.append(li);
  }
  const note = document.createElement("p");
  note.textContent = snapshot.plan.note;
  planCard.append(planTitle, mode, steps, note);
  plan.append(h2plan, planCard);

  const eco = document.createElement("section");
  eco.className = "section";
  const h2eco = document.createElement("h2");
  h2eco.textContent = "Salud del ecosistema";
  const table = document.createElement("table");
  const caption = document.createElement("caption");
  caption.className = "sr-only";
  caption.textContent = "Piezas del ecosistema con datos de ejemplo, sin ejecutar binarios";
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const label of ["Pieza", "Estado", "Nota"]) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = label;
    headRow.append(th);
  }
  thead.append(headRow);
  const tbody = document.createElement("tbody");
  for (const row of snapshot.ecosystem) {
    const tr = document.createElement("tr");
    const name = document.createElement("th");
    name.scope = "row";
    name.textContent = row.name;
    const state = document.createElement("td");
    state.append(badge(row.kind, row.badge));
    const detail = document.createElement("td");
    detail.textContent = row.detail;
    tr.append(name, state, detail);
    tbody.append(tr);
  }
  table.append(caption, thead, tbody);
  const back = document.createElement("a");
  back.className = "button button-secondary";
  back.href = "#inicio";
  back.textContent = "Volver a la landing";
  eco.append(h2eco, table, back);

  parent.append(h1, banner, suite, plan, eco);
}
