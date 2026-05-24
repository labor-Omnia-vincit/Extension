'use strict';

const KEYWORDS = [
  { text: "No future exams",          color: "#98FB98" },
  { text: "Totally and permanently",  color: "#87CEEB" },
  { text: "permanently and total",    color: "#DDA0DD" },
  { text: "Total and permanent",      color: "#90EE90" },
  { text: "Permanent",                color: "#FFB6C1" },
  { text: "static",                   color: "#ffff80" },
  { text: "examination",              color: "#FFD700" },
  { text: "Exams",                    color: "#F0E68C" },
];

const kwRegex = new RegExp(
  KEYWORDS.map(kw => "(" + kw.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")").join("|"),
  "gi"
);

// Invisible <span> elements appended to each page-wrapper at the match location.
// scrollIntoView() on these is reliable because layout is queried at nav-time, not render-time.
let allMatchAnchors = [];
let currentMatchIndex = -1;

// ── Entry point ───────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  const rawUrl = new URLSearchParams(window.location.search).get("url");
  if (!rawUrl) {
    showError("No PDF URL provided. Open this viewer from the VMSDEP extension popup.");
    return;
  }
  const url = decodeURIComponent(rawUrl);
  document.title = "VMSDEP — " + (url.split("/").pop().split("?")[0] || "PDF Viewer");

  document.getElementById("prevMatch").addEventListener("click", () => navigate(-1));
  document.getElementById("nextMatch").addEventListener("click", () => navigate(1));

  await loadPdf(url);
});

// ── PDF loading ───────────────────────────────────────────────────────────────

async function loadPdf(url) {
  setStatus("Loading PDF…");

  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("pdf.worker.min.js");

    const pdf = await pdfjsLib.getDocument({ url, withCredentials: true }).promise;
    const numPages = pdf.numPages;

    const firstPage = await pdf.getPage(1);
    const naturalVp = firstPage.getViewport({ scale: 1 });
    const availWidth = Math.max(400, window.innerWidth - 80);
    const scale = Math.min(1.8, availWidth / naturalVp.width);

    const container = document.getElementById("viewerContainer");
    container.innerHTML = "";
    allMatchAnchors = [];
    let totalMatches = 0;

    const statusDiv = document.createElement("div");
    statusDiv.id = "loadingMsg";
    container.appendChild(statusDiv);

    for (let p = 1; p <= numPages; p++) {
      statusDiv.textContent = `Rendering page ${p} of ${numPages}…`;
      const page = p === 1 ? firstPage : await pdf.getPage(p);
      totalMatches += await renderPage(page, scale, container);
    }

    statusDiv.remove();
    updateMatchInfo(totalMatches);

    if (totalMatches > 0) {
      currentMatchIndex = 0;
      scrollToAnchor(0);
    }

  } catch (err) {
    if (err.name === "PasswordException") {
      showError("<strong>This PDF is password-protected.</strong><br><br>A password is required to open it.");
    } else if (err.name === "InvalidPDFException") {
      showError("This file does not appear to be a valid PDF.");
    } else {
      showError(
        "<strong>Could not load the PDF.</strong><br><br>" +
        "• If the document requires a login, sign in first then try again.<br>" +
        "• For local files (file://) enable <em>Allow access to file URLs</em> in " +
        "<code>chrome://extensions</code> for this extension.<br><br>" +
        "Error: " + err.message
      );
    }
  }
}

// ── Render one page ───────────────────────────────────────────────────────────

async function renderPage(page, scale, container) {
  const viewport = page.getViewport({ scale });

  const wrapper = document.createElement("div");
  wrapper.className = "page-wrapper";
  wrapper.style.width  = viewport.width  + "px";
  wrapper.style.height = viewport.height + "px";

  const canvas = document.createElement("canvas");
  canvas.className = "page-canvas";
  canvas.width  = viewport.width;
  canvas.height = viewport.height;
  wrapper.appendChild(canvas);

  const overlay = document.createElement("canvas");
  overlay.className = "highlight-layer";
  overlay.width  = viewport.width;
  overlay.height = viewport.height;
  wrapper.appendChild(overlay);

  container.appendChild(wrapper);

  await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;

  const textContent = await page.getTextContent();
  return drawHighlights(overlay, textContent, viewport, wrapper);
}

// ── Highlight drawing ─────────────────────────────────────────────────────────

