# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A VS Code extension that tracks participant progress through Solace Agent Mesh workshop sections in GitHub Codespaces. It logs real-time progress to Google Sheets via a webhook and persists state using VS Code's `globalState` API.

## Build and Development Commands

```bash
npm install          # Install dev dependencies (TypeScript, @types/vscode, @types/node)
npm run compile      # Compile TypeScript to out/ directory
npm run watch        # Watch mode for development (auto-recompile on changes)
npx @vscode/vsce package  # Package into .vsix for distribution
```

There is no test framework configured. Testing is done by installing and running the extension manually.

To install and test locally:
```bash
code --install-extension workshop-tracker-1.0.0.vsix
```

## Architecture

The extension has four TypeScript source files in `src/` and a Google Apps Script backend:

| File | Role |
|------|------|
| `extension.ts` | Entry point: status bar, command registration, reminder timer, file watcher |
| `panel.ts` | WebView UI: generates HTML/CSS/JS for the checklist, handles messages from the webview |
| `participantStore.ts` | State management: identity detection, progress persistence via `globalState` |
| `sectionsLoader.ts` | Loads `workshop-sections.json` with caching and fallback defaults |
| `webhookReporter.ts` | HTTP client: POSTs events to Google Apps Script webhook (fire-and-forget) |
| `google-apps-script/Code.gs` | Backend: Google Sheets handler with `doPost`/`doGet` endpoints |

### Key Data Flow

```
User checks a section
  → WebView postMessage("sectionToggle")
  → panel.ts → participantStore.markCompleted()
  → webhookReporter.report()
  → POST to Google Apps Script
  → Code.gs appends row to Completions sheet
  → Status bar updates
```

### Identity Detection Priority

`participantStore.ts` resolves the participant identity in this order:
1. Git config (`git config user.name/email`) via `execSync`
2. GitHub OAuth via VS Code's built-in auth API (silent, non-intrusive)
3. `CODESPACE_NAME` environment variable as fallback

All resolved identifiers are sent to Google Sheets for redundancy.

### Workshop Sections

Sections are defined in `workshop-sections.json` at the workspace root (not in the extension source). The extension watches this file and reloads the UI live when it changes — no rebuild required. If the file is missing or malformed, defaults are used.

### Cascading Checkbox Logic

- Checking a section marks all prior sections complete
- Unchecking a section marks all subsequent sections incomplete

This logic lives in `panel.ts` (webview side) and is also enforced in `participantStore.ts`.

### Google Sheets Backend

`Code.gs` is deployed as a Google Apps Script Web App (execute as ME, access: ANYONE). It manages two sheets:

- **Completions**: One row per section completion event
- **Feedback**: One row per feedback submission

All writes use `appendRow()` (concurrent-safe, no read-modify-write). Participant matching for deletes uses a multi-identifier strategy (codespace name, git name, git email, GitHub user, or email).

## Deployment

For GitHub Codespaces, add to `.devcontainer/devcontainer.json`:

```json
"settings": {
  "workshopTracker.webhookUrl": "https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec",
  "workshopTracker.workshopName": "Workshop Name"
},
"extensions": ["solace-workshops.workshop-tracker"]
```

## Extension Settings

Defined in `package.json` contributions:

| Setting | Description |
|---------|-------------|
| `workshopTracker.webhookUrl` | Google Apps Script Web App URL |
| `workshopTracker.workshopName` | Workshop name included in sheet rows |
| `workshopTracker.reminderEnabled` | Whether to show periodic reminder notifications |
| `workshopTracker.reminderIntervalMinutes` | Reminder interval (default: 30) |
