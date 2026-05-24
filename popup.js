let templates = [];
let selectedTemplates = new Set();
let selectedTemplateOrder = [];
let pinnedTemplates = new Set();
let collapsedCategories = new Set();
let templatesLoaded = false;

document.addEventListener("DOMContentLoaded", async () => {
  loadSavedPins();
  loadSavedCollapsedCategories();

  await loadTemplates();

  document.getElementById("searchBox").addEventListener("input", renderTemplates);
  document.getElementById("copyButton").addEventListener("click", copyEmailText);

  const standardTextCheckbox = document.getElementById("includeStandardTextCheckbox");
  if (standardTextCheckbox) {
    standardTextCheckbox.addEventListener("change", updatePreview);
  }

  initToolDropdown();
  initPdfHighlighter();

  renderTemplates();
  updatePreview();
});

async function loadTemplates() {
  const list = document.getElementById("templateList");

  try {
    const response = await fetch(chrome.runtime.getURL("templates.json"));

    if (!response.ok) {
      throw new Error("Could not find templates.json");
    }

    templates = await response.json();

    templates = templates.filter(template => template.active !== false);

    templatesLoaded = true;

    console.log("Templates loaded:", templates);
  } catch (error) {
    console.error("Error loading templates:", error);

    templatesLoaded = false;

    list.innerHTML = `
      <p style="color: red; font-size: 13px;">
        Could not load templates.json. Check that the file exists, is saved, and contains valid JSON.
      </p>
    `;
  }
}

function renderTemplates() {
  const list = document.getElementById("templateList");

  if (!templatesLoaded) {
    return;
  }

  const searchText = document.getElementById("searchBox").value.toLowerCase().trim();

  list.innerHTML = "";

  const filteredTemplates = templates.filter(template => {
    const title = applyTemplateLogic(template.title || "");
    const category = template.category || "";
    const body = applyTemplateLogic(template.body || "");
    const bodyText = applyTemplateLogic(template.bodyText || "");
    const bodyHtml = applyTemplateLogic(template.bodyHtml || "");

    return (
      title.toLowerCase().includes(searchText) ||
      category.toLowerCase().includes(searchText) ||
      body.toLowerCase().includes(searchText) ||
      bodyText.toLowerCase().includes(searchText) ||
      stripHtml(bodyHtml).toLowerCase().includes(searchText)
    );
  });

  if (filteredTemplates.length === 0) {
    list.innerHTML = "<p>No templates found.</p>";
    return;
  }

  const pinned = filteredTemplates.filter(template => pinnedTemplates.has(template.id));

  if (pinned.length > 0) {
    renderCategorySection("Pinned Templates", pinned, list, true);
  }

  // IMPORTANT:
  // This uses Al filtered templates, not just unpin ones.
  // That means pinned templates still appear in their normal category too.
  const groupedTemplates = groupTemplatesByCategory(filteredTemplates);

  Object.keys(groupedTemplates)
    .sort((a, b) => a.localeCompare(b))
    .forEach(category => {
      renderCategorySection(category, groupedTemplates[category], list, false);
    });
}

function renderCategorySection(categoryName, categoryTemplates, list, isPinnedSection) {
  const section = document.createElement("div");
  section.className = "category-section";

  const header = document.createElement("button");
  header.type = "button";
  header.className = "category-header";

  const categoryTitle = document.createElement("span");
  categoryTitle.className = "category-title";
  categoryTitle.textContent = `${categoryName} (${categoryTemplates.length})`;

  const categoryArrow = document.createElement("span");
  categoryArrow.className = "category-arrow";

  const isCollapsed = collapsedCategories.has(categoryName);

  categoryArrow.textContent = isCollapsed ? "▶" : "▼";

  header.appendChild(categoryTitle);
  header.appendChild(categoryArrow);

  header.addEventListener("click", () => {
    if (collapsedCategories.has(categoryName)) {
      collapsedCategories.delete(categoryName);
    } else {
      collapsedCategories.add(categoryName);
    }

    saveCollapsedCategories();
    renderTemplates();
  });

  section.appendChild(header);

  if (!isCollapsed) {
    const categoryItems = document.createElement("div");
    categoryItems.className = "category-items";

    categoryTemplates
      .slice()
      .sort((a, b) => {
        const titleA = applyTemplateLogic(a.title || "");
        const titleB = applyTemplateLogic(b.title || "");
        return titleA.localeCompare(titleB);
      })
      .forEach(template => {
        const item = createTemplateItem(template, isPinnedSection);
        categoryItems.appendChild(item);
      });

    section.appendChild(categoryItems);
  }

  list.appendChild(section);
}

