import { ParticipantStore } from "../participantStore";
import * as child_process from "child_process";

jest.mock("child_process");
jest.mock("vscode", () => ({
  authentication: { getSession: jest.fn() }
}), { virtual: true });

const execSyncMock = child_process.execSync as jest.Mock;

function makeContext(initial: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = { ...initial };
  return {
    globalState: {
      get: (key: string, defaultValue: unknown) => store[key] ?? defaultValue,
      update: jest.fn(async (key: string, value: unknown) => { store[key] = value; })
    }
  } as any;
}

describe("tryFetchGitConfig", () => {
  afterEach(() => jest.clearAllMocks());

  it("uses git config name when available", async () => {
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd === "git config user.name")  return "Alice\n";
      if (cmd === "git config user.email") return "alice@example.com\n";
      throw new Error("unexpected");
    });

    const store = new ParticipantStore(makeContext());
    const result = await store.tryFetchGitConfig();

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

    const store = new ParticipantStore(makeContext());
    const result = await store.tryFetchGitConfig();

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

    const store = new ParticipantStore(makeContext());
    const result = await store.tryFetchGitConfig();

    expect(result.name).toBe("");
  });

  it("prefers git config name over GITHUB_USER when both are present", async () => {
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd === "git config user.name")  return "Alice\n";
      if (cmd === "git config user.email") return "alice@example.com\n";
      throw new Error("unexpected");
    });
    process.env["GITHUB_USER"] = "alice-gh";

    const store = new ParticipantStore(makeContext());
    const result = await store.tryFetchGitConfig();

    expect(result.name).toBe("Alice");
    delete process.env["GITHUB_USER"];
  });

  it("returns empty strings when execSync throws", async () => {
    execSyncMock.mockImplementation(() => { throw new Error("git not found"); });

    const store = new ParticipantStore(makeContext());
    const result = await store.tryFetchGitConfig();

    expect(result.name).toBe("");
    expect(result.email).toBe("");
  });
});
