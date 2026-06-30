export const workspace = {
  workspaceFolders: undefined as any,
  getConfiguration: jest.fn(),
  onDidChangeConfiguration: jest.fn()
};

export const window = {
  showWarningMessage: jest.fn(),
  showInformationMessage: jest.fn(),
  createOutputChannel: jest.fn(() => ({ appendLine: jest.fn(), dispose: jest.fn() }))
};

export const authentication = {
  getSession: jest.fn()
};

export const commands = {
  registerCommand: jest.fn(),
  executeCommand: jest.fn()
};

export const EventEmitter = jest.fn(() => ({
  event: jest.fn(),
  fire: jest.fn(),
  dispose: jest.fn()
}));

export const StatusBarAlignment = { Right: 1, Left: 2 };
export const ThemeColor = jest.fn();
