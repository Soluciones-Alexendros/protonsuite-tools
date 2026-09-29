export type ThemeChoice = "light" | "dark" | "system";

const STORAGE_KEY = "protonsuite-theme";

export function readChoice(): ThemeChoice {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {
    /* Origen opaco (file://) u origen sin almacenamiento. */
  }
  return "system";
}

export function applyTheme(choice: ThemeChoice): void {
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const mode = choice === "system" ? (dark ? "dark" : "light") : choice;
  document.documentElement.dataset["theme"] = mode;
  try {
    localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    /* Sin almacenamiento: el tema vive solo en esta carga. */
  }
}

export function initTheme(): void {
  applyTheme(readChoice());
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (readChoice() === "system") applyTheme("system");
  });
}

export function renderThemeControl(): HTMLFieldSetElement {
  const field = document.createElement("fieldset");
  field.className = "theme";
  const legend = document.createElement("legend");
  legend.textContent = "Tema";
  field.append(legend);

  const choice = readChoice();
  const options: readonly { value: ThemeChoice; label: string }[] = [
    { value: "light", label: "Claro" },
    { value: "dark", label: "Oscuro" },
    { value: "system", label: "Sistema" },
  ];

  for (const option of options) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "tema";
    input.value = option.value;
    input.checked = choice === option.value;
    input.addEventListener("change", () => {
      if (input.checked) applyTheme(option.value);
    });
    label.append(input, document.createTextNode(option.label));
    field.append(label);
  }
  return field;
}
