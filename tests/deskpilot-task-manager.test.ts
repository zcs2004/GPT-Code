import { describe, expect, test } from "bun:test";
import {
  DeskPilotEventJournal,
  DeskPilotStore,
  DeskPilotTaskManager,
} from "../src/deskpilot";

function seedConversation(store: DeskPilotStore): void {
  store.conversations.create({
    id: "conversation-task-manager",
    title: "Task manager test",
    createdAt: "2026-11-24T00:00:00.000Z",
    updatedAt: "2026-11-24T00:00:00.000Z",
  });
}

describe("DeskPilot Task Manager", () => {
  test("persists lifecycle events and broadcasts progress", async () => {
    const store = DeskPilotStore.open(":memory:");
    try {
      seedConversation(store);
      const journal = new DeskPilotEventJournal(store);
      const manager = new DeskPilotTaskManager(store, journal);
      const observed: string[] = [];
      journal.subscribe((event) => observed.push(event.event));
      manager.create({
        id: "task-success",
        conversationId: "conversation-task-manager",
        description: "Complete normally",
        createdAt: "2026-11-24T00:00:01.000Z",
      });

      let cleanupCount = 0;
      const completed = await manager.run("task-success", async (context) => {
        context.registerCleanup(() => {
          cleanupCount += 1;
        });
        context.reportProgress({ step: 1 });
        context.waitForTool({ tool: "fixture" });
        expect(store.tasks.get("task-success")?.status).toBe("WaitingTool");
        context.resume({ tool: "fixture" });
        return { ok: true };
      });

      expect(completed.status).toBe("Completed");
      expect(completed.result).toEqual({ ok: true });
      expect(cleanupCount).toBe(1);
      expect(manager.isActive("task-success")).toBe(false);
      expect(observed).toEqual([
        "task.started",
        "task.progress",
        "task.progress",
        "task.progress",
        "task.completed",
      ]);
      expect(store.activityLogs.listForTask("task-success").map((log) => log.eventType))
        .toEqual(observed);
    } finally {
      store.close();
    }
  });

  test("cancellation aborts the runner and performs cleanup once", async () => {
    const store = DeskPilotStore.open(":memory:");
    try {
      seedConversation(store);
      const journal = new DeskPilotEventJournal(store);
      const manager = new DeskPilotTaskManager(store, journal);
      manager.create({
        id: "task-cancel",
        conversationId: "conversation-task-manager",
        description: "Cancel safely",
      });
      store.approvals.create({
        id: "approval-cancel",
        taskId: "task-cancel",
        toolName: "fixture::write",
        argumentsHash: "sha256:cancel",
        status: "Pending",
        createdAt: "2026-11-24T00:00:02.000Z",
      });

      let cleanupCount = 0;
      let signalWasAborted = false;
      let markStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      const running = manager.run("task-cancel", async (context) => {
        context.registerCleanup(() => {
          cleanupCount += 1;
        });
        markStarted();
        context.waitForApproval({ approvalId: "approval-cancel" });
        await new Promise<never>((_resolve, reject) => {
          context.signal.addEventListener("abort", () => {
            signalWasAborted = context.signal.aborted;
            reject(context.signal.reason);
          }, { once: true });
        });
      });

      await started;
      const cancelled = await manager.cancel("task-cancel", "Stop test task");
      const settled = await running;
      expect(cancelled.status).toBe("Cancelled");
      expect(settled.status).toBe("Cancelled");
      expect(signalWasAborted).toBe(true);
      expect(cleanupCount).toBe(1);
      expect(store.approvals.get("approval-cancel")?.status).toBe("Expired");
      expect(store.approvals.listPending()).toHaveLength(0);
      expect(store.activityLogs.listForTask("task-cancel").map((log) => log.eventType))
        .toEqual(["task.started", "task.progress", "task.cancelled"]);
    } finally {
      store.close();
    }
  });

  test("runner failures become terminal failures after cleanup", async () => {
    const store = DeskPilotStore.open(":memory:");
    try {
      seedConversation(store);
      const manager = new DeskPilotTaskManager(store);
      manager.create({
        id: "task-fail",
        conversationId: "conversation-task-manager",
        description: "Fail predictably",
      });

      let cleaned = false;
      const failed = await manager.run("task-fail", async (context) => {
        context.registerCleanup(() => {
          cleaned = true;
        });
        throw new Error("fixture failure");
      });
      expect(failed.status).toBe("Failed");
      expect(failed.error).toBe("fixture failure");
      expect(cleaned).toBe(true);
      expect(store.activityLogs.listForTask("task-fail").map((log) => log.eventType))
        .toEqual(["task.started", "task.failed"]);
    } finally {
      store.close();
    }
  });
});
