// Shared branded loading screen. Game-specific artwork stays in game assets.
export function createPreloader() {
  // Adopt the initial HTML instead of replacing it after JavaScript arrives.
  // Custom launch pages supply inline styles and can omit the initial markup.
  let overlay = document.getElementById("preloader");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "preloader";
    overlay.setAttribute("role", "progressbar");
    overlay.setAttribute("aria-label", "G55.CO — Loading game");
    overlay.setAttribute("aria-valuemin", "0");
    overlay.setAttribute("aria-valuemax", "100");
    overlay.setAttribute("aria-valuenow", "0");
    overlay.setAttribute("aria-busy", "true");
    overlay.innerHTML = `<div class="preloader-panel">
      <span class="preloader-title" role="status">Loading</span><span id="preloaderText">0%</span>
      <div class="preloader-bar"><div id="preloaderFill"></div></div>
    </div>`;
    document.body.appendChild(overlay);
  }
  const panel = overlay.querySelector(".preloader-panel");
  let retry = overlay.querySelector("#preloaderRetry");
  if (!retry) {
    retry = document.createElement("button");
    retry.id = "preloaderRetry"; retry.type = "button"; retry.hidden = true;
    retry.textContent = "Reload Game";
    overlay.appendChild(retry);
  }
  const title = overlay.querySelector(".preloader-title");
  retry.onclick = () => document.defaultView.location.reload();
  const text = overlay.querySelector("#preloaderText"), fill = overlay.querySelector("#preloaderFill");
  let loading = true, percent = 0;
  function render(value) {
    text.textContent = value + "%";
    fill.style.transform = `scaleX(${value / 100})`;
    overlay.setAttribute("aria-valuenow", String(value));
  }
  return {
    setThumbnail(url) {
      if (!loading || !url) return;
      panel.style.backgroundImage = `url(${JSON.stringify(url)})`;
    },
    progress(value) {
      if (!loading || !Number.isFinite(value)) return;
      // Nested dependencies can increase the total. Reserve completion for
      // successful initialization, and never move the visible bar backwards.
      percent = Math.max(percent, Math.min(99, Math.round(value)));
      render(percent);
    },
    fail() {
      if (!loading) return;
      loading = false;
      overlay.setAttribute("role", "region");
      overlay.setAttribute("aria-label", "G55.CO — Loading failed");
      overlay.setAttribute("aria-busy", "false");
      for (const name of ["aria-valuemin", "aria-valuemax", "aria-valuenow"]) overlay.removeAttribute(name);
      overlay.classList.add("failed");
      title.setAttribute("role", "alert");
      title.textContent = "Loading failed";
      retry.hidden = false;
      retry.focus();
    },
    finish() {
      if (!loading) return;
      loading = false;
      render(100);
      overlay.setAttribute("aria-busy", "false");
      overlay.setAttribute("aria-hidden", "true");
      overlay.classList.add("hidden");
      document.defaultView.setTimeout(() => overlay.remove(), 400);
    }
  };
}
