import languages from "../electron/languages.json";
import type { LimitsSnapshot } from "./limits-types";

export type Language = keyof typeof languages;
export type LauncherProfile = "production" | "development";
export type BrowserInteractionMode = "automatic" | "manual";
export type Surface = "deskpilot-mcp" | "browser" | "setup" | "mcp" | "activity" | "limits" | "support" | "donation" | "settings";

export interface DeskPilotMcpServer {
  id: string;
  name: string;
  transport: string;
  enabled: boolean;
}

export interface DeskPilotMcpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

export type DeskPilotMcpServerInput =
  | {
      name: string;
      transport: "stdio";
      command: string;
      args: string[];
      cwd?: string;
    }
  | {
      name: string;
      transport: "streamable-http";
      url: string;
      headers?: Record<string, string>;
    };

export type DeskPilotTaskStatus = "Pending" | "Running" | "WaitingApproval" | "WaitingTool" | "Completed" | "Failed" | "Cancelled";

export interface DeskPilotTask {
  id: string;
  conversationId: string;
  status: DeskPilotTaskStatus;
  description: string;
  createdAt: string;
  completedAt?: string;
  result?: unknown;
  error?: string;
}

export interface DeskPilotApproval {
  id: string;
  taskId: string;
  toolName: string;
  argumentsHash: string;
  status: "Pending";
  createdAt: string;
  taskDescription: string;
}

export interface DeskPilotActivityLog {
  id: string;
  taskId: string;
  eventType: string;
  details: unknown;
  createdAt: string;
}

export interface DeskPilotConversationBinding {
  id: string;
  chatGptConversationId: string;
  title: string;
}

export interface DeskPilotLauncherSnapshot {
  version: 1;
  summary: {
    tasks: number;
    activeTasks: number;
    pendingApprovals: number;
    mcpServers: number;
    enabledMcpServers: number;
  };
  tasks: DeskPilotTask[];
  pendingApprovals: DeskPilotApproval[];
  recentActivity: DeskPilotActivityLog[];
  mcpServers: DeskPilotMcpServer[];
  currentConversation?: DeskPilotConversationBinding;
}

export interface LauncherState {
  version: 1;
  language: Language | null;
  onboardingComplete: boolean;
  githubOpened: boolean;
  xOpened: boolean;
  autoStart: boolean;
  keepRunningOnClose: boolean;
  showBrowserDuringTurns: boolean;
  autoApproveToolCalls: boolean;
  browserInteractionMode: BrowserInteractionMode;
  experimentalBiggerContext: boolean;
  biggerContextAvailable?: boolean;
  composerPredictionsEnabled: boolean;
  experimentalSkillAttachments: boolean;
  experimentalFreshConversationPerTurn: boolean;
  useTemporaryChats: boolean;
  zeroRiskProEnabled: boolean;
  sidebarOpen: boolean;
  sidebarWidth: number;
  browserSmokePassed?: boolean;
  browserSmokeVersion?: string | null;
  coreSetupComplete?: boolean;
  codexCatalogVerified?: boolean;
  mcpSetupComplete?: boolean;
  mcpRuntimeInstalled?: boolean;
  codexRestartRequired?: boolean;
  mcpGuideStep: number;
  sessionRefreshReminderAt: string | null;
}

export interface BrowserState {
  status: "idle" | "loading" | "signed-out" | "ready" | "testing" | "running" | "error";
  message: string;
  url: string;
  title: string;
  authenticated: boolean;
  passkeyPhase?: "opening" | "waiting" | "importing" | null;
  visible: boolean;
  surfaceActive: boolean;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  zoomFactor: number;
  activeTabId: string;
  maxTabs: number;
  tabs: BrowserTabState[];
}

export interface BrowserTabState {
  id: string;
  traceId: string | null;
  title: string;
  status: "idle" | "loading" | "signed-out" | "ready" | "testing" | "running" | "error" | "aborted";
  loading: boolean;
  active: boolean;
  closable: boolean;
  interactionMode?: BrowserInteractionMode;
  approvalPending?: boolean;
  authenticationRequired?: boolean;
  activity?: {
    state: "preparing" | "sending" | "chatgpt" | "tools" | "approval" | "unknown";
    since: number;
    updatedAt: number;
    activeToolCalls: number;
  };
  manualState?: "awaiting-user" | "sent" | "running" | "completed" | "timed-out" | "cancelled" | "failed";
  manualDeadlineAt?: string;
  canCopyPrompt?: boolean;
  canConfirmSent?: boolean;
}

