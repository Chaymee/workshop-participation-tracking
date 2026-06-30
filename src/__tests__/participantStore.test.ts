import { ParticipantStore } from "../participantStore";
import * as child_process from "child_process";
import * as vscode from "vscode";

jest.mock("child_process");

const execSyncMock = child_process.execSync as jest.Mock;
const getSessionMock = (vscode.authentication.getSession as jest.Mock);

function makeContext(initial: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = { ...initial };
  return {
    globalState: {
      get: (key: string, defaultValue: unknown) => store[key] ?? defaultValue,
      update: jest.fn(async (key: string, value: unknown) => { store[key] = value; })
    }
  } as any;
}

// ── tryFetchGitConfig ────────────────────────────────────────────────────────

describe("tryFetchGitConfig", () => {
  afterEach(() => jest.clearAllMocks());

  it("uses git config name when available", async () => {
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd === "git config user.name")  return "Alice\n";
      if (cmd === "git config user.email") return "alice@example.com\n";
      throw new Error("unexpected");
    });

    const ps = new ParticipantStore(makeContext());
    const result = await ps.tryFetchGitConfig();

    expect(result.name).toBe("Alice");
    expect(result.email).toBe("alice@example.com");
  });

  it("falls back to GITHUB_USER when git config name is empty", async () => {
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd === "git config user.name")  return "\n";
      if (cmd === "git config user.email") return "alice@example.com\n";
      throw new Error("unexpected");
    });
    process.env["GITHUB_USER"] = "alice-gh";

    const ps = new ParticipantStore(makeContext());
    const result = await ps.tryFetchGitConfig();

    expect(result.name).toBe("alice-gh");
    delete process.env["GITHUB_USER"];
  });

  it("returns empty name when git config and GITHUB_USER are both absent", async () => {
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd === "git config user.name")  return "\n";
      if (cmd === "git config user.email") return "\n";
      throw new Error("unexpected");
    });
    delete process.env["GITHUB_USER"];

    const ps = new ParticipantStore(makeContext());
    const result = await ps.tryFetchGitConfig();

    expect(result.name).toBe("");
  });

  it("prefers git config name over GITHUB_USER when both are present", async () => {
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd === "git config user.name")  return "Alice\n";
      if (cmd === "git config user.email") return "alice@example.com\n";
      throw new Error("unexpected");
    });
    process.env["GITHUB_USER"] = "alice-gh";

    const ps = new ParticipantStore(makeContext());
    const result = await ps.tryFetchGitConfig();

    expect(result.name).toBe("Alice");
    delete process.env["GITHUB_USER"];
  });

  it("returns empty strings when execSync throws", async () => {
    execSyncMock.mockImplementation(() => { throw new Error("git not found"); });

    const ps = new ParticipantStore(makeContext());
    const result = await ps.tryFetchGitConfig();

    expect(result.name).toBe("");
    expect(result.email).toBe("");
  });

  it("auto-fills name and email when not already set", async () => {
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd === "git config user.name")  return "Alice\n";
      if (cmd === "git config user.email") return "alice@example.com\n";
      throw new Error("unexpected");
    });

    const ctx = makeContext();
    const ps = new ParticipantStore(ctx);
    await ps.tryFetchGitConfig();

    expect(ps.getParticipant().name).toBe("Alice");
    expect(ps.getParticipant().email).toBe("alice@example.com");
  });

  it("does not overwrite name and email that are already set", async () => {
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd === "git config user.name")  return "Alice\n";
      if (cmd === "git config user.email") return "alice@example.com\n";
      throw new Error("unexpected");
    });

    const ctx = makeContext({ "wt.name": "Existing Name", "wt.email": "existing@example.com" });
    const ps = new ParticipantStore(ctx);
    await ps.tryFetchGitConfig();

    expect(ps.getParticipant().name).toBe("Existing Name");
    expect(ps.getParticipant().email).toBe("existing@example.com");
  });
});

// ── tryFetchGitHubIdentity ───────────────────────────────────────────────────

describe("tryFetchGitHubIdentity", () => {
  afterEach(() => jest.clearAllMocks());

  it("returns empty strings when no session exists", async () => {
    getSessionMock.mockResolvedValue(undefined);

    const ps = new ParticipantStore(makeContext());
    const result = await ps.tryFetchGitHubIdentity();

    expect(result.user).toBe("");
    expect(result.email).toBe("");
  });

  it("returns user label from session", async () => {
    getSessionMock.mockResolvedValue({
      account: { label: "alice-gh", id: "" },
      accessToken: "tok"
    });

    const ps = new ParticipantStore(makeContext());
    const result = await ps.tryFetchGitHubIdentity();

    expect(result.user).toBe("alice-gh");
  });

  it("saves githubUser to participant store", async () => {
    getSessionMock.mockResolvedValue({
      account: { label: "alice-gh", id: "" },
      accessToken: "tok"
    });

    const ps = new ParticipantStore(makeContext());
    await ps.tryFetchGitHubIdentity();

    expect(ps.getParticipant().githubUser).toBe("alice-gh");
  });

  it("returns empty strings when getSession throws", async () => {
    getSessionMock.mockRejectedValue(new Error("auth error"));

    const ps = new ParticipantStore(makeContext());
    const result = await ps.tryFetchGitHubIdentity();

    expect(result.user).toBe("");
    expect(result.email).toBe("");
  });
});

