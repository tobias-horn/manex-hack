"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  isThemeMode,
  THEME_DARK_CLASS,
  THEME_STORAGE_KEY,
  type ThemeMode,
} from "@/lib/theme";

function resolveTheme(): ThemeMode {
  const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);

  if (isThemeMode(savedTheme)) {
    return savedTheme;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: ThemeMode) {
  const root = document.documentElement;
  root.classList.toggle(THEME_DARK_CLASS, theme === "dark");
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeMode | null>(null);

  useEffect(() => {
    const syncTheme = () => {
      const resolvedTheme = resolveTheme();
      applyTheme(resolvedTheme);
      setTheme(resolvedTheme);
    };

    syncTheme();

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemThemeChange = () => {
      const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);

      if (!isThemeMode(savedTheme)) {
        syncTheme();
      }
    };

    mediaQuery.addEventListener("change", handleSystemThemeChange);
    return () => mediaQuery.removeEventListener("change", handleSystemThemeChange);
  }, []);

  const resolvedTheme = theme ?? "light";
  const nextTheme: ThemeMode = resolvedTheme === "dark" ? "light" : "dark";

  function toggleTheme() {
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    applyTheme(nextTheme);
    setTheme(nextTheme);
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={toggleTheme}
      aria-label={`Switch to ${nextTheme} mode`}
      title={`Switch to ${nextTheme} mode`}
      className="glass-panel h-10 rounded-full px-3 text-foreground shadow-[var(--ambient-shadow)]"
    >
      {resolvedTheme === "dark" ? (
        <Sun className="size-4" />
      ) : (
        <Moon className="size-4" />
      )}
      <span className="hidden sm:inline">
        {resolvedTheme === "dark" ? "Light mode" : "Dark mode"}
      </span>
    </Button>
  );
}