function createTemplateItem(template, isPinnedSection) {
  const item = document.createElement("div");
  item.className = "template-item";

  const label = document.createElement("label");
  label.className = "template-select-label";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = selectedTemplates.has(template.id);

  checkbox.addEventListener("change", () => {
    if (checkbox.checked) {
      selectedTemplates.add(template.id);

      if (!selectedTemplateOrder.includes(template.id)) {
        selectedTemplateOrder.push(template.id);
      }
    } else {
      selectedTemplates.delete(template.id);

      selectedTemplateOrder = selectedTemplateOrder.filter(
        selectedId => selectedId !== template.id
      );
    }

    updatePreview();
  });

  const textWrapper = document.createElement("div");
  textWrapper.className = "template-text-wrapper";

  const title = document.createElement("div");
  title.className = "template-title";
  title.textContent = applyTemplateLogic(template.title || "");

  const category = document.createElement("div");
  category.className = "template-category";
  category.textContent = template.category || "";

  textWrapper.appendChild(title);
  textWrapper.appendChild(category);

  label.appendChild(checkbox);
  label.appendChild(textWrapper);

  const pinButton = document.createElement("button");
  pinButton.type = "button";
  pinButton.className = pinnedTemplates.has(template.id)
    ? "pin-button pinned"
    : "pin-button";

  pinButton.title = pinnedTemplates.has(template.id)
    ? "Unpin template"
    : "Pin template";

  pinButton.textContent = pinnedTemplates.has(template.id) ? "★" : "☆";

  pinButton.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();

    if (pinnedTemplates.has(template.id)) {
      pinnedTemplates.delete(template.id);
    } else {
      pinnedTemplates.add(template.id);
    }

    savePinnedTemplates();
    renderTemplates();
  });

  item.appendChild(label);
  item.appendChild(pinButton);

  return item;
}

function groupTemplatesByCategory(templateList) {
  const grouped = {};

  templateList.forEach(template => {
    const category = template.category || "Uncategorized";

    if (!grouped[category]) {
      grouped[category] = [];
    }

    grouped[category].push(template);
  });

  return grouped;
}

function updatePreview() {
  const previewBox = document.getElementById("previewBox");

  const includeStandardText = shouldIncludeStandardText();

  const selectedBodies = getSelectedTemplatesInClickOrder().map(template =>
    getTemplatePlainText(template)
  );

  const greeting = getGreeting();
  const signature = "Thank you for contacting the VMSDEP program.";

  const emailParts = [];

  if (includeStandardText) {
    emailParts.push(greeting);
    emailParts.push("");
  }

  emailParts.push(...selectedBodies);

  if (includeStandardText) {
    emailParts.push("");
    emailParts.push(signature);
  }

  previewBox.value = emailParts.join("\n\n");
}

function shouldIncludeStandardText() {
  const standardTextCheckbox = document.getElementById("includeStandardTextCheckbox");

  if (!standardTextCheckbox) {
    return true;
  }

  return standardTextCheckbox.checked;
}

function getGreeting() {
  const currentHour = new Date().getHours();

  if (currentHour < 12) {
    return "Good morning,";
  }

  return "Good afternoon,";
}

