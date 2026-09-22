(() => {
  "use strict";

  // The page works as a normal link even when this enhancement cannot start.
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      document.querySelectorAll(".destination-details[open]").forEach((details) => {
        details.open = false;
      });
    }
  });

  const seconds = Number(document.body.dataset.seconds);
  if (document.body.dataset.interstitial !== "true" || !Number.isInteger(seconds) || seconds <= 0 || seconds > 60) return;

  const ids = ["pause-button", "pause-symbol", "pause-label", "timer-number", "timer-label", "ring-progress", "progress-fill", "continue-link", "status-message"];
  const elements = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
  if (ids.some((id) => !elements[id])) return;

  const button = elements["pause-button"];
  const countdown = document.querySelector(".countdown-state");
  const copy = button.dataset;
  const duration = seconds * 1000;
  let remaining = duration;
  let startedAt = performance.now();
  let paused = false;
  let leaving = false;
  let timer;

  function clearTimer() {
    window.clearTimeout(timer);
    timer = undefined;
  }

  function updateRemaining() {
    const now = performance.now();
    remaining = Math.max(0, remaining - (now - startedAt));
    startedAt = now;
  }

  function render() {
    const fraction = Math.max(0, Math.min(1, remaining / duration));
    document.body.classList.toggle("is-paused", paused);
    elements["progress-fill"].style.transform = `scaleX(${fraction})`;
    elements["ring-progress"].style.strokeDashoffset = String(81.6814 * (1 - fraction));
    elements["timer-number"].textContent = paused ? "Ⅱ" : String(Math.ceil(remaining / 1000));
    elements["timer-label"].textContent = paused ? copy.paused : copy.secondsLabel;
    elements["pause-symbol"].textContent = paused ? "▷" : "Ⅱ";
    elements["pause-label"].textContent = paused ? copy.resume : copy.pause;
    button.setAttribute("aria-pressed", String(paused));
    if (countdown) countdown.setAttribute("aria-label", paused ? copy.pausedStatus : `${Math.ceil(remaining / 1000)} ${copy.secondsLabel}`);
  }

  function tick() {
    if (paused || leaving) return;
    updateRemaining();
    render();
    if (remaining <= 0) {
      leaving = true;
      clearTimer();
      // The server owns the destination. Query parameters never override it.
      window.location.replace(elements["continue-link"].href);
      return;
    }
    timer = window.setTimeout(tick, Math.min(50, remaining));
  }

  function pause(announce = true) {
    if (!paused && !leaving) updateRemaining();
    paused = true;
    clearTimer();
    render();
    if (announce) elements["status-message"].textContent = copy.pausedStatus;
  }

  function resume() {
    if (leaving) return;
    paused = false;
    startedAt = performance.now();
    elements["status-message"].textContent = copy.resumedStatus;
    tick();
  }

  button.addEventListener("click", () => paused ? resume() : pause());
  window.addEventListener("pagehide", () => pause(false));
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    // Back navigation must leave the visitor time to decide what to do next.
    leaving = false;
    pause();
  });

  render();
  button.hidden = false;
  tick();
})();
