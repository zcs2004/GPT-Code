import { describe, expect, test } from "bun:test";
import {
  DeskPilotCoreService,
  DeskPilotMcpRegistry,
  DeskPilotOrchestrator,
  DeskPilotStore,
} from "../src/deskpilot";
import {
  deskPilotLauncherSnapshot,
  runDeskPilotLauncherCommand,
} from "../src/deskpilot/launcher-command";

describe("GPT Code DeskPilot product boundary", () => {
  test("keeps live task context without exposing workspace records or file history", () => {
    const store = DeskPilotStore.open(":memory:");
    try {
      store.conversations.create({
        id: "conversation-boundary",
        title: "Boundary",
        createdAt: "2026-11-25T00:00:00.000Z",
        updatedAt: "2026-11-25T00:00:00.000Z",
      });
      store.tasks.create({
        id: "task-boundary",
        conversationId: "conversation-boundary",
        status: "Pending",
        description: "Visible current task",
        createdAt: "2026-11-25T00:00:01.000Z",
      });
      store.tasks.create({
        id: "task-old-completed",
        conversationId: "conversation-boundary",
        status: "Completed",
        description: "Must not become saved work history",
        createdAt: "2026-11-24T00:00:00.000Z",
        completedAt: "2026-11-24T00:00:01.000Z",
      });
      const snapshot = deskPilotLauncherSnapshot(store) as unknown as Record<string, unknown>;
      expect(snapshot.tasks).toHaveLength(1);
      expect(JSON.stringify(snapshot.tasks)).not.toContain("task-old-completed");
      expect(snapshot).not.toHaveProperty("workspaces");
      expect(snapshot).not.toHaveProperty("recentFileChanges");
      expect(snapshot.summary).toEqual({
        tasks: 1,
        activeTasks: 1,
        pendingApprovals: 0,
        mcpServers: 0,
        enabledMcpServers: 0,
      });
    } finally {
      store.close();
    }
  });

  test("does not expose the retired workspace command surface", async () => {
    await expect(runDeskPilotLauncherCommand(["workspaces"], { databasePath: ":memory:" }))
      .rejects.toThrow("Unknown DeskPilot command: workspaces");
    await expect(runDeskPilotLauncherCommand(["workspace-files"], { databasePath: ":memory:" }))
      .rejects.toThrow("Unknown DeskPilot command: workspace-files");
  });

  test("publishes only configured MCP servers in the ChatGPT inventory", async () => {
    const store = DeskPilotStore.open(":memory:");
    const registry = new DeskPilotMcpRegistry(store);
    const orchestrator = new DeskPilotOrchestrator(store, registry);
    const service = new DeskPilotCoreService(store, registry, orchestrator);
    try {
      const inventory = await service.request("mcp.inventory") as Record<string, unknown>;
      expect(inventory.servers).toEqual([]);
      expect(inventory).not.toHaveProperty("workspaces");
    } finally {
      await service.close();
    }
  });
});