async function copyEmailText() {
  const statusMessage = document.getElementById("statusMessage");

  const includeStandardText = shouldIncludeStandardText();

  const greeting = getGreeting();

  const selectedTemplatesArray = getSelectedTemplatesInClickOrder();

  const selectedHtmlBodies = selectedTemplatesArray.map(template =>
    getTemplateHtml(template)
  );

  const selectedPlainBodies = selectedTemplatesArray.map(template =>
    getTemplatePlainText(template)
  );

  const signatureText = "Thank you for contacting the VMSDEP program.";
  const signatureHtml = "<p>Thank you for contacting the VMSDEP program.</p>";

  const htmlParts = [];

  if (includeStandardText) {
    htmlParts.push(`<p>${escapeHtml(greeting)}</p>`);
  }

  htmlParts.push(...selectedHtmlBodies);

  if (includeStandardText) {
    htmlParts.push(signatureHtml);
  }

  const htmlContent = htmlParts.join("");

  const plainTextParts = [];

  if (includeStandardText) {
    plainTextParts.push(greeting);
    plainTextParts.push("");
  }

  plainTextParts.push(...selectedPlainBodies);

  if (includeStandardText) {
    plainTextParts.push("");
    plainTextParts.push(signatureText);
  }

  const plainTextContent = plainTextParts.join("\n\n");

  try {
    const clipboardItem = new ClipboardItem({
      "text/html": new Blob([htmlContent], { type: "text/html" }),
      "text/plain": new Blob([plainTextContent], { type: "text/plain" })
    });

    await navigator.clipboard.write([clipboardItem]);

    statusMessage.textContent = "Email text copied with embedded links.";
  } catch (error) {
    console.error("Rich copy failed:", error);

    try {
      await navigator.clipboard.writeText(plainTextContent);
      statusMessage.textContent =
        "Copied as plain text. Embedded links may not be preserved.";
    } catch (plainError) {
      console.error("Plain copy failed:", plainError);
      statusMessage.textContent =
        "Copy failed. You can manually select and copy the preview text.";
    }
  }
}

function getSelectedTemplatesInClickOrder() {
  return selectedTemplateOrder
    .map(selectedId => templates.find(template => template.id === selectedId))
    .filter(template => template !== undefined);
}

function getTemplatePlainText(template) {
  if (template.bodyText) {
    return applyTemplateLogic(template.bodyText);
  }

  if (template.bodyHtml) {
    return applyTemplateLogic(stripHtml(template.bodyHtml));
  }

  if (template.body) {
    return applyTemplateLogic(template.body);
  }

  return "";
}

function getTemplateHtml(template) {
  if (template.bodyHtml) {
    return applyTemplateLogic(template.bodyHtml);
  }

  if (template.bodyText) {
    return textToHtml(applyTemplateLogic(template.bodyText));
  }

  if (template.body) {
    return textToHtml(applyTemplateLogic(template.body));
  }

  return "";
}

function applyTemplateLogic(text) {
  return String(text)
    .replaceAll("{{currentTerm}}", getCurrentEnrollmentTerm())
    .replaceAll("{{currentTermLower}}", getCurrentEnrollmentTerm().toLowerCase())
    .replaceAll("{{previousTerm}}", getPreviousEnrollmentTerm())
    .replaceAll("{{previousTermLower}}", getPreviousEnrollmentTerm().toLowerCase());
}

function getCurrentEnrollmentTerm() {
  const today = new Date();
  const month = today.getMonth() + 1;
  const day = today.getDate();
  const year = today.getFullYear();

  if (
    (month === 4 && day >= 1) ||
    month === 5 ||
    (month === 6 && day <= 30)
  ) {
    return `Summer ${year}`;
  }

  if (
    (month === 7 && day >= 1) ||
    month === 8 ||
    month === 9 ||
    (month === 10 && day <= 31)
  ) {
    return `Fall ${year}`;
  }

  if (
    (month === 11 && day >= 1) ||
    month === 12
  ) {
    return `Spring ${year + 1}`;
  }

  if (
    month === 1 ||
    month === 2 ||
    (month === 3 && day <= 31)
  ) {
    return `Spring ${year}`;
  }

  return `Spring ${year}`;
}

