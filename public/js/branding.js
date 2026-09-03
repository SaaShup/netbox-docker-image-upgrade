
(() => {
  const storageKey = "saashup_page_branding";
  const cached = (() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey) || "null");
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  })();
  if (!cached) return;

  const text = (value) => (typeof value === "string" ? value.trim() : "");
  const themeCss = text(cached.themeCss);
  const logo = text(cached.logo);
  const background = text(cached.background);
  const welcome = text(cached.welcome);
  const footer = text(cached.footer);
  const url = /^https?:\/\/\S+$/i.test(text(cached.url)) ? text(cached.url) : "";

  if (themeCss) {
    const style = document.createElement("style");
    style.id = "brandThemeStyle";
    style.textContent = themeCss;
    document.head.appendChild(style);
  }

  if (logo) {
    const favicon = document.querySelector('link[rel="icon"]');
    if (favicon) {
      if (favicon.dataset.defaultHref === undefined) favicon.dataset.defaultHref = favicon.getAttribute("href") || "";
      favicon.href = logo;
    }
  }

  const customerName = text(cached.customerName);
  if (customerName) {
    const path = location.pathname;
    document.title = path.startsWith("/enroll") ? `Enroll ${customerName}`
      : path.startsWith("/catalog") ? `${customerName} Catalog`
      : `Order ${customerName}`;
  }

  const hideRules = [];
  if (logo) {
    hideRules.push(".top-left-bar .brand-badge img { visibility: hidden; }");
    hideRules.push(".top-left-bar .brand-badge span { display: none; }");
  }
  if (footer) hideRules.push("[data-brand-footer] { visibility: hidden; }");
  let hideStyle = null;
  if (hideRules.length) {
    hideStyle = document.createElement("style");
    hideStyle.textContent = hideRules.join("\n");
    document.head.appendChild(hideStyle);
  }
  const unmask = () => {
    hideStyle?.remove();
    hideStyle = null;
  };

  let bodyDone = false;
  let badgeDone = false;
  let footerDone = false;

  const applyPending = () => {
    if (!bodyDone && document.body) {
      bodyDone = true;
      if (logo) {
        document.body.style.setProperty("--brand-watermark", `url("${encodeURI(logo)}")`);
        document.body.classList.add("brand-watermark");
      }
      if (background) {
        document.body.style.setProperty("--brand-bg-image", `url("${encodeURI(background)}")`);
        document.body.classList.add("brand-bg");
      }
    }

    if (!badgeDone) {
      const badge = document.querySelector(".top-left-bar .brand-badge");
      if (badge) {
        badgeDone = true;
        if (badge.dataset.defaultHref === undefined) badge.dataset.defaultHref = badge.getAttribute("href") || "";
        if (url) badge.setAttribute("href", url);
        const badgeImage = badge.querySelector("img");
        if (badgeImage) {
          if (badgeImage.dataset.defaultSrc === undefined) badgeImage.dataset.defaultSrc = badgeImage.getAttribute("src") || "";
          if (logo) badgeImage.src = logo;
        }
        if (logo) {
          badge.classList.add("brand-badge-custom");
          // The custom logo hides the badge text, which was the link's
          // accessible name, so the branded badge needs an explicit label.
          let host = "";
          try { host = url ? new URL(url).hostname : ""; } catch { /* keep fallback */ }
          badge.setAttribute("aria-label", host || "Website");
        }
      }
    }

    if (!footerDone) {
      const footerBrand = document.querySelector("[data-brand-footer]");
      if (footerBrand) {
        footerDone = true;
        if (footerBrand.dataset.defaultText === undefined) footerBrand.dataset.defaultText = footerBrand.textContent;
        if (footer) footerBrand.textContent = footer;
      }
    }

    if (welcome) {
      const welcomeEl = document.getElementById("brandWelcome");
      if (welcomeEl && welcomeEl.classList.contains("hidden")) {
        welcomeEl.textContent = welcome;
        welcomeEl.classList.remove("hidden");
      }
    }

    if (badgeDone && footerDone) unmask();
    return bodyDone && badgeDone && footerDone;
  };

  if (!applyPending() && typeof MutationObserver === "function") {
    const observer = new MutationObserver(() => {
      if (applyPending()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener("DOMContentLoaded", () => {
      applyPending();
      unmask();
      observer.disconnect();
    });
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      applyPending();
      unmask();
    });
  }
})();
