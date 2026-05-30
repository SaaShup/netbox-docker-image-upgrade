async function loadAppVersion() {
  const targets = document.querySelectorAll("[data-app-version]");
  if (!targets.length) return;

  try {
    const response = await fetch("/version", {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) return;

    const data = await response.json();
    const version = data.version ? `v${data.version}` : "";
    if (!version) return;

    targets.forEach((target) => {
      target.textContent = version;
    });
  } catch {
    // The footer is decorative; keep the page usable if version lookup fails.
  }
}

loadAppVersion();
