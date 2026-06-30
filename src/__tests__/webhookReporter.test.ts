import { WebhookReporter, CompletionEvent } from "../webhookReporter";
import { Participant } from "../participantStore";
import { Section } from "../sectionsLoader";

import * as vscode from "vscode";

const getConfigMock = vscode.workspace.getConfiguration as jest.Mock;

function makeLog() {
  return { appendLine: jest.fn() } as any;
}

function makeParticipant(overrides: Partial<Participant> = {}): Participant {
  return {
    name: "Alice", email: "alice@example.com",
    gitName: "Alice Git", gitEmail: "alice@git.com",
    githubUser: "alice-gh", githubEmail: "alice@github.com",
    ...overrides
  };
}

const section: Section = { id: "s1", title: "Environment Setup" };

function withConfig(webhookUrl: string, workshopName = "Test Workshop") {
  getConfigMock.mockReturnValue({
    get: jest.fn((key: string, def: unknown) => {
      if (key === "webhookUrl")    return webhookUrl;
      if (key === "workshopName")  return workshopName;
      return def;
    })
  });
}

const fetchMock = jest.fn();
global.fetch = fetchMock;

beforeEach(() => jest.clearAllMocks());

// ── report ───────────────────────────────────────────────────────────────────

describe("WebhookReporter.report", () => {
  it("does nothing when webhookUrl is not configured", async () => {
    withConfig("");
    const reporter = new WebhookReporter(makeLog());
    const event: CompletionEvent = {
      participant: makeParticipant(),
      section,
      action: "completed",
      codespace: "cs-123",
      workshop: "Test Workshop"
    };

    await reporter.report(event);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs to the configured webhook URL", async () => {
    withConfig("https://example.com/webhook");
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    const reporter = new WebhookReporter(makeLog());
    await reporter.report({
      participant: makeParticipant(),
      section,
      action: "completed",
      codespace: "cs-123",
      workshop: "Test Workshop"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/webhook",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("includes correct payload fields", async () => {
    withConfig("https://example.com/webhook");
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    const reporter = new WebhookReporter(makeLog());
    await reporter.report({
      participant: makeParticipant(),
      section,
      action: "started",
      codespace: "cs-123",
      workshop: "Test Workshop"
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.sectionId).toBe("s1");
    expect(body.sectionTitle).toBe("Environment Setup");
    expect(body.action).toBe("started");
    expect(body.gitName).toBe("Alice Git");
    expect(body.githubUser).toBe("alice-gh");
  });

  it("logs OK on a successful response", async () => {
    withConfig("https://example.com/webhook");
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const log = makeLog();

    const reporter = new WebhookReporter(log);
    await reporter.report({
      participant: makeParticipant(),
      section,
      action: "completed",
      codespace: "cs-123",
      workshop: "Test Workshop"
    });

    expect(log.appendLine).toHaveBeenCalledWith(expect.stringContaining("OK 200"));
  });

  it("logs a warning on a non-2xx response", async () => {
    withConfig("https://example.com/webhook");
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const log = makeLog();

    const reporter = new WebhookReporter(log);
    await reporter.report({
      participant: makeParticipant(),
      section,
      action: "completed",
      codespace: "cs-123",
      workshop: "Test Workshop"
    });

    expect(log.appendLine).toHaveBeenCalledWith(expect.stringContaining("500"));
  });

  it("logs and swallows a network error", async () => {
    withConfig("https://example.com/webhook");
    fetchMock.mockRejectedValue(new Error("Network failure"));
    const log = makeLog();

    const reporter = new WebhookReporter(log);
    await expect(reporter.report({
      participant: makeParticipant(),
      section,
      action: "completed",
      codespace: "cs-123",
      workshop: "Test Workshop"
    })).resolves.toBeUndefined();

    expect(log.appendLine).toHaveBeenCalledWith(expect.stringContaining("Network failure"));
  });

  it("uses name fallback chain when name is empty", async () => {
    withConfig("https://example.com/webhook");
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    const reporter = new WebhookReporter(makeLog());
    await reporter.report({
      participant: makeParticipant({ name: "", gitName: "Alice Git" }),
      section,
      action: "completed",
      codespace: "cs-123",
      workshop: "Test Workshop"
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.name).toBe("Alice Git");
  });
});

// ── reportReset ──────────────────────────────────────────────────────────────

describe("WebhookReporter.reportReset", () => {
  it("does nothing when webhookUrl is not configured", async () => {
    withConfig("");
    const reporter = new WebhookReporter(makeLog());
    await reporter.reportReset({ participant: makeParticipant(), codespace: "cs-123" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs with action reset", async () => {
    withConfig("https://example.com/webhook");
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    const reporter = new WebhookReporter(makeLog());
    await reporter.reportReset({ participant: makeParticipant(), codespace: "cs-123" });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.action).toBe("reset");
    expect(body.codespace).toBe("cs-123");
  });

  it("logs and swallows a network error", async () => {
    withConfig("https://example.com/webhook");
    fetchMock.mockRejectedValue(new Error("timeout"));
    const log = makeLog();

    const reporter = new WebhookReporter(log);
    await expect(
      reporter.reportReset({ participant: makeParticipant(), codespace: "cs-123" })
    ).resolves.toBeUndefined();

    expect(log.appendLine).toHaveBeenCalledWith(expect.stringContaining("timeout"));
  });
});

// ── reportDeleteSections ─────────────────────────────────────────────────────

describe("WebhookReporter.reportDeleteSections", () => {
  it("does nothing when webhookUrl is not configured", async () => {
    withConfig("");
    const reporter = new WebhookReporter(makeLog());
    await reporter.reportDeleteSections({
      participant: makeParticipant(),
      sections: [section],
      codespace: "cs-123"
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs with action deleteSections and correct sectionIds", async () => {
    withConfig("https://example.com/webhook");
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    const reporter = new WebhookReporter(makeLog());
    await reporter.reportDeleteSections({
      participant: makeParticipant(),
      sections: [section, { id: "s2", title: "Connect" }],
      codespace: "cs-123"
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.action).toBe("deleteSections");
    expect(body.sectionIds).toEqual(["s1", "s2"]);
  });
});

// ── reportFeedback ───────────────────────────────────────────────────────────

describe("WebhookReporter.reportFeedback", () => {
  it("does nothing when webhookUrl is not configured", async () => {
    withConfig("");
    const reporter = new WebhookReporter(makeLog());
    await reporter.reportFeedback({
      participant: makeParticipant(),
      section,
      feedback: "Great!",
      codespace: "cs-123"
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs with action feedback and feedback text", async () => {
    withConfig("https://example.com/webhook");
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    const reporter = new WebhookReporter(makeLog());
    await reporter.reportFeedback({
      participant: makeParticipant(),
      section,
      feedback: "Very helpful",
      codespace: "cs-123"
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.action).toBe("feedback");
    expect(body.feedback).toBe("Very helpful");
    expect(body.sectionId).toBe("s1");
  });
});

// ── getCodespaceName ─────────────────────────────────────────────────────────

describe("WebhookReporter.getCodespaceName", () => {
  afterEach(() => {
    delete process.env["CODESPACE_NAME"];
    delete process.env["HOSTNAME"];
  });

  it("returns CODESPACE_NAME when set", () => {
    process.env["CODESPACE_NAME"] = "my-codespace";
    expect(WebhookReporter.getCodespaceName()).toBe("my-codespace");
  });

  it("falls back to HOSTNAME when CODESPACE_NAME is absent", () => {
    delete process.env["CODESPACE_NAME"];
    process.env["HOSTNAME"] = "my-host";
    expect(WebhookReporter.getCodespaceName()).toBe("my-host");
  });

  it("falls back to local when both env vars are absent", () => {
    delete process.env["CODESPACE_NAME"];
    delete process.env["HOSTNAME"];
    expect(WebhookReporter.getCodespaceName()).toBe("local");
  });
});
