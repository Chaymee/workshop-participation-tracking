import * as vscode from "vscode";
import { ParticipantStore } from "./participantStore";
import { Section } from "./sectionsLoader";
import { WebhookReporter } from "./webhookReporter";
import { outputChannel } from "./extension";

export class WorkshopPanel {
  private panel: vscode.WebviewPanel;
  private store: ParticipantStore;
  private sections: Section[];
  private reporter: WebhookReporter;
  private onDispose: () => void;
  private progressChangedEmitter = new vscode.EventEmitter<void>();
  readonly onProgressChanged = this.progressChangedEmitter.event;

  constructor(
    context: vscode.ExtensionContext,
    store: ParticipantStore,
    sections: Section[],
    onDispose: () => void
  ) {
    this.store    = store;
    this.sections = sections;
    this.reporter = new WebhookReporter(outputChannel);
    this.onDispose = onDispose;

    this.panel = vscode.window.createWebviewPanel(
      "workshopTracker",
      "Workshop Tracker",
      vscode.ViewColumn.One,
      {
        enableScripts:       true,
        retainContextWhenHidden: true
      }
    );

    this.panel.onDidDispose(() => {
      this.progressChangedEmitter.dispose();
      onDispose();
    });

    this.panel.webview.onDidReceiveMessage(msg => this.handleMessage(msg));

    this.render();
    this.initIdentity();
  }

  reveal() { this.panel.reveal(); }

  refresh() { this.render(); }

  refreshSections(sections: Section[]) {
    this.sections = sections;
    this.render();
  }

  // ── Message handler ──────────────────────────────────────────

