import { renderLanding } from "./landing";
import { renderPanel } from "./panel";
import { initTheme, renderThemeControl } from "./theme";
import "./styles/generated-tokens.css";
import "./styles/app.css";

type RouteId = "inicio" | "panel";

const NAV: readonly { href: string; id: string; label: string }[] = [
  { href: "#inicio", id: "inicio", label: "Inicio" },
  { href: "#caracteristicas", id: "caracteristicas", label: "Características" },
  { href: "#funcionalidades", id: "funcionalidades", label: "Funcionalidades" },
  { href: "#roadmap", id: "roadmap", label: "Roadmap" },
  { href: "#panel", id: "panel", label: "Estado" },
];

function parseHash(): { route: RouteId; section: string | null } {
  const raw = location.hash.replace(/^#/, "");
  if (raw === "panel") return { route: "panel", section: null };
  if (raw === "" || raw === "inicio") return { route: "inicio", section: null };
  return { route: "inicio", section: raw };
}

function isCurrent(id: string, route: RouteId, section: string | null): boolean {
  if (id === "panel") return route === "panel";
  if (route !== "inicio") return false;
  if (section) return id === section;
  return id === "inicio";
}

function renderSkip(): HTMLAnchorElement {
  const link = document.createElement("a");
  link.className = "skip";
  link.href = "#contenido";
  link.textContent = "Saltar al contenido";
  return link;
}

function renderHeader(route: RouteId, section: string | null): HTMLElement {
  const header = document.createElement("header");
  header.className = "site-header";
  const wrap = document.createElement("div");
  wrap.className = "wrap top";

  const brand = document.createElement("div");
  brand.className = "brand";
  const mark = document.createElement("span");
  mark.className = "mark";
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = "p";
  const word = document.createElement("p");
  word.className = "wordmark";
  const home = document.createElement("a");
  home.href = "#inicio";
  home.textContent = "protonsuite";
  word.append(home);
  brand.append(mark, word);

  const nav = document.createElement("nav");
  nav.setAttribute("aria-label", "Secciones");
  for (const item of NAV) {
    const link = document.createElement("a");
    link.href = item.href;
    link.textContent = item.label;
    if (isCurrent(item.id, route, section)) link.setAttribute("aria-current", "page");
    nav.append(link);
  }

  wrap.append(brand, nav, renderThemeControl());
  header.append(wrap);
  return header;
}

function renderMain(route: RouteId): HTMLElement {
  const main = document.createElement("main");
  main.id = "contenido";
  main.tabIndex = -1;
  main.className = "wrap";
  if (route === "panel") renderPanel(main);
  else renderLanding(main);
  return main;
}

function renderFooter(): HTMLElement {
  const footer = document.createElement("footer");
  footer.className = "site-footer";
  const wrap = document.createElement("div");
  wrap.className = "wrap";
  const text = document.createElement("p");
  text.textContent =
    "Proton Suite Agent. Sin afiliación a Proton AG. Licencia AGPL-3.0. Esta página no envía datos.";
  wrap.append(text);
  footer.append(wrap);
  return footer;
}

function paint(fromHash: boolean, previous: RouteId | null): RouteId {
  const parsed = parseHash();
  const app = document.querySelector("#app");
  if (!app) return parsed.route;
  const routeChanged = previous !== null && previous !== parsed.route;
  document.title =
    parsed.route === "panel" ? "protonsuite — panel de estado" : "protonsuite — herramientas locales";
  app.replaceChildren(renderSkip(), renderHeader(parsed.route, parsed.section), renderMain(parsed.route), renderFooter());
  if (parsed.section) {
    document.getElementById(parsed.section)?.scrollIntoView();
  } else if (fromHash) {
    window.scrollTo(0, 0);
  }
  if (routeChanged) document.getElementById("contenido")?.focus();
  return parsed.route;
}

initTheme();

let route: RouteId | null = null;
route = paint(false, route);
window.addEventListener("hashchange", () => {
  route = paint(true, route);
});
