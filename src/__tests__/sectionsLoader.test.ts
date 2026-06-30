import { SectionsLoader } from "../sectionsLoader";
import * as fs from "fs";
import * as vscode from "vscode";

jest.mock("fs");

const existsSyncMock  = fs.existsSync  as jest.Mock;
const readFileSyncMock = fs.readFileSync as jest.Mock;
const showWarningMock  = vscode.window.showWarningMessage as jest.Mock;

function setWorkspaceFolders(paths: string[]) {
  (vscode.workspace as any).workspaceFolders = paths.map(p => ({
    uri: { fsPath: p }
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
  (vscode.workspace as any).workspaceFolders = undefined;
});

describe("SectionsLoader.load", () => {
  it("returns fallback sections when there are no workspace folders", async () => {
    const loader = new SectionsLoader();
    const sections = await loader.load();

    expect(sections.length).toBeGreaterThan(0);
    expect(sections[0].id).toBe("s1");
  });

  it("returns fallback sections when workshop-sections.json does not exist", async () => {
    setWorkspaceFolders(["/workspace"]);
    existsSyncMock.mockReturnValue(false);

    const loader = new SectionsLoader();
    const sections = await loader.load();

    expect(sections[0].id).toBe("s1");
  });

  it("loads sections from a valid workshop-sections.json", async () => {
    setWorkspaceFolders(["/workspace"]);
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(JSON.stringify([
      { id: "custom1", title: "Custom Section" }
    ]));

    const loader = new SectionsLoader();
    const sections = await loader.load();

    expect(sections).toHaveLength(1);
    expect(sections[0].id).toBe("custom1");
    expect(sections[0].title).toBe("Custom Section");
  });

  it("falls back to defaults when JSON is an empty array", async () => {
    setWorkspaceFolders(["/workspace"]);
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(JSON.stringify([]));

    const loader = new SectionsLoader();
    const sections = await loader.load();

    expect(sections[0].id).toBe("s1");
  });

  it("falls back to defaults and shows warning on parse error", async () => {
    setWorkspaceFolders(["/workspace"]);
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue("not valid json {{{");

    const loader = new SectionsLoader();
    const sections = await loader.load();

    expect(sections[0].id).toBe("s1");
    expect(showWarningMock).toHaveBeenCalledTimes(1);
    expect(showWarningMock.mock.calls[0][0]).toContain("parse error");
  });

  it("returns cached result on second call without re-reading the file", async () => {
    setWorkspaceFolders(["/workspace"]);
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(JSON.stringify([
      { id: "c1", title: "Cached Section" }
    ]));

    const loader = new SectionsLoader();
    await loader.load();
    await loader.load();

    expect(readFileSyncMock).toHaveBeenCalledTimes(1);
  });

  it("re-reads the file after invalidate()", async () => {
    setWorkspaceFolders(["/workspace"]);
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock
      .mockReturnValueOnce(JSON.stringify([{ id: "v1", title: "Version 1" }]))
      .mockReturnValueOnce(JSON.stringify([{ id: "v2", title: "Version 2" }]));

    const loader = new SectionsLoader();
    const first = await loader.load();
    loader.invalidate();
    const second = await loader.load();

    expect(first[0].id).toBe("v1");
    expect(second[0].id).toBe("v2");
  });

  it("uses the first matching workspace folder that has the file", async () => {
    setWorkspaceFolders(["/no-file", "/has-file"]);
    existsSyncMock.mockImplementation((p: string) => p.includes("has-file"));
    readFileSyncMock.mockReturnValue(JSON.stringify([
      { id: "found", title: "Found In Second Folder" }
    ]));

    const loader = new SectionsLoader();
    const sections = await loader.load();

    expect(sections[0].id).toBe("found");
  });
});
