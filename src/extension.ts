import * as vscode from "vscode";
import { WorkshopPanel } from "./panel";
import { ParticipantStore } from "./participantStore";
import { SectionsLoader, Section } from "./sectionsLoader";
import { WebhookReporter } from "./webhookReporter";

let statusBarItem: vscode.StatusBarItem;
let panel: WorkshopPanel | undefined;
let reminderTimer: ReturnType<typeof setInterval> | undefined;

export async function activate(context: vscode.ExtensionContext) {
  const store = new ParticipantStore(context);
  const sectionsLoader = new SectionsLoader();

  // ── Status Bar ──────────────────────────────────────────────
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.command = "workshopTracker.openPanel";
  statusBarItem.tooltip = "Click to open Workshop Tracker";
  updateStatusBar(store, sectionsLoader);
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // ── Open Panel Command ───────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("workshopTracker.openPanel", async () => {
      if (panel) {
        panel.reveal();
        return;
      }
      const sections = await sectionsLoader.load();
      panel = new WorkshopPanel(context, store, sections, () => {
        panel = undefined;
        updateStatusBar(store, sectionsLoader);
      });
      panel.onProgressChanged(() => updateStatusBar(store, sectionsLoader));
    })
  );

  // ── Reset Command ────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("workshopTracker.resetProgress", async () => {
      const confirm = await vscode.window.showWarningMessage(
        "Reset all workshop progress?",
        { modal: true },
        "Reset"
      );
      if (confirm === "Reset") {
        const participant = store.getParticipant();
        await store.resetProgress();
        updateStatusBar(store, sectionsLoader);
        panel?.refresh();
        vscode.window.showInformationMessage("Workshop progress reset.");

        // Remove this participant's rows from the Google Sheet
        const reporter = new WebhookReporter();
        reporter.reportReset({
          participant,
          codespace: WebhookReporter.getCodespaceName()
        });
      }
    })
  );

  // ── Auto-complete via triggerFile ───────────────────────────
  let previousUri: vscode.Uri | undefined =
    vscode.window.activeTextEditor?.document.uri;

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(async (editor) => {
      const prevUri = previousUri;
      previousUri = editor?.document.uri;

      const sections = await sectionsLoader.load();

      // started: emit once when a triggerFile is first opened
      if (editor) {
        const openedSection = findSectionByUri(sections, editor.document.uri);
        if (openedSection && !store.isStarted(openedSection.id) && !store.isCompleted(openedSection.id)) {
          await store.markStarted(openedSection.id);
          const reporter = new WebhookReporter();
          reporter.report({
            participant: store.getParticipant(),
            section: openedSection,
            action: "started",
            codespace: WebhookReporter.getCodespaceName(),
            workshop: ""
          });
          panel?.refresh();
          updateStatusBar(store, sectionsLoader);
        }
      }

      // completed: auto-fire when navigating forward to the next sequential section
      if (prevUri && editor) {
        const prevSection = findSectionByUri(sections, prevUri);
        const nextSection = findSectionByUri(sections, editor.document.uri);

        if (prevSection && nextSection) {
          const prevIdx = sections.findIndex(s => s.id === prevSection.id);
          const nextIdx = sections.findIndex(s => s.id === nextSection.id);

          if (nextIdx === prevIdx + 1 && !store.isCompleted(prevSection.id)) {
            await store.markCompleted(prevSection.id);
            const reporter = new WebhookReporter();
            reporter.report({
              participant: store.getParticipant(),
              section: prevSection,
              action: "completed",
              codespace: WebhookReporter.getCodespaceName(),
              workshop: ""
            });
            panel?.refresh();
            updateStatusBar(store, sectionsLoader);
          }
        }
      }
    })
  );

  // ── Watch for sections file changes ─────────────────────────
  const watcher = vscode.workspace.createFileSystemWatcher(
    "**/workshop-sections.json"
  );
  watcher.onDidChange(async () => {
    try {
      sectionsLoader.invalidate();
      updateStatusBar(store, sectionsLoader);
      panel?.refreshSections(await sectionsLoader.load());
    } catch (err) {
      console.warn("[WorkshopTracker] Failed to reload sections:", err);
    }
  });
  context.subscriptions.push(watcher);

  // ── Progress Reminder ───────────────────────────────────────
  startReminder(store, sectionsLoader);

  // Restart the timer if settings change
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration("workshopTracker.reminderEnabled") ||
          e.affectsConfiguration("workshopTracker.reminderIntervalMinutes")) {
        startReminder(store, sectionsLoader);
      }
    })
  );
}

async function updateStatusBar(
  store: ParticipantStore,
  loader: SectionsLoader
) {
  const sections = await loader.load();
  const completed = store.getCompletedCount();
  const total = sections.length;

  if (total === 0) {
    statusBarItem.text = "$(checklist) Workshop Tracker";
  } else if (completed === total) {
    statusBarItem.text = `$(pass-filled) Completed ${total}/${total} sections`;
    statusBarItem.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.warningBackground"
    );
  } else {
    statusBarItem.text = `$(checklist) Progress: ${completed}/${total} sections`;
    statusBarItem.backgroundColor = undefined;
  }
}

function startReminder(store: ParticipantStore, loader: SectionsLoader) {
  // Clear any existing timer
  if (reminderTimer) {
    clearInterval(reminderTimer);
    reminderTimer = undefined;
  }

  const config = vscode.workspace.getConfiguration("workshopTracker");
  const enabled = config.get<boolean>("reminderEnabled", true);
  if (!enabled) return;

  const minutes = config.get<number>("reminderIntervalMinutes", 30);
  const ms = minutes * 60 * 1000;

  reminderTimer = setInterval(async () => {
    const sections = await loader.load();
    const completed = store.getCompletedCount();
    const total = sections.length;

    // Don't remind if all sections are done
    if (total > 0 && completed >= total) return;

    const choice = await vscode.window.showInformationMessage(
      `Workshop Tracker: You've completed ${completed}/${total} sections. Don't forget to update your progress!`,
      "Open Tracker",
      "Dismiss"
    );

    if (choice === "Open Tracker") {
      vscode.commands.executeCommand("workshopTracker.openPanel");
    }
  }, ms);
}

function findSectionByUri(sections: Section[], uri: vscode.Uri): Section | undefined {
  const normalized = uri.fsPath.replace(/\\/g, "/");
  return sections.find(s =>
    s.triggerFile && normalized.endsWith(s.triggerFile.replace(/\\/g, "/"))
  );
}

export function deactivate() {
  if (reminderTimer) {
    clearInterval(reminderTimer);
    reminderTimer = undefined;
  }
}