export interface LogRecord {
  at: string;
  level: "debug" | "info" | "warning" | "error";
  event: string;
  detail: Record<string, unknown>;
}

export interface DoctorCheck {
  id: string;
  status: "ok" | "warning" | "error";
  message: string;
  detail?: string;
}

export interface DoctorReport {
  ok: boolean;
  mode?: "browser-only" | "full";
  checks: DoctorCheck[];
}

export interface OperationState {
  name: string;
  status: "running" | "completed" | "failed";
  message: string;
}

export type UpdateState =
  | { status: "disabled" | "idle" | "checking" | "up-to-date" }
  | { status: "available" | "downloading" | "installing"; version: string }
  | { status: "error"; message: string; retryAt?: number };

export interface LauncherSnapshot {
  profile: LauncherProfile;
  profilePaths: {
    coreHome: string;
    codexHome: string;
    userData: string;
  };
  state: LauncherState;
  browser: BrowserState | null;
  connectorName: string;
  connectorNames: Record<BrowserInteractionMode, string>;
  mcpCredentialsConfigured: boolean;
  mcpCredentials: Record<BrowserInteractionMode, boolean>;
  logs: LogRecord[];
  urls: {
    github: string;
    website: string;
    connectors: string;
    tunnels: string;
    keys: string;
  };
  platform: string;
  packaged: boolean;
  version: string;
  smokePassed: boolean;
  operation: OperationState | null;
  update: UpdateState;
}

