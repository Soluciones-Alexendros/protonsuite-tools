function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function paragraph(className: string, text: string): HTMLParagraphElement {
  return el("p", className, text);
}

function section(id: string, className: string): HTMLElement {
  const node = document.createElement("section");
  node.id = id;
  node.className = className;
  return node;
}

const FEATURES: readonly { title: string; body: string }[] = [
  {
    title: "Frontera en Bridge",
    body: "El cifrado de Proton se queda en Bridge. Esta página no abre IMAP ni SMTP.",
  },
  {
    title: "Dry-run",
    body: "El agente no muta el buzón mientras el dry-run sigue activo. Aquí el plan solo se lee.",
  },
  {
    title: "Pass sin valores",
    body: "Igual que el cliente de Pass: se puede decir que una entrada existe, nunca qué contiene.",
  },
  {
    title: "Proceso aparte",
    body: "El MCP conserva stdout para JSON-RPC. Esta SPA no entra en ese proceso.",
  },
];

const FUNCTIONS: readonly { title: string; body: string }[] = [
  {
    title: "Correo",
    body: "Tools MCP de Mail cuando el agente corre junto a Bridge. No desde esta página.",
  },
  {
    title: "Pass",
    body: "Auditoría y plan de rotación en seco, con pass o gopass.",
  },
  {
    title: "Drive",
    body: "Listado y auditoría por la CLI oficial proton-drive, fuera de esta SPA.",
  },
  {
    title: "Alertas",
    body: "El agente puede escribir a fichero, webhook o ntfy. El panel no las dispara.",
  },
  {
    title: "Panel local",
    body: "Estado de suite, plan de ejemplo y salud de ecosistema, con datos de ejemplo.",
  },
];

const ROADMAP: readonly { title: string; body: string }[] = [
  {
    title: "Calendar sigue en stub.",
    body: "Hasta que Bridge exponga CalDAV (ADR-005). Esta SPA no implementa CalDAV.",
  },
  {
    title: "Sin VPS.",
    body: "No hay servicio remoto que mantener: se abre el build estático en local.",
  },
  {
    title: "Sin dashboard de alertas.",
    body: "Esa pieza sigue fuera. Aquí solo hay lectura de un ejemplo.",
  },
];

function cardGrid(items: readonly { title: string; body: string }[]): HTMLDivElement {
  const grid = el("div", "grid");
  for (const item of items) {
    const card = el("article", "card");
    card.append(el("h3", "", item.title), paragraph("", item.body));
    grid.append(card);
  }
  return grid;
}

function bulletList(items: readonly { title: string; body: string }[]): HTMLUListElement {
  const list = document.createElement("ul");
  list.className = "plain-list";
  for (const item of items) {
    const li = document.createElement("li");
    const title = document.createElement("strong");
    title.textContent = item.title;
    li.append(title, document.createTextNode(` ${item.body}`));
    list.append(li);
  }
  return list;
}

export function renderLanding(parent: HTMLElement): void {
  const propuesta = section("propuesta", "section");
  const h1 = document.createElement("h1");
  h1.textContent = "Herramientas MCP y CLI para Proton, en local.";
  propuesta.append(
    h1,
    paragraph(
      "lead",
      "Proton Suite Agent habla con Mail, Pass y Drive desde tu máquina: Bridge como frontera y CLIs para el resto. Esta página presenta el contrato. No arranca el agente.",
    ),
  );

  const caracteristicas = section("caracteristicas", "section");
  const h2c = document.createElement("h2");
  h2c.textContent = "Características";
  caracteristicas.append(
    h2c,
    paragraph("", "Límites que la interfaz respeta, también cuando el agente no está en marcha."),
    cardGrid(FEATURES),
  );

  const funcionalidades = section("funcionalidades", "section");
  const h2f = document.createElement("h2");
  h2f.textContent = "Funcionalidades";
  funcionalidades.append(
    h2f,
    paragraph("", "Lo que el binario ya cubre, y lo que esta SPA solo ilustra."),
    bulletList(FUNCTIONS),
  );

  const roadmap = section("roadmap", "section");
  const h2r = document.createElement("h2");
  h2r.textContent = "Roadmap";
  roadmap.append(
    h2r,
    paragraph("", "Estado honesto. Lo que no está, no se simula como si lo estuviera."),
    bulletList(ROADMAP),
  );

  const cierre = section("cierre", "section cierre");
  const h2z = document.createElement("h2");
  h2z.textContent = "Cierre";
  const cta = document.createElement("a");
  cta.className = "button";
  cta.href = "#panel";
  cta.textContent = "Ver el panel de estado";
  cierre.append(
    h2z,
    paragraph(
      "",
      "Abre el build estático (apps/web/dist) sin MCP y sin Bridge. Para automatizar sigue haciendo falta el binario. El panel usa datos de ejemplo y no pide credenciales.",
    ),
    cta,
  );

  parent.append(propuesta, caracteristicas, funcionalidades, roadmap, cierre);
}
