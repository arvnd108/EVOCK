// EVOCK Popup Controller
// Ready screen, one-click Preserve, live pipeline checklist, artifact result, and Settings.

import { MSG, PRESERVE_STAGES } from "../shared/messages.js";
import { directionLabel } from "../shared/message-direction.js";

const BRIDGE_HEALTH_URL = "http://localhost:8787/health";

/** Escape a string for safe insertion into innerHTML. Model/tab text is untrusted. */
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

/** Human label for a provider id, tolerant of the "unknown"/failed case. */
function providerLabel(id) {
  if (id === "vision") return "Vision AI";
  if (id === "demo") return "Demo Provider";
  return "AI extraction";
}

document.addEventListener("DOMContentLoaded", () => {
  // Views
  const viewReady = document.getElementById("view-ready");
  const viewProgress = document.getElementById("view-progress");
  const viewSettings = document.getElementById("view-settings");

  // Ready screen
  const readyPageTitle = document.getElementById("ready-page-title");
  const readyPageUrl = document.getElementById("ready-page-url");
  const readyPageDomain = document.getElementById("ready-page-domain");
  const preserveBtn = document.getElementById("preserve-btn");
  const openVaultBtn = document.getElementById("open-vault-btn");
  const settingsBtn = document.getElementById("settings-btn");
  const readyNotice = document.getElementById("ready-notice");
  const readyProviderStatus = document.getElementById("ready-provider-status");

  // Progress / result screen
  const progressHeading = document.getElementById("progress-heading");
  const stageList = document.getElementById("stage-list");
  const captureSuccessPanel = document.getElementById("capture-success-panel");
  const captureErrorPanel = document.getElementById("capture-error-panel");
  const resultBanner = document.getElementById("result-banner");
  const resultBannerIcon = document.getElementById("result-banner-icon");
  const resultBannerText = document.getElementById("result-banner-text");
  const preservedIdLine = document.getElementById("preserved-id-line");
  const errorMessageEl = document.getElementById("error-message");
  const screenshotImg = document.getElementById("screenshot-img");
  const resetBtn = document.getElementById("reset-btn");
  const tryAgainBtn = document.getElementById("try-again-btn");

  // Capture metadata
  const metaMime = document.getElementById("meta-mime");
  const metaDimensions = document.getElementById("meta-dimensions");
  const metaTime = document.getElementById("meta-time");
  const metaDomain = document.getElementById("meta-domain");
  const metaUrl = document.getElementById("meta-url");
  const metaMethod = document.getElementById("meta-method");

  // Extraction result
  const extractionPanel = document.getElementById("extraction-panel");
  const extractProviderLabel = document.getElementById("extract-provider-label");
  const extractSuccessView = document.getElementById("extract-success-view");
  const extractFailedView = document.getElementById("extract-failed-view");
  const extractPlatform = document.getElementById("extract-platform");
  const extractContact = document.getElementById("extract-contact");
  const extractMessagesCount = document.getElementById("extract-messages-count");
  const extractTime = document.getElementById("extract-time");
  const extractMessagesList = document.getElementById("extract-messages-list");

  // Settings
  const settingProvider = document.getElementById("setting-provider");
  const settingModel = document.getElementById("setting-model");
  const settingsBackBtn = document.getElementById("settings-back-btn");
  const settingsDoneBtn = document.getElementById("settings-done-btn");
  const bridgeBadge = document.getElementById("bridge-status-badge");

  /** @param {"ready"|"progress"|"settings"} target */
  function showView(target) {
    viewReady.hidden = target !== "ready";
    viewProgress.hidden = target !== "progress";
    viewSettings.hidden = target !== "settings";
  }

  // ---------------------------------------------------------------------------
  // Pipeline checklist — rendered from the shared PRESERVE_STAGES list so it
  // stays in lockstep with the service worker's PRESERVE_PROGRESS events.
  // ---------------------------------------------------------------------------
  const STAGE_LABELS = {
    capture: "Screenshot capture",
    extract: "AI extraction",
    hash: "Integrity hash (SHA-256)",
    sign: "Digital signature (ECDSA P-256)",
    timestamp: "Timestamp (device clock)",
    encrypt: "Encryption (AES-GCM)",
    store: "Vault storage"
  };
  const STAGE_ICON = { pending: "○", active: "⏳", done: "✓", failed: "✕", degraded: "⚠" };
  const STAGE_CLASS = {
    pending: "stage-pending",
    active: "stage-active",
    done: "stage-completed",
    failed: "stage-failed",
    degraded: "stage-degraded"
  };

  /** @type {Record<string,{state:string,hint:string}>} */
  let stageStates = {};

  function resetStages() {
    stageStates = {};
    for (const s of PRESERVE_STAGES) stageStates[s] = { state: "pending", hint: "" };
    renderStages();
  }

  function setStage(stage, state, hint) {
    if (!stageStates[stage]) stageStates[stage] = { state: "pending", hint: "" };
    stageStates[stage].state = state;
    if (hint !== undefined) stageStates[stage].hint = hint;
    renderStages();
  }

  function renderStages() {
    stageList.innerHTML = PRESERVE_STAGES.map((s) => {
      const { state, hint } = stageStates[s] || { state: "pending", hint: "" };
      const hintHtml = hint ? `<span class="stage-hint">${esc(hint)}</span>` : "";
      return `<li class="stage-item ${STAGE_CLASS[state] || "stage-pending"}">` +
        `<span class="stage-icon">${STAGE_ICON[state] || "○"}</span>` +
        `<span class="stage-text">${esc(STAGE_LABELS[s] || s)}${hintHtml}</span></li>`;
    }).join("");
  }

  // Live updates from the service worker as it runs the pipeline. This is a
  // no-op today (the worker does not stream yet) and becomes live once the
  // A7 orchestrator emits PRESERVE_PROGRESS — no popup change needed then.
  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== MSG.PRESERVE_PROGRESS) return;
    const { stage, ok, error } = message.payload || {};
    if (!stage || !(stage in STAGE_LABELS)) return;
    if (ok === true) setStage(stage, "done", "");
    else if (ok === false) setStage(stage, stage === "extract" ? "degraded" : "failed", error || "");
    else setStage(stage, "active", "");
  });

  // ---------------------------------------------------------------------------
  // Ready screen context
  // ---------------------------------------------------------------------------
  async function updateReadyProviderStatus() {
    if (!readyProviderStatus) return;
    const provider = settingProvider.value || "vision";
    if (provider === "demo") {
      readyProviderStatus.textContent = "Demo Provider (offline, deterministic)";
      return;
    }
    try {
      const response = await fetch(BRIDGE_HEALTH_URL, { method: "GET" });
      if (response.ok) {
        const data = await response.json();
        readyProviderStatus.textContent = data.apiKeyConfigured
          ? `Vision AI — bridge online (${data.model || "ready"})`
          : "Vision AI — bridge online, but no API key in bridge/.env";
        return;
      }
    } catch {
      /* fall through to offline */
    }
    readyProviderStatus.textContent = "Vision AI — bridge offline (run: npm start in bridge/)";
  }

  async function loadProviderSetting() {
    try {
      if (chrome?.storage?.local) {
        const data = await chrome.storage.local.get("extractionProviderId");
        settingProvider.value = data?.extractionProviderId || "vision";
      }
    } catch (err) {
      console.warn("Could not load provider setting:", err);
    }
    await updateReadyProviderStatus();
  }

  settingProvider.addEventListener("change", async () => {
    try {
      if (chrome?.storage?.local) {
        await chrome.storage.local.set({ extractionProviderId: settingProvider.value });
      }
    } catch (err) {
      console.warn("Could not save provider setting:", err);
    }
    await updateReadyProviderStatus();
  });

  async function loadActiveTabInfo() {
    readyNotice.hidden = true;
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!activeTab) {
        readyPageTitle.textContent = "No active tab detected";
        readyPageUrl.textContent = "—";
        readyPageDomain.textContent = "—";
        return;
      }
      readyPageTitle.textContent = activeTab.title || "Untitled page";
      readyPageUrl.textContent = activeTab.url || "No URL available";
      let domain = "—";
      if (activeTab.url) {
        try { domain = new URL(activeTab.url).hostname || "—"; } catch { domain = "—"; }
      }
      readyPageDomain.textContent = domain;
    } catch (error) {
      // Don't write the error into the URL field — surface it in the notice.
      readyPageTitle.textContent = "Could not read the active tab";
      readyPageUrl.textContent = "—";
      readyPageDomain.textContent = "—";
      readyNotice.textContent = error?.message || "Tab query failed.";
      readyNotice.hidden = false;
    }
  }

  // ---------------------------------------------------------------------------
  // One-click PRESERVE EVIDENCE
  // ---------------------------------------------------------------------------
  let waitHintTimer = null;

  preserveBtn.addEventListener("click", async () => {
    showView("progress");
    progressHeading.textContent = "Preserving Evidence…";

    resetStages();
    setStage("capture", "active");

    captureSuccessPanel.hidden = true;
    captureErrorPanel.hidden = true;
    extractionPanel.hidden = true;
    extractSuccessView.hidden = true;
    extractFailedView.hidden = true;

    // If nothing has come back after a few seconds, say so rather than
    // leaving a silent spinner — the bridge/model can take up to ~30s.
    clearTimeout(waitHintTimer);
    waitHintTimer = setTimeout(() => {
      const active = PRESERVE_STAGES.find((s) => stageStates[s]?.state === "active");
      if (active) setStage(active, "active", "Still working — the AI service can take up to 30s to respond.");
    }, 8000);

    try {
      const response = await chrome.runtime.sendMessage({ type: MSG.PRESERVE_START });
      clearTimeout(waitHintTimer);

      // No capture at all → there is nothing to preserve. This is the only
      // truly fatal outcome.
      if (!response || !response.capture) {
        handleCaptureFailure(response?.error || response?.message || "Failed to capture screenshot.");
        return;
      }

      const { capture, extraction, evidence_id, degraded } = response;
      const stored = response.ok === true && !!evidence_id;

      // Capture is in hand regardless of what happened downstream.
      if (stageStates.capture?.state !== "done") setStage("capture", "done", "");
      renderCaptureMeta(capture);
      renderExtractionResult(extraction);

      if (stored) {
        // hash → encrypt → sign → timestamp → store all completed. The
        // PRESERVE_PROGRESS stream usually paints these live; set them here too
        // so a dropped event can't leave a stage looking stuck.
        for (const s of ["hash", "encrypt", "sign", "timestamp", "store"]) {
          if (stageStates[s]?.state !== "failed") setStage(s, "done", "");
        }
        progressHeading.textContent = `Evidence Preserved — ${evidence_id}`;
        setBanner("success", "✓", `EVIDENCE PRESERVED — ${evidence_id}`);
        preservedIdLine.hidden = false;
        preservedIdLine.textContent = degraded
          ? "Stored. AI extraction was unavailable — the screenshot and its fingerprint are preserved."
          : "Stored in the local vault, hashed, signed and encrypted.";
      } else {
        // Capture succeeded but the vault write did not. The screenshot bytes
        // are shown below; they are not lost, but they are not yet sealed.
        const active = PRESERVE_STAGES.find((s) => stageStates[s]?.state === "active");
        if (active) setStage(active, "failed", "");
        for (const s of ["hash", "encrypt", "sign", "timestamp", "store"]) {
          if (stageStates[s]?.state === "pending") setStage(s, "failed", "");
        }
        progressHeading.textContent = "Preservation Incomplete";
        setBanner("error", "⚠", "Screenshot captured but not saved to the vault");
        preservedIdLine.hidden = false;
        preservedIdLine.textContent =
          response.error || "The vault write failed. The screenshot below was not stored.";
      }

      captureSuccessPanel.hidden = false;
    } catch (error) {
      clearTimeout(waitHintTimer);
      handleCaptureFailure(error?.message || "Failed to communicate with the service worker.");
    }
  });

  /** @param {"success"|"error"} kind */
  function setBanner(kind, icon, text) {
    resultBanner.className =
      "result-banner " + (kind === "success" ? "result-banner-success" : "result-banner-error");
    resultBannerIcon.textContent = icon;
    resultBannerText.textContent = text;
  }

  function renderCaptureMeta(capture) {
    screenshotImg.src = capture.screenshotDataUrl;
    metaMime.textContent = capture.mimeType || "image/png";
    metaDimensions.textContent = `${capture.width} × ${capture.height} px`;
    metaTime.textContent = capture.capturedAt || "—";
    metaDomain.textContent = capture.domain || "—";
    metaUrl.textContent = capture.url || "—";
    metaMethod.textContent = capture.captureMethod || "browser_extension.captureVisibleTab";
  }

  function renderExtractionResult(extraction) {
    if (!extraction) return;
    extractionPanel.hidden = false;
    extractProviderLabel.textContent = providerLabel(extraction.provider);

    if (extraction.status === "ok" && extraction.data) {
      if (stageStates.extract?.state !== "done") setStage("extract", "done", "");
      extractFailedView.hidden = true;
      extractSuccessView.hidden = false;
      renderExtraction(extraction.data);
    } else {
      // Rule 2: non-alarming degradation. The capture is still preserved.
      setStage("extract", "degraded", extraction.error || "");
      extractSuccessView.hidden = true;
      extractFailedView.hidden = false;
    }
  }

  function renderExtraction(data) {
    extractPlatform.textContent = data.platform || "—";
    extractContact.textContent = data.contact_name || "—";
    extractMessagesCount.textContent = `${data.messages?.length || 0} message(s)`;
    extractTime.textContent = data.visible_time || "—";

    const msgs = Array.isArray(data.messages) ? data.messages : [];
    const contactName = data.contact_name || "Contact";

    if (msgs.length === 0) {
      extractMessagesList.innerHTML = '<div class="extracted-msg-empty">No messages extracted</div>';
      return;
    }

    extractMessagesList.innerHTML = msgs.map((m) => {
      let label;
      if (m.type === "incoming") label = contactName;
      else if (m.type === "outgoing") label = "You";
      else label = m.sender || "Unknown";

      const ts = m.visible_timestamp
        ? `<span class="extracted-msg-ts">${esc(m.visible_timestamp)}</span>`
        : "";
      const dir = `<span class="extracted-msg-type">${esc(directionLabel(m))}</span>`;
      return `<div class="extracted-msg">
          <div class="extracted-msg-header">
            <span class="extracted-msg-sender">${esc(label)}</span>${dir}${ts}
          </div>
          <div class="extracted-msg-text">${esc(m.text || "")}</div>
        </div>`;
    }).join("");
  }

  function handleCaptureFailure(message) {
    clearTimeout(waitHintTimer);
    const active = PRESERVE_STAGES.find((s) => stageStates[s]?.state === "active") || "capture";
    setStage(active, "failed", "");
    progressHeading.textContent = "Preservation Failed";
    errorMessageEl.textContent = message;
    captureErrorPanel.hidden = false;
  }

  resetBtn.addEventListener("click", async () => {
    await loadActiveTabInfo();
    showView("ready");
  });
  tryAgainBtn.addEventListener("click", async () => {
    await loadActiveTabInfo();
    showView("ready");
  });

  openVaultBtn.addEventListener("click", () => {
    // Full-page vault (Role C, step 03). Opened as its own extension page rather
    // than rendered in the popup, which is too small for the timeline.
    chrome.tabs.create({ url: chrome.runtime.getURL("src/vault/vault.html") });
  });

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------
  async function checkBridgeHealth() {
    if (!bridgeBadge) return;
    bridgeBadge.className = "badge badge-offline";
    bridgeBadge.textContent = "Checking bridge…";
    if (settingModel) settingModel.value = "";

    try {
      const response = await fetch(BRIDGE_HEALTH_URL, { method: "GET" });
      if (response.ok) {
        const data = await response.json();
        bridgeBadge.className = "badge badge-online";
        bridgeBadge.textContent = data.apiKeyConfigured
          ? "Bridge: connected"
          : "Bridge: connected (no API key in .env)";
        if (settingModel) settingModel.value = data.model || "";
        return;
      }
    } catch {
      /* offline */
    }
    bridgeBadge.className = "badge badge-offline";
    bridgeBadge.textContent = "Bridge: not running";
  }

  settingsBtn.addEventListener("click", async () => {
    await loadProviderSetting();
    await checkBridgeHealth();
    showView("settings");
  });
  settingsBackBtn.addEventListener("click", async () => {
    await updateReadyProviderStatus();
    showView("ready");
  });
  settingsDoneBtn.addEventListener("click", async () => {
    await updateReadyProviderStatus();
    showView("ready");
  });

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------
  resetStages();
  loadProviderSetting();
  loadActiveTabInfo();
});