function getPreviousEnrollmentTerm() {
  const today = new Date();
  const month = today.getMonth() + 1;
  const day = today.getDate();
  const year = today.getFullYear();

  if (
    month === 1 ||
    month === 2 ||
    (month === 3 && day <= 31)
  ) {
    return `Fall ${year - 1}`;
  }

  if (
    (month === 4 && day >= 1) ||
    month === 5 ||
    (month === 6 && day <= 30)
  ) {
    return `Spring ${year}`;
  }

  if (
    (month === 7 && day >= 1) ||
    month === 8 ||
    month === 9 ||
    (month === 10 && day <= 31)
  ) {
    return `Summer ${year}`;
  }

  if (
    (month === 11 && day >= 1) ||
    month === 12
  ) {
    return `Fall ${year}`;
  }

  return `Fall ${year - 1}`;
}

function loadSavedPins() {
  try {
    const savedPins = JSON.parse(localStorage.getItem("pinnedTemplates") || "[]");
    pinnedTemplates = new Set(savedPins);
  } catch (error) {
    console.error("Could not load saved pins:", error);
    pinnedTemplates = new Set();
  }
}

function savePinnedTemplates() {
  localStorage.setItem(
    "pinnedTemplates",
    JSON.stringify(Array.from(pinnedTemplates))
  );
}

function loadSavedCollapsedCategories() {
  try {
    const savedCollapsed = JSON.parse(
      localStorage.getItem("collapsedCategories") || "[]"
    );

    collapsedCategories = new Set(savedCollapsed);
  } catch (error) {
    console.error("Could not load collapsed categories:", error);
    collapsedCategories = new Set();
  }
}

function saveCollapsedCategories() {
  localStorage.setItem(
    "collapsedCategories",
    JSON.stringify(Array.from(collapsedCategories))
  );
}

function stripHtml(html) {
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = html;
  return tempDiv.textContent || tempDiv.innerText || "";
}

function textToHtml(text) {
  const escapedText = escapeHtml(text);

  return `<p>${escapedText
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br>")}</p>`;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ── Tool drop ────────────────────────────────────────────────────────────

function initToolDropdown() {
  const btn = document.getElementById("titleDropdownBtn");
  const menu = document.getElementById("titleDropdownMenu");

  // Load the last selected tool when the popup opens
  const savedTool = localStorage.getItem("activeTool") || "templates";
  switchTool(savedTool);

  btn.addEventListener("click", e => {
    e.stopPropagation();
    menu.classList.toggle("hidden");
  });

  menu.addEventListener("click", e => {
    e.stopPropagation();
  });

  document.addEventListener("click", () => {
    menu.classList.add("hidden");
  });

  menu.querySelectorAll(".dropdown-item").forEach(item => {
    item.addEventListener("click", () => {
      const selectedTool = item.dataset.tool;

      switchTool(selectedTool);

      // Save the selected tool so it stays selected next time
      localStorage.setItem("activeTool", selectedTool);

      menu.classList.add("hidden");
    });
  });
}

function switchTool(tool) {
  const templatesPanel = document.getElementById("templatesPanel");
  const pdfPanel = document.getElementById("pdfHighlighterPanel");

  if (tool === "pdfHighlighter") {
    templatesPanel.classList.add("hidden");
    pdfPanel.classList.remove("hidden");
  } else {
    pdfPanel.classList.add("hidden");
    templatesPanel.classList.remove("hidden");
  }

  document.querySelectorAll(".dropdown-item").forEach(item => {
    item.classList.toggle("active", item.dataset.tool === tool);
  });

  setActiveToolTitle(tool);
}

function setActiveToolTitle(toolName) {
  const activeToolTitle = document.getElementById("activeToolTitle");

  if (!activeToolTitle) return;

  if (toolName === "pdfHighlighter") {
    activeToolTitle.textContent = "Specialist PDF Assistant";
  } else {
    activeToolTitle.textContent = "VMSDEP Templates";
  }
}
// ── PDF Keyword Highlighter ──────────────────────────────────────────────────


function initPdfHighlighter() {
  document.getElementById("openViewerBtn").addEventListener("click", openPdfViewer);
}


async function openPdfViewer() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  openPdfViewerForTab(tab);
}

function openPdfViewerForTab(tab) {
  const viewerUrl =
    chrome.runtime.getURL("viewer.html") + "?url=" + encodeURIComponent(tab.url);
  chrome.tabs.create({ url: viewerUrl });
  window.close();
}