function drawHighlights(overlay, textContent, viewport, pageWrapper) {
  // Build flat string + per-item index map.
  const itemMap = [];
  let flat = "";

  for (const item of textContent.items) {
    if (!item.str) continue;
    const start = flat.length;
    flat += item.str;
    if (item.hasEOL) flat += "\n";
    else flat += " ";
    itemMap.push({ start, end: flat.length, item });
  }

  kwRegex.lastIndex = 0;
  const ctx = overlay.getContext("2d");
  ctx.globalAlpha = 0.45;

  // Off-screen canvas for proportional character-width measurement.
  const mCtx = document.createElement("canvas").getContext("2d");

  const toolbarH = document.getElementById("toolbar").offsetHeight;
  let matchCount = 0;
  let match;

  while ((match = kwRegex.exec(flat)) !== null) {
    let color = "#ffff00";
    for (let g = 1; g < match.length; g++) {
      if (match[g] !== undefined) { color = KEYWORDS[g - 1].color; break; }
    }

    const mStart = match.index;
    const mEnd   = match.index + match[0].length;
    let anchorCreated = false;

    for (const entry of itemMap) {
      if (entry.end <= mStart || entry.start >= mEnd) continue;

      const tx = pdfjsLib.Util.transform(viewport.transform, entry.item.transform);
      const fontH = Math.sqrt(tx[2] * tx[2] + tx[3] * tx[3]) || Math.abs(tx[3]);
      const fullW = entry.item.width * viewport.scale;

      const str        = entry.item.str;
      const itemStrLen = str.length || 1;
      const charStart  = Math.max(0, mStart - entry.start);
      const charEnd    = Math.min(itemStrLen, mEnd - entry.start);

      // Use canvas.measureText for proportional-font x offsets.
      // Character-count fractions are wrong for proportional fonts — this is accurate.
      mCtx.font = `${Math.round(fontH)}px serif`;
      const measTotal = mCtx.measureText(str).width || 1;
      const fracStart = charStart > 0
        ? mCtx.measureText(str.slice(0, charStart)).width / measTotal : 0;
      const fracEnd   = charEnd < itemStrLen
        ? mCtx.measureText(str.slice(0, charEnd)).width / measTotal : 0.92;

      const x = tx[4] + fracStart * fullW;
      const w = (fracEnd - fracStart) * fullW;

      // y: baseline (tx[5]) minus ~85 % of em for cap-height; height covers to just below baseline.
      const y = tx[5] - fontH * 0.85;
      const h = fontH * 0.90;

      ctx.fillStyle = color;
      ctx.fillRect(x, y, Math.max(w, 4), h);

      // One invisible anchor per match (first overlapping item) for navigation.
      if (!anchorCreated) {
        const anchor = document.createElement("span");
        anchor.style.cssText =
          `position:absolute;left:0;top:${Math.max(0, y)}px;` +
          `width:1px;height:1px;pointer-events:none;` +
          `scroll-margin-top:${toolbarH + 20}px;`;
        pageWrapper.appendChild(anchor);
        allMatchAnchors.push(anchor);
        anchorCreated = true;
      }
    }

    if (anchorCreated) matchCount++;
  }

  return matchCount;
}

// ── Navigation ────────────────────────────────────────────────────────────────

function navigate(dir) {
  if (allMatchAnchors.length === 0) return;
  currentMatchIndex =
    (currentMatchIndex + dir + allMatchAnchors.length) % allMatchAnchors.length;
  scrollToAnchor(currentMatchIndex);
}

function scrollToAnchor(idx) {
  const anchor = allMatchAnchors[idx];
  if (!anchor) return;
  const toolbarH = document.getElementById("toolbar").offsetHeight;
  const rect = anchor.getBoundingClientRect();
  const usableH = window.innerHeight - toolbarH;
  const targetScrollY = window.scrollY + rect.top - toolbarH - usableH / 2;
  window.scrollTo({ top: Math.max(0, targetScrollY), behavior: "smooth" });
  updateMatchDisplay();
}

function updateMatchDisplay() {
  const info = document.getElementById("matchInfo");
  info.textContent = `${currentMatchIndex + 1} / ${allMatchAnchors.length}`;
  info.style.color = "#ffb74d";
}

function updateMatchInfo(total) {
  const prev = document.getElementById("prevMatch");
  const next = document.getElementById("nextMatch");
  const info = document.getElementById("matchInfo");

  if (total === 0) {
    info.textContent = "No keywords found";
    info.style.color = "#ffb74d";
    prev.disabled = true;
    next.disabled = true;
  } else {
    info.textContent = `1 / ${total}`;
    info.style.color = "#ffb74d";
    prev.disabled = false;
    next.disabled = false;
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function setStatus(msg) {
  document.getElementById("viewerContainer").innerHTML =
    `<div id="loadingMsg">${msg}</div>`;
}

function showError(html) {
  document.getElementById("viewerContainer").innerHTML =
    `<div class="error-box">${html}</div>`;
  const info = document.getElementById("matchInfo");
  info.textContent = "Error";
  info.style.color = "#ef9a9a";
}
