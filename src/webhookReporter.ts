import * as vscode from "vscode";
import { Participant } from "./participantStore";
import { Section } from "./sectionsLoader";

export interface CompletionEvent {
  participant: Participant;
  section: Section;
  action: "completed" | "started";
  codespace: string;
  workshop: string;
}

export class WebhookReporter {
  private log: vscode.OutputChannel;

  constructor(log: vscode.OutputChannel) {
    this.log = log;
  }

  private getWebhookUrl(): string {
    return vscode.workspace
      .getConfiguration("workshopTracker")
      .get<string>("webhookUrl", "");
  }

  private getWorkshopName(): string {
    return vscode.workspace
      .getConfiguration("workshopTracker")
      .get<string>("workshopName", "Solace Agent Mesh Workshop");
  }

  async report(event: CompletionEvent): Promise<void> {
    const url = this.getWebhookUrl();
    if (!url) return; // silently skip if not configured

    const p = event.participant;
    const payload = {
      workshop:     this.getWorkshopName(),
      codespace:    event.codespace,
      gitName:      p.gitName,
      gitEmail:     p.gitEmail,
      githubUser:   p.githubUser,
      name:         p.name  || p.gitName  || p.githubUser || "",
      email:        p.email || p.gitEmail || p.githubEmail || "",
      sectionId:    event.section.id,
      sectionTitle: event.section.title,
      action:       event.action
    };

    this.log.appendLine(`[WorkshopTracker] POST ${url} — section: ${event.section.id} (${event.action})`);
    try {
      const res = await fetch(url, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload)
      });

      if (!res.ok) {
        this.log.appendLine(`[WorkshopTracker] Webhook responded ${res.status}`);
      } else {
        this.log.appendLine(`[WorkshopTracker] Webhook OK ${res.status}`);
      }
    } catch (err) {
      // Non-blocking — never surface network errors to participant
      this.log.appendLine(`[WorkshopTracker] Webhook post failed: ${err}`);
    }
  }

  async reportReset(event: { participant: Participant; codespace: string }): Promise<void> {
    const url = this.getWebhookUrl();
    if (!url) return;

    const p = event.participant;
    const payload = {
      action:     "reset",
      workshop:   this.getWorkshopName(),
      codespace:  event.codespace,
      gitName:    p.gitName,
      gitEmail:   p.gitEmail,
      githubUser: p.githubUser,
      name:       p.name  || p.gitName  || p.githubUser || "",
      email:      p.email || p.gitEmail || p.githubEmail || ""
    };

    try {
      await fetch(url, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload)
      });
    } catch (err) {
      this.log.appendLine(`[WorkshopTracker] Webhook reset failed: ${err}`);
    }
  }

  async reportDeleteSections(event: {
    participant: Participant;
    sections: Section[];
    codespace: string;
  }): Promise<void> {
    const url = this.getWebhookUrl();
    if (!url) return;

    const p = event.participant;
    const payload = {
      action:     "deleteSections",
      workshop:   this.getWorkshopName(),
      codespace:  event.codespace,
      gitName:    p.gitName,
      gitEmail:   p.gitEmail,
      githubUser: p.githubUser,
      name:       p.name  || p.gitName  || p.githubUser || "",
      email:      p.email || p.gitEmail || p.githubEmail || "",
      sectionIds: event.sections.map(s => s.id)
    };

    try {
      await fetch(url, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload)
      });
    } catch (err) {
      this.log.appendLine(`[WorkshopTracker] Webhook deleteSections failed: ${err}`);
    }
  }

  async reportFeedback(event: {
    participant: Participant;
    section: Section;
    feedback: string;
    codespace: string;
  }): Promise<void> {
    const url = this.getWebhookUrl();
    if (!url) return;

    const p = event.participant;
    const payload = {
      action:       "feedback",
      workshop:     this.getWorkshopName(),
      codespace:    event.codespace,
      gitName:      p.gitName,
      gitEmail:     p.gitEmail,
      githubUser:   p.githubUser,
      name:         p.name  || p.gitName  || p.githubUser || "",
      email:        p.email || p.gitEmail || p.githubEmail || "",
      sectionId:    event.section.id,
      sectionTitle: event.section.title,
      feedback:     event.feedback
    };

    try {
      await fetch(url, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload)
      });
    } catch (err) {
      this.log.appendLine(`[WorkshopTracker] Webhook feedback failed: ${err}`);
    }
  }

  static getCodespaceName(): string {
    return process.env["CODESPACE_NAME"] ?? process.env["HOSTNAME"] ?? "local";
  }
}