export interface LauncherApi {
  snapshot(): Promise<LauncherSnapshot>;
  deskPilotSnapshot(): Promise<DeskPilotLauncherSnapshot>;
  cancelDeskPilotTask(id: string): Promise<DeskPilotLauncherSnapshot>;
  decideDeskPilotApproval(id: string, decision: "Approved" | "Denied"): Promise<{
    cancelled: boolean;
    snapshot: DeskPilotLauncherSnapshot;
  }>;
  addDeskPilotMcpServer(input: DeskPilotMcpServerInput): Promise<DeskPilotLauncherSnapshot>;
  setDeskPilotMcpServerEnabled(id: string, enabled: boolean): Promise<{
    cancelled: boolean;
    snapshot: DeskPilotLauncherSnapshot;
  }>;
  removeDeskPilotMcpServer(id: string): Promise<DeskPilotLauncherSnapshot>;
  testDeskPilotMcpServer(id: string): Promise<{ serverId: string; tools: DeskPilotMcpTool[] }>;
  getLimits(): Promise<LimitsSnapshot>;
  setupLimits(): Promise<LimitsSnapshot>;
  setLanguage(language: Language): Promise<LauncherState>;
  openSocial(target: "github" | "website"): Promise<LauncherState>;
  completeOnboarding(language: Language, browserInteractionMode: BrowserInteractionMode): Promise<LauncherState>;
  openExternal(url: string): Promise<boolean>;
  setBrowserBounds(bounds: { x: number; y: number; width: number; height: number }): Promise<boolean>;
  setBrowserSurfaceActive(active: boolean): Promise<BrowserState>;
  showBrowser(): Promise<BrowserState>;
  hideBrowser(): Promise<BrowserState>;
  navigateBrowser(action: "back" | "forward" | "reload"): Promise<BrowserState>;
  zoomBrowser(action: "in" | "out" | "reset"): Promise<BrowserState>;
  selectBrowserTab(tabId: string): Promise<BrowserState>;
  closeBrowserTab(tabId: string): Promise<BrowserState>;
  copyManualPrompt(tabId: string): Promise<BrowserState>;
  confirmManualSent(tabId: string): Promise<BrowserState>;
  openLogin(): Promise<BrowserState>;
  resetEmbeddedBrowserData(): Promise<BrowserState>;
  openPasskeyLogin(): Promise<BrowserState>;
  continuePasskeyLogin(): Promise<boolean>;
  logoutChatGpt(): Promise<{ browser: BrowserState; state: LauncherState }>;
  dismissSessionReminder(): Promise<LauncherState>;
  setSessionReminderVisible(visible: boolean): Promise<void>;
  onSessionReminderLogout(listener: () => void): () => void;
  smokeTest(): Promise<{ ok: boolean; effort: string; response: string }>;
  verifyMcp(): Promise<DoctorReport>;
  runMcpAcceptance(): Promise<DoctorReport>;
  doctor(): Promise<DoctorReport>;
  cancelTurns(): Promise<{ stdout: string }>;
  uninstallIntegration(): Promise<{ cancelled: true } | { cancelled: false; state: LauncherState }>;
  setupCore(): Promise<{ ok: boolean; stdout: string; restartRequired: boolean }>;
  setupMcp(input: {
    tunnelId?: string;
    runtimeKey?: string;
    replace?: boolean;
    interactionMode?: BrowserInteractionMode;
  }): Promise<{ ok: boolean; stdout: string }>;
  clearMcpCredentials(mode: BrowserInteractionMode): Promise<{
    changed: boolean;
    activeCleared: boolean;
    mode: "browser-only" | "full";
    browserInteractionMode: BrowserInteractionMode;
    state: LauncherState;
  }>;
  setConnectorNameSuffix(suffix: string): Promise<LauncherState>;
  setMcpStep(step: number): Promise<LauncherState>;
  setAutostart(enabled: boolean): Promise<{ state: LauncherState; supported: boolean; enabled: boolean }>;
  setBiggerContext(enabled: boolean): Promise<LauncherState>;
  setComposerPredictions(enabled: boolean): Promise<LauncherState>;
  setSkillAttachments(enabled: boolean): Promise<LauncherState>;
  setAutoApproveToolCalls(enabled: boolean): Promise<LauncherState>;
  setFreshConversationPerTurn(enabled: boolean): Promise<LauncherState>;
  setTemporaryChats(enabled: boolean): Promise<LauncherState>;
  setZeroRiskPro(enabled: boolean): Promise<LauncherState>;
  setBrowserInteractionMode(mode: BrowserInteractionMode): Promise<{
    state: LauncherState;
    credentialsRequired: boolean;
    targetMode: BrowserInteractionMode;
  }>;
  setPreference(
    key: "keepRunningOnClose" | "showBrowserDuringTurns",
    value: boolean,
  ): Promise<LauncherState>;
  setSidebarState(state: { open: boolean; width: number }): Promise<LauncherState>;
  logs(limit?: number): Promise<LogRecord[]>;
  exportLogs(): Promise<string | null>;
  installUpdate(): Promise<boolean>;
  checkForUpdates(): Promise<UpdateState>;
  windowState(): Promise<{ fullScreen: boolean; maximized: boolean }>;
  windowControl(action: "close" | "minimize" | "zoom"): void;
  onWindowStateChanged(listener: (state: { fullScreen: boolean; maximized: boolean }) => void): () => void;
  onConnectorNamesChanged(listener: (names: Pick<LauncherSnapshot, "connectorName" | "connectorNames">) => void): () => void;
  onMcpCredentialsChanged(listener: (credentials: LauncherSnapshot["mcpCredentials"]) => void): () => void;
  onStateChanged(listener: (state: LauncherState) => void): () => void;
  onBrowserState(listener: (state: BrowserState) => void): () => void;
  onDeskPilotState(listener: (state: DeskPilotLauncherSnapshot) => void): () => void;
  onOperation(listener: (state: OperationState) => void): () => void;
  onLog(listener: (record: LogRecord) => void): () => void;
  onUpdateState(listener: (state: UpdateState) => void): () => void;
}

declare global {
  interface Window {
    codexWebLauncher?: LauncherApi;
    codexSessionReminder?: {
      language(): Promise<Language>;
      resize(height: number): Promise<void>;
      action(action: "dismiss" | "logout"): Promise<void>;
      onLanguage(listener: (language: Language) => void): () => void;
    };
  }
}
