import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

export interface Section {
  id: string;
  title: string;
  description?: string;
  triggerFile?: string;
}

const FALLBACK_SECTIONS: Section[] = [
  { id: "s1", title: "Environment Setup",           description: "Open the Codespace and verify the environment" },
  { id: "s2", title: "Connect to the Broker",       description: "Configure and connect to Solace PubSub+" },
  { id: "s3", title: "Publish Your First Event",    description: "Send a message to a topic" },
  { id: "s4", title: "Subscribe to a Topic",        description: "Receive messages from a topic" },
  { id: "s5", title: "Create Your First Agent",     description: "Define an agent in the SAM framework" },
  { id: "s6", title: "Agent-to-Agent Messaging",    description: "Wire two agents together" },
  { id: "s7", title: "Add a Tool to Your Agent",    description: "Extend agent capabilities with a tool" },
  { id: "s8", title: "Deploy the Agent Mesh",       description: "Run the full mesh end-to-end" }
];

export class SectionsLoader {
  private cache: Section[] | null = null;

  async load(): Promise<Section[]> {
    if (this.cache) return this.cache;

    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      this.cache = FALLBACK_SECTIONS;
      return this.cache;
    }

    for (const folder of folders) {
      const filePath = path.join(folder.uri.fsPath, "workshop-sections.json");
      if (fs.existsSync(filePath)) {
        try {
          const raw = fs.readFileSync(filePath, "utf8");
          const parsed = JSON.parse(raw) as Section[];
          if (Array.isArray(parsed) && parsed.length > 0) {
            this.cache = parsed;
            return this.cache;
          }
        } catch (e) {
          vscode.window.showWarningMessage(
            `workshop-sections.json parse error: ${e}. Using default sections.`
          );
        }
      }
    }

    this.cache = FALLBACK_SECTIONS;
    return this.cache;
  }

  invalidate(): void {
    this.cache = null;
  }
}