  private async handleMessage(msg: any) {
    switch (msg.type) {

      case "sectionToggle": {
        const sectionIdx = this.sections.findIndex(s => s.id === msg.sectionId);
        if (sectionIdx === -1) break;

        const participant = this.store.getParticipant();
        const codespace = WebhookReporter.getCodespaceName();

        if (msg.checked) {
          // Cascade: mark all sections up to and including the toggled one
          for (let i = 0; i <= sectionIdx; i++) {
            const s = this.sections[i];
            if (!this.store.isCompleted(s.id)) {
              await this.store.markCompleted(s.id);
              this.reporter.report({
                participant, section: s, action: "completed",
                codespace, workshop: ""
              });
            }
          }
        } else {
          // Cascade: uncheck the toggled section and all sections after it
          for (let i = sectionIdx; i < this.sections.length; i++) {
            const s = this.sections[i];
            if (this.store.isCompleted(s.id)) {
              await this.store.markUncompleted(s.id);
            }
            // Clear feedback for unchecked sections
            if (this.store.getSectionFeedback(s.id)) {
              await this.store.saveSectionFeedback(s.id, "");
            }
          }
          // No delete sent to backend — existing completed events are preserved
        }

        this.progressChangedEmitter.fire();
        this.render();
        break;
      }

      case "openSection": {
        const section = this.sections.find(s => s.id === msg.sectionId);
        if (!section?.triggerFile) break;

        const codespace = WebhookReporter.getCodespaceName();

        if (!this.store.isCompleted(section.id)) {
          const alreadyStarted = this.store.isStarted(section.id);
          if (!alreadyStarted) {
            await this.store.markStarted(section.id);
            this.progressChangedEmitter.fire();
            this.render();
          }
          // Ensure identity is resolved before reporting
          await this.store.tryFetchGitConfig();
          this.reporter.report({
            participant: this.store.getParticipant(),
            section, action: "started", codespace, workshop: ""
          });
        }

        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) break;
        const uri = vscode.Uri.joinPath(folders[0].uri, section.triggerFile);
        try {
          await vscode.commands.executeCommand("vscode.open", uri, vscode.ViewColumn.One);
        } catch {
          vscode.window.showWarningMessage(`Could not open ${section.triggerFile}`);
        }
        break;
      }

      case "sectionFeedback": {
        const section = this.sections.find(s => s.id === msg.sectionId);
        if (!section) break;

        await this.store.saveSectionFeedback(msg.sectionId, msg.feedback);

        const participant = this.store.getParticipant();
        this.reporter.reportFeedback({
          participant,
          section,
          feedback: msg.feedback,
          codespace: WebhookReporter.getCodespaceName()
        });
        break;
      }

      case "resetProgress": {
        const participant = this.store.getParticipant();
        await this.store.resetProgress();
        this.progressChangedEmitter.fire();
        this.render();

        // Remove this participant's rows from the Google Sheet
        this.reporter.reportReset({
          participant,
          codespace: WebhookReporter.getCodespaceName()
        });
        break;
      }
    }
  }

  // ── GitHub identity init ─────────────────────────────────────

  private async initIdentity() {
    // Pull git config (always available in Codespaces)
    const git = await this.store.tryFetchGitConfig();
    if (git.name || git.email) {
      this.panel.webview.postMessage({
        type: "gitConfigIdentity", gitName: git.name, gitEmail: git.email
      });
    }

    // Try GitHub OAuth for the username
    const gh = await this.store.tryFetchGitHubIdentity();
    if (gh.user) {
      this.panel.webview.postMessage({
        type: "githubIdentity", githubUser: gh.user, githubEmail: gh.email
      });
    }
  }

  // ── HTML render ──────────────────────────────────────────────

  private render() {
    const participant = this.store.getParticipant();
    const completed   = this.store.getCompleted();
    const started     = this.store.getStarted();
    const total       = this.sections.length;
    const doneCount   = completed.length;

    const feedback = this.store.getFeedback();
    const sectionsJson = JSON.stringify(
      this.sections.map(s => ({
        ...s,
        done:        completed.includes(s.id),
        started:     started.includes(s.id) && !completed.includes(s.id),
        feedback:    feedback[s.id] || "",
        triggerFile: s.triggerFile || ""
      }))
    );

    this.panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<title>Workshop Tracker</title>
<style>
  :root {
    --bg:        var(--vscode-editor-background);
    --fg:        var(--vscode-editor-foreground);
    --border:    var(--vscode-panel-border);
    --btn-bg:    var(--vscode-button-background);
    --btn-fg:    var(--vscode-button-foreground);
    --btn-hover: var(--vscode-button-hoverBackground);
    --accent:    var(--vscode-focusBorder);
    --success:   #4caf50;
    --card-bg:   var(--vscode-editorWidget-background);
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: var(--vscode-font-family);
    font-size:   var(--vscode-font-size);
    color: var(--fg);
    background: var(--bg);
    padding: 20px;
    max-width: 680px;
    margin: 0 auto;
  }

  h1 { font-size: 1.3em; margin-bottom: 4px; }
  .subtitle { opacity: 0.6; font-size: 0.85em; margin-bottom: 20px; }

  /* Progress bar */
  .progress-wrap {
    background: var(--border);
    border-radius: 6px;
    height: 8px;
    margin-bottom: 6px;
    overflow: hidden;
  }
  .progress-bar {
    height: 100%;
    background: var(--success);
    border-radius: 6px;
    transition: width 0.4s ease;
  }
  .progress-label {
    font-size: 0.8em;
    opacity: 0.7;
    margin-bottom: 20px;
    text-align: right;
  }

  /* Identity hint */
  .identity-hint {
    font-size: 0.8em;
    opacity: 0.55;
    margin-bottom: 20px;
  }

  .btn {
    padding: 6px 14px;
    background: var(--btn-bg);
    color: var(--btn-fg);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.9em;
    margin-top: 4px;
  }
  .btn:hover { background: var(--btn-hover); }
  .btn.ghost {
    background: transparent;
    color: var(--fg);
    border: 1px solid var(--border);
    opacity: 0.6;
    font-size: 0.8em;
  }
  .btn.ghost:hover { opacity: 1; }
  /* Sections */
  .sections-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
  }
  .sections-header h2 { font-size: 1em; opacity: 0.8; }

  .section-item {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    margin-bottom: 8px;
    padding: 12px 14px;
    transition: border-color 0.2s;
  }
  .section-item:hover { border-color: var(--accent); }
  .section-item.done { opacity: 0.75; }
  .section-item.done .section-title { text-decoration: line-through; }

  .section-row {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    cursor: pointer;
  }

  .section-check {
    width: 18px;
    height: 18px;
    margin-top: 2px;
    accent-color: var(--success);
    cursor: pointer;
    flex-shrink: 0;
  }

  .section-body { flex: 1; }
  .section-number { font-size: 0.75em; opacity: 0.5; }
  .section-title  { font-size: 0.95em; font-weight: 500; margin-bottom: 2px; }
  .section-desc   { font-size: 0.8em; opacity: 0.6; }

  .section-badges {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
    align-self: center;
  }

  .open-btn {
    font-size: 0.75em;
    padding: 2px 10px;
    border-radius: 10px;
    flex-shrink: 0;
    background: var(--btn-bg);
    color: var(--btn-fg);
    border: none;
    cursor: pointer;
  }
  .open-btn:hover { background: var(--btn-hover); }

  .inprogress-badge {
    font-size: 0.75em;
    padding: 2px 8px;
    border-radius: 10px;
    flex-shrink: 0;
    background: #f59e0b;
    color: white;
  }

  .done-badge, .fb-btn {
    font-size: 0.75em;
    padding: 2px 8px;
    border-radius: 10px;
    flex-shrink: 0;
    border: none;
    cursor: pointer;
  }
  .done-badge {
    background: var(--success);
    color: white;
  }
  .fb-btn {
    background: var(--accent);
    color: white;
    opacity: 0.8;
  }
  .fb-btn:hover { opacity: 1; }
  .fb-btn.has-feedback {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--fg);
    opacity: 0.6;
  }
  .fb-btn.has-feedback:hover { opacity: 1; }

  /* Feedback area inside card */
  .fb-area { margin-top: 10px; border-top: 1px solid var(--border); padding-top: 10px; }
  .fb-area textarea {
    width: 100%;
    min-height: 60px;
    padding: 6px 8px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-family: var(--vscode-font-family);
    font-size: 0.85em;
    resize: vertical;
  }
  .fb-area textarea:focus { outline: 1px solid var(--accent); }
  .fb-actions { margin-top: 6px; display: flex; align-items: center; gap: 8px; }
  .fb-text { font-size: 0.85em; opacity: 0.7; margin-top: 10px; border-top: 1px solid var(--border); padding-top: 8px; }
  .fb-text-label { font-size: 0.7em; opacity: 0.5; margin-bottom: 3px; }
  .fb-flash { font-size: 0.8em; color: var(--success); opacity: 0; transition: opacity 0.3s; }
  .fb-flash.show { opacity: 1; }

  .btn.danger {
    background: #d32f2f;
    color: white;
    font-size: 0.8em;
  }
  .btn.danger:hover { background: #b71c1c; }
  .confirm-msg { font-size: 0.8em; opacity: 0.7; margin-right: 8px; }

  .footer { margin-top: 24px; text-align: center; opacity: 0.4; font-size: 0.75em; }
</style>
</head>
<body>

<h1>🧩 Workshop Tracker</h1>
<p class="subtitle">Track your progress through the workshop sections</p>

<!-- Progress -->
<div class="progress-wrap">
  <div class="progress-bar" id="progressBar"
       style="width: ${total ? Math.round((doneCount/total)*100) : 0}%"></div>
</div>
<div class="progress-label" id="progressLabel">
  ${doneCount} of ${total} sections completed
</div>

<p class="identity-hint" id="identityHint">
  ${participant.gitName || participant.githubUser
    ? `Tracking as: <strong>${escapeHtml(participant.gitName || participant.githubUser)}</strong>${participant.gitEmail ? ` &lt;${escapeHtml(participant.gitEmail)}&gt;` : ""}`
    : "Detecting identity from git config..."}
</p>

<!-- Sections -->
<div class="sections-header">
  <h2>📋 Workshop Sections</h2>
  <span id="resetWrap">
    <button class="btn ghost" onclick="confirmReset()">Reset progress</button>
  </span>
</div>

<div id="sectionsList"></div>

<div class="footer">Workshop Tracker · Solace Workshops</div>

<script>
  const vscode    = acquireVsCodeApi();
  const sections  = ${sectionsJson};

  let toggling = false;

  function esc(str) {
    return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  function renderSections() {
    const list = document.getElementById("sectionsList");
    list.innerHTML = sections.map((s, i) => \`
      <div class="section-item \${s.done ? "done" : ""}" id="section-\${s.id}">
        <div class="section-row">
          <input class="section-check" type="checkbox" \${s.done ? "checked" : ""}
                 onclick="event.stopPropagation(); toggleSection('\${s.id}', event)" />
          <div class="section-body" onclick="\${s.triggerFile ? \`openSection('\${s.id}')\` : \`toggleSection('\${s.id}', event)\`}"
               style="\${s.triggerFile ? 'cursor:pointer;' : ''}">
            <div class="section-number">Section \${i + 1}</div>
            <div class="section-title">\${esc(s.title)}</div>
            \${s.description ? \`<div class="section-desc">\${esc(s.description)}</div>\` : ""}
          </div>
          <div class="section-badges">
            \${s.started ? '<span class="inprogress-badge">In Progress</span>' : ""}
            \${s.done ? '<span class="done-badge">Done</span>' : ""}
            \${s.done ? \`<button class="fb-btn \${s.feedback ? "has-feedback" : ""}"
                          onclick="event.stopPropagation(); toggleFeedback('\${s.id}')">
                          \${s.feedback ? "Feedback" : "Feedback"}
                        </button>\` : ""}
          </div>
        </div>
        <div class="fb-area" id="fb-area-\${s.id}" style="display:none;"></div>
        \${s.done && s.feedback ? \`<div class="fb-text" id="fb-text-\${s.id}" onclick="toggleFeedback('\${s.id}')">
          <div class="fb-text-label">Your feedback:</div>
          \${esc(s.feedback)}
        </div>\` : ""}
      </div>
    \`).join("");
  }

  function openSection(id) {
    vscode.postMessage({ type: "openSection", sectionId: id });
  }

  function toggleSection(id, evt) {
    if (evt) { evt.preventDefault(); evt.stopPropagation(); }
    if (toggling) return;
    toggling = true;

    const idx = sections.findIndex(x => x.id === id);
    if (idx === -1) { toggling = false; return; }
    const newState = !sections[idx].done;

    if (newState) {
      for (let i = 0; i <= idx; i++) sections[i].done = true;
    } else {
      for (let i = idx; i < sections.length; i++) sections[i].done = false;
    }

    renderSections();
    vscode.postMessage({ type: "sectionToggle", sectionId: id, checked: newState });
    setTimeout(() => { toggling = false; }, 300);
  }

  function confirmReset() {
    const wrap = document.getElementById("resetWrap");
    wrap.innerHTML =
      '<span class="confirm-msg">Are you sure?</span>' +
      '<button class="btn danger" onclick="doReset()">Yes, reset</button> ' +
      '<button class="btn ghost" onclick="cancelReset()">Cancel</button>';
  }

  function doReset() {
    vscode.postMessage({ type: "resetProgress" });
  }

  function cancelReset() {
    const wrap = document.getElementById("resetWrap");
    wrap.innerHTML = '<button class="btn ghost" onclick="confirmReset()">Reset progress</button>';
  }

  function toggleFeedback(sectionId) {
    const area = document.getElementById("fb-area-" + sectionId);
    const textDiv = document.getElementById("fb-text-" + sectionId);
    if (!area) return;

    if (area.style.display !== "none") {
      area.style.display = "none";
      if (textDiv) textDiv.style.display = "";
      return;
    }

    // Hide the saved text, show the form
    if (textDiv) textDiv.style.display = "none";

    const s = sections.find(x => x.id === sectionId);
    const existing = s ? (s.feedback || "") : "";
    area.style.display = "block";
    area.innerHTML =
      '<textarea id="fb-input-' + sectionId + '" placeholder="Share your feedback for this section...">' + esc(existing) + '</textarea>' +
      '<div class="fb-actions">' +
        '<button class="btn" onclick="submitSectionFeedback(\\'' + sectionId + '\\')">Submit</button>' +
        '<button class="btn ghost" onclick="closeFeedback(\\'' + sectionId + '\\')">Cancel</button>' +
        '<span class="fb-flash" id="fb-flash-' + sectionId + '"></span>' +
      '</div>';
    area.querySelector("textarea").focus();
  }

  function closeFeedback(sectionId) {
    const area = document.getElementById("fb-area-" + sectionId);
    const textDiv = document.getElementById("fb-text-" + sectionId);
    if (area) area.style.display = "none";
    if (textDiv) textDiv.style.display = "";
  }

  function submitSectionFeedback(sectionId) {
    const ta = document.getElementById("fb-input-" + sectionId);
    if (!ta) return;
    const text = ta.value.trim();
    if (!text) return;

    const s = sections.find(x => x.id === sectionId);
    if (s) s.feedback = text;

    vscode.postMessage({ type: "sectionFeedback", sectionId: sectionId, feedback: text });

    const flash = document.getElementById("fb-flash-" + sectionId);
    if (flash) {
      flash.textContent = "Sent!";
      flash.classList.add("show");
      setTimeout(() => {
        flash.classList.remove("show");
        renderSections();
      }, 1500);
    }
  }

  // Messages from extension host — update identity hint after async fetch
  window.addEventListener("message", e => {
    const msg = e.data;
    const hint = document.getElementById("identityHint");
    if (!hint) return;

    if (msg.type === "gitConfigIdentity" && (msg.gitName || msg.gitEmail)) {
      hint.innerHTML = \`Tracking as: <strong>\${esc(msg.gitName)}</strong>\${msg.gitEmail ? " &lt;" + esc(msg.gitEmail) + "&gt;" : ""}\`;
    }

    if (msg.type === "githubIdentity" && msg.githubUser) {
      hint.innerHTML = \`Tracking as: <strong>\${esc(msg.githubUser)}</strong>\${msg.githubEmail ? " &lt;" + esc(msg.githubEmail) + "&gt;" : ""}\`;
    }
  });

  renderSections();
</script>
</body>
</html>`;
  }
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
