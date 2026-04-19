export type ThemeMode = "light" | "dark";

export const THEME_STORAGE_KEY = "manex-theme";
export const THEME_DARK_CLASS = "dark";

export function isThemeMode(value: string | null): value is ThemeMode {
  return value === "light" || value === "dark";
}

export const themeInitScript = `(() => {
  const storageKey = "${THEME_STORAGE_KEY}";
  const darkClass = "${THEME_DARK_CLASS}";
  const root = document.documentElement;
  const saved = window.localStorage.getItem(storageKey);
  const resolved =
    saved === "light" || saved === "dark"
      ? saved
      : window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";

  root.classList.toggle(darkClass, resolved === "dark");
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
})();`;
