(() => {
  const storageKey = "saashup_theme";
  const root = document.documentElement;
  const systemDark = () => window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const storedTheme = () => {
    try {
      return localStorage.getItem(storageKey);
    } catch {
      return "";
    }
  };
  const preferredTheme = () => {
    const stored = storedTheme();
    if (stored === "light" || stored === "dark") return stored;
    return systemDark() ? "dark" : "light";
  };
  const applyTheme = (theme) => {
    root.dataset.theme = theme;
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      button.setAttribute("aria-label", theme === "dark" ? "Use light theme" : "Use dark theme");
      button.setAttribute("title", theme === "dark" ? "Use light theme" : "Use dark theme");
      button.textContent = theme === "dark" ? "☀" : "☾";
    });
  };

  applyTheme(preferredTheme());

  document.addEventListener("DOMContentLoaded", () => {
    applyTheme(preferredTheme());

    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        const nextTheme = root.dataset.theme === "dark" ? "light" : "dark";
        try {
          localStorage.setItem(storageKey, nextTheme);
        } catch {
          // Keep the in-page toggle working even if storage is unavailable.
        }
        applyTheme(nextTheme);
      });
    });
  });
})();
