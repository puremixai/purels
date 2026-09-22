/* Standalone interaction prototype. Navigation ends on a local demo page. */
(() => {
  "use strict";
  const params = new URLSearchParams(window.location.search);
  const review = params.get("review") === "1";
  const preview = params.get("mode") === "preview";
  const english = params.get("lang") === "en";
  const artworks = window.GALLERY_ARTWORKS;
  const $ = (id) => document.getElementById(id);
  const copy = english ? {
    album: "The passing gallery", tagline: "A little art before you arrive.",
    reinterpretation: "Masterpieces, reimagined in pixels", encounter: "YOUR CHANCE ENCOUNTER",
    medium: "Medium", collection: "Collection", oneAtATime: "A different encounter along the way.",
    destination: "YOUR DESTINATION", fullAddress: "View full destination address", continue: "Continue now",
    imageError: "The artwork could not load. You can still continue to your destination.",
    seconds: "seconds to go", paused: "Take your time", pause: "Stay a while", resume: "Resume",
    preview: "Link preview", pausedStatus: "Countdown paused. Take your time with the artwork.",
    resumedStatus: "Countdown resumed.", leaving: "Continuing to the demo destination."
  } : {
    album: "途中画册", tagline: "在抵达之前，遇见一幅画。",
    reinterpretation: "名画的像素演绎", encounter: "此刻，与你相遇",
    medium: "原作媒介", collection: "原作馆藏", oneAtATime: "每次途经，偶遇一幅。",
    destination: "即将前往", fullAddress: "查看完整目标地址", continue: "立即前往",
    imageError: "画作暂时未能载入，你仍可继续前往。",
    seconds: "秒后自动跳转", paused: "已暂停欣赏", pause: "停留欣赏", resume: "继续倒计时",
    preview: "链接预览", pausedStatus: "倒计时已暂停，可以停留欣赏。",
    resumedStatus: "倒计时已继续。", leaving: "正在前往本地演示终点。"
  };
  document.documentElement.lang = english ? "en" : "zh-CN";
  document.title = english ? "The passing gallery" : "途中画册";
  if (english) document.querySelector(".masthead-title").textContent = copy.album;
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = copy[element.dataset.i18n];
  });
  document.querySelector(".departure").setAttribute("aria-label", english ? "Destination and navigation" : "跳转信息");

  let currentArt;
  function showArtwork(art) {
    currentArt = art;
    const field = (zh, en) => art[english ? en : zh];
    document.documentElement.style.setProperty("--art-ratio", art.width / art.height);
    document.documentElement.style.setProperty("--art-accent", art.accent);
    $("art-title").textContent = field("title", "englishTitle");
    $("art-artist").textContent = field("artist", "englishArtist");
    $("art-year").textContent = field("year", "englishYear");
    $("art-description").textContent = field("description", "englishDescription");
    $("art-medium").textContent = field("medium", "englishMedium");
    $("art-collection").textContent = field("collection", "englishCollection");
    $("edition-number").textContent = String(artworks.indexOf(art) + 1).padStart(2, "0");
    $("edition-total").textContent = String(artworks.length).padStart(2, "0");
    const image = $("art-image");
    image.alt = field("alt", "englishAlt");
    image.width = art.width;
    image.height = art.height;
    $("image-fallback").hidden = true;
    image.parentElement.hidden = false;
    image.onload = () => { $("main").setAttribute("aria-busy", "false"); };
    image.onerror = () => {
      image.parentElement.hidden = true;
      $("image-fallback").hidden = false;
      $("main").setAttribute("aria-busy", "false");
    };
    $("main").setAttribute("aria-busy", "true");
    image.src = art.file;
    $("continue-link").href = localDestination("manual");
  }
  function localDestination(reason) {
    const query = new URLSearchParams({ reason, art: currentArt.slug, lang: english ? "en" : "zh" });
    return `destination.html?${query}`;
  }
  const chosen = review && artworks.find((art) => art.slug === params.get("art"));
  showArtwork(chosen || artworks[Math.floor(Math.random() * artworks.length)]);

  let duration = 2000;
  let remaining = duration;
  let paused = review || preview;
  let startedAt = performance.now();
  let timer;
  let leaving = false;

  function renderTimer() {
    document.body.classList.toggle("is-paused", paused);
    const fraction = Math.max(0, Math.min(1, remaining / duration));
    $("progress-fill").style.transform = `scaleX(${fraction})`;
    $("ring-progress").style.strokeDashoffset = String(81.6814 * (1 - fraction));
    $("timer-number").textContent = preview ? "↗" : paused ? "Ⅱ" : String(Math.ceil(remaining / 1000));
    $("timer-label").textContent = preview ? copy.preview : paused ? copy.paused : copy.seconds;
    $("pause-label").textContent = paused ? copy.resume : copy.pause;
    $("pause-symbol").textContent = paused ? "▷" : "Ⅱ";
    $("pause-button").setAttribute("aria-pressed", String(paused));
    $("pause-button").hidden = preview;
    document.querySelector(".progress-track").hidden = preview;
  }
  function tick() {
    if (paused || leaving) return;
    const now = performance.now();
    remaining = Math.max(0, remaining - (now - startedAt));
    startedAt = now;
    renderTimer();
    if (remaining <= 0) {
      leaving = true;
      $("status-message").textContent = copy.leaving;
      window.location.assign(localDestination("automatic"));
    } else {
      timer = window.setTimeout(tick, 50);
    }
  }
  function pause() {
    remaining = Math.max(0, remaining - (performance.now() - startedAt));
    paused = true;
    window.clearTimeout(timer);
    renderTimer();
    $("status-message").textContent = copy.pausedStatus;
  }
  function resume() {
    paused = false;
    startedAt = performance.now();
    renderTimer();
    $("status-message").textContent = copy.resumedStatus;
    tick();
  }
  $("pause-button").addEventListener("click", () => paused ? resume() : pause());
  $("continue-link").addEventListener("click", () => { leaving = true; window.clearTimeout(timer); });
  renderTimer();
  if (!paused) tick();

  const address = document.querySelector(".destination-details");
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      address.open = false;
      $("review-panel").hidden = true;
      $("review-toggle").setAttribute("aria-expanded", "false");
    }
  });
  document.addEventListener("click", (event) => {
    if (!address.contains(event.target)) address.open = false;
  });

  if (review) {
    $("review-tools").hidden = false;
    $("review-toggle").addEventListener("click", () => {
      const opening = $("review-panel").hidden;
      $("review-panel").hidden = !opening;
      $("review-toggle").setAttribute("aria-expanded", String(opening));
    });
    for (const art of artworks) {
      const option = document.createElement("option");
      option.value = art.slug;
      option.textContent = art.title;
      $("review-art").append(option);
    }
    $("review-art").value = currentArt.slug;
    $("review-art").addEventListener("change", (event) => {
      if (!paused) pause();
      showArtwork(artworks.find((art) => art.slug === event.target.value));
      const url = new URL(window.location.href);
      url.searchParams.set("art", currentArt.slug);
      window.history.replaceState({}, "", url);
    });
    $("review-restart").addEventListener("click", () => {
      window.clearTimeout(timer);
      duration = Number($("review-seconds").value) * 1000;
      remaining = duration;
      $("review-panel").hidden = true;
      $("review-toggle").setAttribute("aria-expanded", "false");
      resume();
    });
    const languageQuery = new URLSearchParams({review: "1", lang: english ? "zh" : "en"});
    $("review-language").href = `?${languageQuery}`;
    $("review-language").textContent = english ? "查看中文版 ↗" : "English version ↗";
  }
})();