// ── getParticipant / saveParticipant ─────────────────────────────────────────

describe("getParticipant / saveParticipant", () => {
  it("returns empty strings by default", () => {
    const ps = new ParticipantStore(makeContext());
    const p = ps.getParticipant();

    expect(p.name).toBe("");
    expect(p.email).toBe("");
    expect(p.githubUser).toBe("");
    expect(p.githubEmail).toBe("");
    expect(p.gitName).toBe("");
    expect(p.gitEmail).toBe("");
  });

  it("saves and retrieves individual fields", async () => {
    const ps = new ParticipantStore(makeContext());
    await ps.saveParticipant({ name: "Bob", gitEmail: "bob@git.com" });
    const p = ps.getParticipant();

    expect(p.name).toBe("Bob");
    expect(p.gitEmail).toBe("bob@git.com");
    expect(p.email).toBe("");
  });

  it("does not overwrite fields not included in the update", async () => {
    const ctx = makeContext({ "wt.name": "Alice" });
    const ps = new ParticipantStore(ctx);
    await ps.saveParticipant({ email: "alice@example.com" });

    expect(ps.getParticipant().name).toBe("Alice");
    expect(ps.getParticipant().email).toBe("alice@example.com");
  });
});

// ── Progress tracking ────────────────────────────────────────────────────────

describe("progress tracking", () => {
  it("marks a section as completed", async () => {
    const ps = new ParticipantStore(makeContext());
    await ps.markCompleted("s1");

    expect(ps.isCompleted("s1")).toBe(true);
  });

  it("does not duplicate completed entries", async () => {
    const ps = new ParticipantStore(makeContext());
    await ps.markCompleted("s1");
    await ps.markCompleted("s1");

    expect(ps.getCompleted()).toHaveLength(1);
  });

  it("unmarks a completed section", async () => {
    const ps = new ParticipantStore(makeContext());
    await ps.markCompleted("s1");
    await ps.markUncompleted("s1");

    expect(ps.isCompleted("s1")).toBe(false);
  });

  it("getCompletedCount returns correct count", async () => {
    const ps = new ParticipantStore(makeContext());
    await ps.markCompleted("s1");
    await ps.markCompleted("s2");

    expect(ps.getCompletedCount()).toBe(2);
  });

  it("marks a section as started", async () => {
    const ps = new ParticipantStore(makeContext());
    await ps.markStarted("s1");

    expect(ps.isStarted("s1")).toBe(true);
  });

  it("does not duplicate started entries", async () => {
    const ps = new ParticipantStore(makeContext());
    await ps.markStarted("s1");
    await ps.markStarted("s1");

    expect(ps.getStarted()).toHaveLength(1);
  });

  it("isCompleted returns false for unknown section", () => {
    const ps = new ParticipantStore(makeContext());
    expect(ps.isCompleted("s99")).toBe(false);
  });

  it("isStarted returns false for unknown section", () => {
    const ps = new ParticipantStore(makeContext());
    expect(ps.isStarted("s99")).toBe(false);
  });
});

// ── resetProgress ────────────────────────────────────────────────────────────

describe("resetProgress", () => {
  it("clears completed, started, and feedback", async () => {
    const ps = new ParticipantStore(makeContext());
    await ps.markCompleted("s1");
    await ps.markStarted("s2");
    await ps.saveSectionFeedback("s1", "great section");
    await ps.resetProgress();

    expect(ps.getCompleted()).toHaveLength(0);
    expect(ps.getStarted()).toHaveLength(0);
    expect(ps.getFeedback()).toEqual({});
  });
});

// ── Feedback ─────────────────────────────────────────────────────────────────

describe("section feedback", () => {
  it("saves and retrieves feedback for a section", async () => {
    const ps = new ParticipantStore(makeContext());
    await ps.saveSectionFeedback("s1", "This was helpful");

    expect(ps.getSectionFeedback("s1")).toBe("This was helpful");
  });

  it("returns empty string for a section with no feedback", () => {
    const ps = new ParticipantStore(makeContext());
    expect(ps.getSectionFeedback("s1")).toBe("");
  });

  it("overwrites existing feedback for the same section", async () => {
    const ps = new ParticipantStore(makeContext());
    await ps.saveSectionFeedback("s1", "first");
    await ps.saveSectionFeedback("s1", "updated");

    expect(ps.getSectionFeedback("s1")).toBe("updated");
  });

  it("stores feedback for multiple sections independently", async () => {
    const ps = new ParticipantStore(makeContext());
    await ps.saveSectionFeedback("s1", "feedback one");
    await ps.saveSectionFeedback("s2", "feedback two");

    expect(ps.getSectionFeedback("s1")).toBe("feedback one");
    expect(ps.getSectionFeedback("s2")).toBe("feedback two");
  });
});
