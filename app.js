/* ============================================================
   Kapitol · FlowPitch — vanilla JS presentation editor + presenter
   ============================================================ */
(() => {
  "use strict";

  const SLIDE_W = 1280, SLIDE_H = 720;
  let deck = null;
  let current = 0;
  let storeOK = true;
  let DRAFT_KEY = "flowpitch:deck:draft";
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- DOM refs ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const editor = $("#editor");
  const stage = $("#stage");
  const railList = $("#railList");
  const editScaler = $("#editScaler");
  const slideFrame = $("#slideFrame");
  const presentScaler = $("#presentScaler");
  const stageViewport = $("#stageViewport");
  const typeSelect = $("#typeSelect");
  const noteField = $("#noteField");
  const deckTitleEl = $("#deckTitle");
  const saveState = $("#saveState");

  /* ============================================================
     STATE / PATH HELPERS
     ============================================================ */
  const getPath = (obj, path) =>
    path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);

  function setPath(obj, path, val) {
    const keys = path.split(".");
    const last = keys.pop();
    let o = obj;
    for (const k of keys) { if (o[k] == null) o[k] = {}; o = o[k]; }
    o[last] = val;
  }

  const esc = (s) =>
    String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  /* ============================================================
     LOAD / SAVE
     ============================================================ */
  async function boot() {
    try { localStorage.setItem("__t", "1"); localStorage.removeItem("__t"); }
    catch { storeOK = false; }

    let base = null;
    try {
      const res = await fetch("content.json", { cache: "no-store" });
      if (!res.ok) throw new Error("bad status");
      base = await res.json();
    } catch (e) {
      showLoadError();
      return;
    }

    DRAFT_KEY = `flowpitch:${base?.meta?.deckId || "deck"}:draft`;
    let saved = null;
    if (storeOK) {
      try { const raw = localStorage.getItem(DRAFT_KEY); if (raw) saved = JSON.parse(raw); }
      catch {}
    }
    deck = saved && saved.slides ? saved : base;
    if (!deck.slides || !deck.slides.length) deck.slides = [blankSlide("content")];

    current = 0;
    deckTitleEl.textContent = deck.meta?.title || "Untitled deck";
    if (!storeOK) flashSave("No local save", true);

    buildRail();
    selectSlide(0);
    fitEditor();
    wireGlobal();
  }

  function showLoadError() {
    editScaler.innerHTML =
      `<div style="width:${SLIDE_W}px;height:${SLIDE_H}px;display:grid;place-items:center;
        background:linear-gradient(160deg,#0A1120,#070B14);color:#EAF0FB;text-align:center;padding:80px;font-family:var(--sans)">
        <div>
          <div style="font:700 20px var(--mono);letter-spacing:.2em;color:#45D6EC;text-transform:uppercase;margin-bottom:22px">content.json didn't load</div>
          <div style="font-size:34px;font-weight:800;max-width:20ch;margin:0 auto 20px;line-height:1.1">Open this deck through a local server</div>
          <div style="font-size:19px;color:#8FA0BC;max-width:52ch;margin:0 auto;line-height:1.5">
            Browsers block <code>fetch()</code> on <code>file://</code>. From this folder run
            <b style="color:#FFB347">python3 -m http.server</b> then visit
            <b style="color:#FFB347">localhost:8000</b>.
          </div>
        </div>
      </div>`;
    fitEditor();
  }

  let saveTimer = null;
  function save(debounced = true) {
    if (!storeOK) return;
    flashSave("Saving…", true);
    clearTimeout(saveTimer);
    const write = () => {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify(deck)); flashSave("Saved", false); }
      catch { flashSave("Save failed", true); }
    };
    if (debounced) saveTimer = setTimeout(write, 350); else write();
  }
  function flashSave(txt, saving) {
    if (!saveState) return;
    saveState.textContent = txt;
    saveState.classList.toggle("saving", !!saving);
  }

  /* ============================================================
     SHARED RENDERER  —  renderSlide(slide, index, mode) -> HTML string
     mode: "edit" | "present" | "thumbnail" | "pdf"
     ============================================================ */
  function ed(mode, path) {
    return mode === "edit" ? ` contenteditable="true" spellcheck="true" data-edit-path="${path}"` : "";
  }
  function an(mode, key) {
    // animation hooks only for present/pdf; pdf forced visible via CSS
    return (mode === "present" || mode === "pdf") ? ` data-animate="${key}"` : "";
  }
  const dvar = (i) => ` style="--d:${i}"`;

  function fieldH(mode, path, val, cls, tag = "div") {
    return `<${tag} class="${cls}"${ed(mode, path)}>${esc(val)}</${tag}>`;
  }
  function eyebrow(mode, s, i) {
    if (s.eyebrow == null) return "";
    return `<div class="s-eyebrow"${an(mode, "eyebrow")}${dvar(0)}><span${ed(mode, `slides.${i}.eyebrow`)}>${esc(s.eyebrow)}</span></div>`;
  }
  function headline(mode, s, i, grad = false) {
    return `<h1 class="s-head${grad ? " grad" : ""}"${ed(mode, `slides.${i}.headline`)}${an(mode, "head")}${dvar(1)}>${esc(s.headline || "")}</h1>`;
  }
  function sub(mode, s, i, d = 2) {
    if (s.subheadline == null) return "";
    return `<p class="s-sub"${ed(mode, `slides.${i}.subheadline`)}${an(mode, "sub")}${dvar(d)}>${esc(s.subheadline)}</p>`;
  }

  function renderSlide(s, i, mode) {
    const t = s.type || "content";
    let body = "";

    if (t === "title") {
      body =
        eyebrow(mode, s, i) +
        headline(mode, s, i, true) +
        sub(mode, s, i, 2) +
        (s.cta != null
          ? `<div class="t-meta"${an(mode, "meta")}${dvar(3)}><span${ed(mode, `slides.${i}.cta`)}>${esc(s.cta)}</span></div>`
          : "");
      return wrap("t-title", body);
    }

    if (t === "section") {
      body =
        eyebrow(mode, s, i) +
        headline(mode, s, i, true) +
        sub(mode, s, i, 2) +
        `<div class="sec-rule"${an(mode, "rule")}${dvar(3)}></div>`;
      return wrap("t-section", body);
    }

    if (t === "closing") {
      body =
        eyebrow(mode, s, i) +
        headline(mode, s, i, true) +
        sub(mode, s, i, 2) +
        (s.cta != null
          ? `<div class="cta"${an(mode, "cta")}${dvar(3)}><span${ed(mode, `slides.${i}.cta`)}>${esc(s.cta)}</span></div>`
          : "");
      return wrap("t-closing", body);
    }

    if (t === "visual") {
      body = eyebrow(mode, s, i) + headline(mode, s, i, true) + sub(mode, s, i, 2);
      return wrap("t-visual", body);
    }

    if (t === "cards") {
      const cards = (s.cards || []);
      const grid = cards.map((c, j) =>
        `<div class="card"${an(mode, "card")}${dvar(2 + j)}>
          <div class="card-idx">0${j + 1}</div>
          ${fieldH(mode, `slides.${i}.cards.${j}.title`, c.title, "card-title")}
          ${fieldH(mode, `slides.${i}.cards.${j}.body`, c.body, "card-body")}
        </div>`).join("");
      body = eyebrow(mode, s, i) + headline(mode, s, i) +
        `<div class="c-grid n${Math.min(cards.length, 4)}">${grid}</div>`;
      return wrap("t-cards", body);
    }

    if (t === "beforeAfter") {
      const L = s.left || { title: "", bullets: [] };
      const R = s.right || { title: "", bullets: [] };
      const li = (side, idx, txt, j) =>
        `<li${an(mode, "ba")}${dvar((side === "l" ? 0 : 4) + j)}><span${ed(mode, `slides.${i}.${idx}.bullets.${j}`)}>${esc(txt)}</span></li>`;
      body =
        eyebrow(mode, s, i) + headline(mode, s, i) +
        `<div class="ba-wrap">
          <div class="ba-col ba-before"${an(mode, "ba")}${dvar(0)}>
            <div class="ba-title"><span class="dot"></span><span${ed(mode, `slides.${i}.left.title`)}>${esc(L.title)}</span></div>
            <ul class="ba-list">${(L.bullets || []).map((b, j) => li("l", "left", b, j)).join("")}</ul>
          </div>
          <div class="ba-arrow"${an(mode, "ba")}${dvar(4)}><span>→</span></div>
          <div class="ba-col ba-after"${an(mode, "ba")}${dvar(4)}>
            <div class="ba-title"><span class="dot"></span><span${ed(mode, `slides.${i}.right.title`)}>${esc(R.title)}</span></div>
            <ul class="ba-list">${(R.bullets || []).map((b, j) => li("r", "right", b, j)).join("")}</ul>
          </div>
        </div>`;
      return wrap("t-beforeAfter", body);
    }

    if (t === "proof") {
      const m = (s.metrics || []);
      const tiles = m.map((x, j) =>
        `<div class="metric"${an(mode, "metric")}${dvar(2 + j)}>
          <div class="metric-value">${esc(x.value)}</div>
          ${fieldH(mode, `slides.${i}.metrics.${j}.label`, x.label, "metric-label")}
        </div>`).join("");
      // value editable overlay in edit mode (kept separate so present can count up)
      const editValues = mode === "edit"
        ? m.map((x, j) => `slides.${i}.metrics.${j}.value`) : [];
      body = eyebrow(mode, s, i) + headline(mode, s, i) +
        `<div class="p-grid n${Math.min(Math.max(m.length, 3), 5)}">${tiles}</div>`;
      let html = wrap("t-proof", body);
      // inject contenteditable on metric values for edit mode
      if (mode === "edit") {
        html = html.replace(/<div class="metric-value">(.*?)<\/div>/g, (mm, val) => {
          const path = editValues.shift();
          return `<div class="metric-value" contenteditable="true" spellcheck="false" data-edit-path="${path}">${val}</div>`;
        });
      }
      return html;
    }

    if (t === "process") {
      const steps = (s.steps || []);
      const cols = steps.map((st, j) =>
        `<div class="pr-step"${an(mode, "step")}${dvar(2 + j)}>
          <div class="pr-node">${j + 1}</div>
          ${fieldH(mode, `slides.${i}.steps.${j}.title`, st.title, "pr-title")}
          ${fieldH(mode, `slides.${i}.steps.${j}.body`, st.body, "pr-body")}
        </div>`).join("");
      body = eyebrow(mode, s, i) + headline(mode, s, i) +
        `<div class="pr-flow" style="grid-template-columns:repeat(${Math.max(steps.length, 1)},1fr)">
          <div class="pr-line"></div>${cols}
        </div>`;
      return wrap("t-process", body);
    }

    /* default: content */
    const bl = (s.bullets || []).map((b, j) =>
      `<li${an(mode, "bul")}${dvar(3 + j)}><span class="tick"></span><span${ed(mode, `slides.${i}.bullets.${j}`)}>${esc(b)}</span></li>`).join("");
    body = eyebrow(mode, s, i) + headline(mode, s, i) + sub(mode, s, i, 2) +
      (bl ? `<ul class="c-list">${bl}</ul>` : "");
    return wrap("t-content", body);

    function wrap(cls, inner) {
      return `<div class="slide-inner ${cls}">${inner}</div>`;
    }
  }

  /* ============================================================
     SCALING (fixed 1280×720 internal, transform-scaled)
     ============================================================ */
  function scaleTo(scalerEl, k, center) {
    const inner = scalerEl.firstElementChild;
    if (!inner) return;
    inner.style.transformOrigin = "top left";
    inner.style.transform = `scale(${k})`;
    scalerEl.style.width = SLIDE_W * k + "px";
    scalerEl.style.height = SLIDE_H * k + "px";
    if (center) { scalerEl.style.position = "relative"; scalerEl.style.left = ""; scalerEl.style.top = ""; }
    else { scalerEl.style.position = "absolute"; scalerEl.style.left = "0"; scalerEl.style.top = "0"; }
  }
  function fitEditor() {
    const w = slideFrame.clientWidth;
    if (w) scaleTo(editScaler, w / SLIDE_W, false);
  }
  function fitPresent() {
    const w = stageViewport.clientWidth, h = stageViewport.clientHeight;
    if (w && h) scaleTo(presentScaler, Math.min(w / SLIDE_W, h / SLIDE_H), true);
  }

  /* ============================================================
     EDIT MODE — rail, canvas, inspector
     ============================================================ */
  function buildRail() {
    railList.innerHTML = "";
    deck.slides.forEach((s, i) => {
      const th = document.createElement("div");
      th.className = "thumb" + (i === current ? " active" : "");
      th.setAttribute("role", "button");
      th.setAttribute("tabindex", "0");
      th.dataset.i = i;
      const sc = document.createElement("div");
      sc.className = "slide-scaler mode-thumb";
      sc.innerHTML = renderSlide(s, i, "thumbnail");
      th.innerHTML = `<span class="thumb-num">${String(i + 1).padStart(2, "0")}</span>`;
      th.appendChild(sc);
      railList.appendChild(th);
      const k = th.clientWidth / SLIDE_W;
      scaleTo(sc, k, false);
    });
  }

  function renderCanvas() {
    editScaler.className = "slide-scaler mode-edit";
    editScaler.innerHTML = renderSlide(deck.slides[current], current, "edit");
    fitEditor();
  }

  function selectSlide(i) {
    current = Math.max(0, Math.min(i, deck.slides.length - 1));
    renderCanvas();
    [...railList.children].forEach((t, idx) => t.classList.toggle("active", idx === current));
    // keep active thumb in view
    railList.children[current]?.scrollIntoView({ block: "nearest", inline: "nearest" });
    syncInspector();
  }

  function syncInspector() {
    const s = deck.slides[current];
    typeSelect.value = s.type || "content";
    noteField.value = s.note || "";
    $("#slidePos").textContent = `${current + 1} / ${deck.slides.length}`;
  }

  /* ----- editable text binding (delegated, no canvas re-render) ----- */
  editScaler.addEventListener("input", (e) => {
    const t = e.target.closest("[data-edit-path]");
    if (!t) return;
    setPath(deck, t.dataset.editPath, t.textContent);
    if (t.dataset.editPath === "meta.title") deckTitleEl.textContent = deck.meta.title;
    scheduleThumb();
    save(true);
  });
  // strip rich paste
  editScaler.addEventListener("paste", (e) => {
    const t = e.target.closest("[data-edit-path]");
    if (!t) return;
    e.preventDefault();
    const txt = (e.clipboardData || window.clipboardData).getData("text/plain");
    document.execCommand("insertText", false, txt.replace(/\s+/g, " "));
  });
  let thumbTimer = null;
  function scheduleThumb() {
    clearTimeout(thumbTimer);
    thumbTimer = setTimeout(() => {
      const sc = railList.children[current]?.querySelector(".slide-scaler");
      if (sc) { sc.innerHTML = renderSlide(deck.slides[current], current, "thumbnail"); scaleTo(sc, sc.parentElement.clientWidth / SLIDE_W, false); }
    }, 300);
  }

  // deck title editing (in toolbar)
  deckTitleEl.addEventListener("input", () => {
    setPath(deck, "meta.title", deckTitleEl.textContent);
    save(true);
  });

  // rail click / keyboard
  railList.addEventListener("click", (e) => {
    const th = e.target.closest(".thumb"); if (th) selectSlide(+th.dataset.i);
  });
  railList.addEventListener("keydown", (e) => {
    const th = e.target.closest(".thumb");
    if (th && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); selectSlide(+th.dataset.i); }
  });

  // inspector controls
  typeSelect.addEventListener("change", () => {
    deck.slides[current] = coerceType(deck.slides[current], typeSelect.value);
    renderCanvas(); buildRail(); syncInspector(); save(false);
    [...railList.children].forEach((t, idx) => t.classList.toggle("active", idx === current));
  });
  noteField.addEventListener("input", () => { deck.slides[current].note = noteField.value; save(true); });

  /* ----- slide operations ----- */
  const $railOps = $(".rail-ops");
  $railOps.addEventListener("click", (e) => {
    const b = e.target.closest("[data-op]"); if (!b) return;
    const op = b.dataset.op;
    if (op === "add") {
      deck.slides.splice(current + 1, 0, blankSlide("content"));
      selectSlideRebuild(current + 1);
    } else if (op === "dup") {
      deck.slides.splice(current + 1, 0, deepClone(deck.slides[current]));
      selectSlideRebuild(current + 1);
    } else if (op === "del") {
      if (deck.slides.length <= 1) { deck.slides[0] = blankSlide("content"); selectSlideRebuild(0); }
      else { deck.slides.splice(current, 1); selectSlideRebuild(Math.max(0, current - 1)); }
    } else if (op === "up" && current > 0) {
      [deck.slides[current - 1], deck.slides[current]] = [deck.slides[current], deck.slides[current - 1]];
      selectSlideRebuild(current - 1);
    } else if (op === "down" && current < deck.slides.length - 1) {
      [deck.slides[current + 1], deck.slides[current]] = [deck.slides[current], deck.slides[current + 1]];
      selectSlideRebuild(current + 1);
    }
  });
  function selectSlideRebuild(i) { buildRail(); selectSlide(i); save(false); }

  function blankSlide(type) {
    return {
      type,
      eyebrow: "Section label",
      headline: "New headline — click to edit",
      subheadline: "Add a supporting line here.",
      bullets: ["First point", "Second point", "Third point"],
      note: ""
    };
  }
  function coerceType(s, type) {
    const n = { ...s, type };
    const need = (k, v) => { if (n[k] == null) n[k] = v; };
    if (type === "cards") need("cards", [{ title: "Card one", body: "Describe it." }, { title: "Card two", body: "Describe it." }, { title: "Card three", body: "Describe it." }]);
    if (type === "proof") need("metrics", [{ value: "100", label: "Metric label" }, { value: "2×", label: "Metric label" }, { value: "50%", label: "Metric label" }]);
    if (type === "process") need("steps", [{ title: "Step one", body: "What happens." }, { title: "Step two", body: "What happens." }, { title: "Step three", body: "What happens." }]);
    if (type === "beforeAfter") { need("left", { title: "Before", bullets: ["Old point one", "Old point two"] }); need("right", { title: "After", bullets: ["New point one", "New point two"] }); }
    if (type === "title" || type === "closing") need("cta", "Call to action");
    return n;
  }
  const deepClone = (o) => JSON.parse(JSON.stringify(o));

  /* ============================================================
     PRESENT MODE
     ============================================================ */
  let pIndex = 0, transTimer = null, glowEl = null;

  function openPresent(startAt) {
    pIndex = startAt;
    stage.classList.add("on");
    stage.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    if (stage.requestFullscreen) stage.requestFullscreen().catch(() => {});
    // fade editor out, scale stage in
    requestAnimationFrame(() => {
      stage.classList.add("show");
      mountPresent(pIndex, 0);
    });
    ensureGlow();
  }
  function closePresent() {
    stage.classList.remove("show");
    stage.setAttribute("aria-hidden", "true");
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    setTimeout(() => { stage.classList.remove("on"); presentScaler.innerHTML = ""; }, 420);
    document.body.style.overflow = "";
    selectSlide(pIndex); // return to same slide in editor
  }

  function mountPresent(i, dir) {
    presentScaler.className = "slide-scaler mode-present";
    presentScaler.innerHTML = renderSlide(deck.slides[i], i, "present");
    fitPresent();
    presentScaler.style.transition = "none";
    presentScaler.style.transform = `translateX(${dir ? dir * 70 : 0}px)`;
    presentScaler.style.opacity = "0";
    void presentScaler.offsetWidth;
    presentScaler.style.transition = "";
    presentScaler.style.transform = "translateX(0)";
    presentScaler.style.opacity = "1";
    activate();
    updateChrome();
  }

  function goTo(i) {
    if (i < 0 || i >= deck.slides.length || i === pIndex) return;
    const dir = i > pIndex ? 1 : -1;
    presentScaler.style.opacity = "0";
    presentScaler.style.transform = `translateX(${-dir * 70}px)`;
    clearTimeout(transTimer);
    transTimer = setTimeout(() => { pIndex = i; mountPresent(i, dir); }, 240);
  }

  function activate() {
    const inner = presentScaler.querySelector(".slide-inner");
    if (!inner) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        inner.classList.add("is-active");
        inner.querySelectorAll(".pr-flow, .card").forEach((el, j) => {
          setTimeout(() => el.classList.add("is-in"), 250 + j * 90);
        });
        runCounters(inner);
      });
    });
  }

  function updateChrome() {
    $("#counterCur").textContent = pIndex + 1;
    $("#counterTot").textContent = deck.slides.length;
    $("#stageBar").style.width = ((pIndex + 1) / deck.slides.length) * 100 + "%";
  }

  /* count-up metrics */
  function runCounters(root) {
    root.querySelectorAll(".metric-value").forEach((el) => {
      const raw = el.textContent.trim();
      const m = raw.match(/^([^\d]*)([\d][\d.,]*)(.*)$/);
      if (!m) return;
      const prefix = m[1], numStr = m[2].replace(/,/g, ""), suffix = m[3];
      const target = parseFloat(numStr);
      const decimals = (numStr.split(".")[1] || "").length;
      if (reduceMotion || isNaN(target)) { el.textContent = raw; return; }
      const dur = 1050, t0 = performance.now();
      const tick = (now) => {
        const p = Math.min((now - t0) / dur, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        const v = target * eased;
        el.textContent = prefix + (decimals ? v.toFixed(decimals) : Math.round(v)) + suffix;
        if (p < 1) requestAnimationFrame(tick);
        else el.textContent = raw;
      };
      el.textContent = prefix + "0" + suffix;
      requestAnimationFrame(tick);
    });
  }

  /* cursor glow */
  function ensureGlow() {
    if (glowEl) return;
    glowEl = document.createElement("div");
    glowEl.className = "stage-glow";
    stageViewport.appendChild(glowEl);
    stage.addEventListener("mousemove", (e) => {
      glowEl.style.opacity = "1";
      glowEl.style.left = e.clientX + "px";
      glowEl.style.top = e.clientY + "px";
    });
    stage.addEventListener("mouseleave", () => { if (glowEl) glowEl.style.opacity = "0"; });
  }

  /* ============================================================
     PDF EXPORT
     ============================================================ */
  const CDN = {
    h2c: "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js",
    jspdf: "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"
  };
  function loadScript(src) {
    return new Promise((res, rej) => {
      const el = document.createElement("script");
      el.src = src; el.onload = res; el.onerror = () => rej(new Error(src));
      document.head.appendChild(el);
    });
  }

  async function exportPdf(btn) {
    const orig = btn.textContent;
    btn.disabled = true; btn.textContent = "Exporting…";
    try {
      if (!window.html2canvas) await loadScript(CDN.h2c);
      if (!window.jspdf) await loadScript(CDN.jspdf);
    } catch (e) {
      alert("PDF export needs internet access to load its libraries.\n\nAllow cdnjs.cloudflare.com, or self-host html2canvas + jsPDF.");
      btn.disabled = false; btn.textContent = orig; return;
    }
    const { jsPDF } = window.jspdf;
    const pdfStage = $("#pdfStage");
    document.body.classList.add("exportingPdf");
    const dpr = Math.max(window.devicePixelRatio || 1, 2);
    let pdf = null;

    try {
      for (let i = 0; i < deck.slides.length; i++) {
        pdfStage.innerHTML = "";
        const sc = document.createElement("div");
        sc.className = "slide-scaler mode-present";
        sc.innerHTML = renderSlide(deck.slides[i], i, "pdf");
        sc.querySelector(".slide-inner")?.classList.add("is-active");
        pdfStage.appendChild(sc);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

        const canvas = await window.html2canvas(pdfStage, {
          backgroundColor: "#050611", scale: dpr, useCORS: true,
          width: 1920, height: 1080, windowWidth: 1920, windowHeight: 1080
        });
        const img = canvas.toDataURL("image/png");
        if (!pdf) pdf = new jsPDF({ orientation: "landscape", unit: "px", format: [1920, 1080] });
        else pdf.addPage([1920, 1080], "landscape");
        pdf.addImage(img, "PNG", 0, 0, 1920, 1080);
      }
      pdf.save("FlowPitch.pdf");
    } catch (e) {
      console.error(e);
      alert("PDF export failed while rendering. Please try again.");
    } finally {
      pdfStage.innerHTML = "";
      document.body.classList.remove("exportingPdf");
      btn.disabled = false; btn.textContent = orig;
    }
  }

  /* ============================================================
     DOWNLOAD JSON / RESET
     ============================================================ */
  function downloadJson() {
    const blob = new Blob([JSON.stringify(deck, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "content.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }
  async function resetDeck() {
    if (!confirm("Reset to the original deck? Your edits will be cleared.")) return;
    if (storeOK) { try { localStorage.removeItem(DRAFT_KEY); } catch {} }
    try {
      const res = await fetch("content.json", { cache: "no-store" });
      deck = await res.json();
      deckTitleEl.textContent = deck.meta?.title || "Untitled deck";
      buildRail(); selectSlide(0); flashSave("Reset", false);
    } catch { showLoadError(); }
  }

  /* ============================================================
     GLOBAL WIRING
     ============================================================ */
  function wireGlobal() {
    $("#presentBtn").addEventListener("click", () => openPresent(current));
    $("#exitBtn").addEventListener("click", closePresent);
    $("#prevBtn").addEventListener("click", () => goTo(pIndex - 1));
    $("#nextBtn").addEventListener("click", () => goTo(pIndex + 1));
    $("#exportPdfBtn").addEventListener("click", (e) => exportPdf(e.currentTarget));
    $("#downloadJsonBtn").addEventListener("click", downloadJson);
    $("#resetDeckBtn").addEventListener("click", resetDeck);

    document.addEventListener("keydown", (e) => {
      if (!stage.classList.contains("on")) return;
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") { e.preventDefault(); goTo(pIndex + 1); }
      else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); goTo(pIndex - 1); }
      else if (e.key === "Escape") { e.preventDefault(); closePresent(); }
    });
    document.addEventListener("fullscreenchange", () => {
      if (!document.fullscreenElement && stage.classList.contains("show")) { /* keep present unless Esc */ }
    });

    let rt = null;
    window.addEventListener("resize", () => {
      clearTimeout(rt);
      rt = setTimeout(() => {
        measureToolbar();
        if (stage.classList.contains("on")) fitPresent(); else { fitEditor(); refitThumbs(); }
      }, 120);
    });
    measureToolbar();
  }
  function refitThumbs() {
    [...railList.children].forEach((th) => {
      const sc = th.querySelector(".slide-scaler");
      if (sc) scaleTo(sc, th.clientWidth / SLIDE_W, false);
    });
  }
  function measureToolbar() {
    const tb = $("#toolbar");
    if (tb) document.documentElement.style.setProperty("--topOffset", tb.offsetHeight + "px");
  }

  /* go */
  boot();
})();
