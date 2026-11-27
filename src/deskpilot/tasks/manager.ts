import type { DeskPilotEventJournal } from "../events/journal";
import { DeskPilotEventJournal as EventJournal } from "../events/journal";
import type { DeskPilotStore } from "../storage";
import type { DeskPilotTask, TaskStatus } from "../types";

type Cleanup = () => void | Promise<void>;

interface ActiveTask {
  controller: AbortController;
  cleanups: Cleanup[];
  cleanupPromise?: Promise<void>;
}

export interface CreateDeskPilotTaskInput {
  id: string;
  conversationId: string;
  description: string;
  createdAt?: string;
}

export interface DeskPilotTaskContext {
  taskId: string;
  signal: AbortSignal;
  reportProgress(data: unknown): void;
  waitForApproval(data?: unknown): void;
  waitForTool(data?: unknown): void;
  resume(data?: unknown): void;
  registerCleanup(cleanup: Cleanup): () => void;
}

export type DeskPilotTaskRunner = (context: DeskPilotTaskContext) => Promise<unknown>;

export class DeskPilotTaskManager {
  readonly events: DeskPilotEventJournal;
  private readonly active = new Map<string, ActiveTask>();

  constructor(
    private readonly store: DeskPilotStore,
    events?: DeskPilotEventJournal,
  ) {
    this.events = events ?? new EventJournal(store);
  }

  create(input: CreateDeskPilotTaskInput): DeskPilotTask {
    return this.store.tasks.create({
      id: input.id,
      conversationId: input.conversationId,
      status: "Pending",
      description: input.description,
      createdAt: input.createdAt ?? new Date().toISOString(),
    });
  }

  async run(taskId: string, runner: DeskPilotTaskRunner): Promise<DeskPilotTask> {
    if (this.active.has(taskId)) throw new Error("DeskPilot task is already running: " + taskId);
    const task = this.store.tasks.get(taskId);
    if (!task) throw new Error("DeskPilot task not found: " + taskId);
    if (task.status !== "Pending") {
      throw new Error("DeskPilot task must be Pending before run: " + taskId);
    }

    const active: ActiveTask = {
      controller: new AbortController(),
      cleanups: [],
    };
    this.active.set(taskId, active);
    this.store.tasks.transition(taskId, "Running");
    this.events.publish("task.started", taskId, { status: "Running" });

    const context: DeskPilotTaskContext = {
      taskId,
      signal: active.controller.signal,
      reportProgress: (data) => {
        this.requireActive(taskId);
        this.events.publish("task.progress", taskId, data);
      },
      waitForApproval: (data) => {
        this.transitionActive(taskId, "WaitingApproval", data);
      },
      waitForTool: (data) => {
        this.transitionActive(taskId, "WaitingTool", data);
      },
      resume: (data) => {
        const current = this.store.tasks.get(taskId);
        if (!current) throw new Error("DeskPilot task not found: " + taskId);
        if (current.status !== "WaitingApproval" && current.status !== "WaitingTool") {
          throw new Error("DeskPilot task is not waiting: " + taskId);
        }
        this.store.tasks.transition(taskId, "Running");
        this.events.publish("task.progress", taskId, {
          status: "Running",
          ...(data === undefined ? {} : { data }),
        });
      },
      registerCleanup: (cleanup) => {
        this.requireActive(taskId).cleanups.push(cleanup);
        return () => {
          const current = this.active.get(taskId);
          if (!current) return;
          const index = current.cleanups.indexOf(cleanup);
          if (index >= 0) current.cleanups.splice(index, 1);
        };
      },
    };

    try {
      const result = await runner(context);
      const current = this.store.tasks.get(taskId);
      if (!current) throw new Error("DeskPilot task not found after run: " + taskId);
      if (current.status === "Cancelled") return current;
      if (current.status !== "Running") {
        throw new Error(
          "DeskPilot task runner finished while task status was " + current.status + ": " + taskId,
        );
      }
      await this.runCleanups(active);
      const completed = this.store.tasks.transition(taskId, "Completed", { result });
      this.events.publish("task.completed", taskId, { result });
      return completed;
    } catch (error) {
      const current = this.store.tasks.get(taskId);
      if (current?.status === "Cancelled" || active.controller.signal.aborted) {
        await this.runCleanups(active).catch(() => {});
        return this.store.tasks.get(taskId)!;
      }
      const cleanupError = await this.runCleanups(active).then(
        () => undefined,
        (cause) => cause,
      );
      const message = error instanceof Error ? error.message : String(error);
      const fullMessage = cleanupError === undefined
        ? message
        : message + "; cleanup failed: "
          + (cleanupError instanceof Error ? cleanupError.message : String(cleanupError));
      const failed = this.store.tasks.transition(taskId, "Failed", { error: fullMessage });
      this.events.publish("task.failed", taskId, { error: fullMessage });
      return failed;
    } finally {
      this.active.delete(taskId);
    }
  }

  async cancel(taskId: string, reason = "Cancelled by user"): Promise<DeskPilotTask> {
    const task = this.store.tasks.get(taskId);
    if (!task) throw new Error("DeskPilot task not found: " + taskId);
    if (task.status === "Completed" || task.status === "Failed" || task.status === "Cancelled") {
      return task;
    }

    const active = this.active.get(taskId);
    if (active && !active.controller.signal.aborted) {
      active.controller.abort(new Error(reason));
      await this.runCleanups(active).catch(() => {});
    }
    this.store.approvals.expirePendingForTask(taskId);
    const cancelled = this.store.tasks.transition(taskId, "Cancelled", { error: reason });
    this.events.publish("task.cancelled", taskId, { reason });
    return cancelled;
  }

  isActive(taskId: string): boolean {
    return this.active.has(taskId);
  }

  private transitionActive(
    taskId: string,
    status: Extract<TaskStatus, "WaitingApproval" | "WaitingTool">,
    data: unknown,
  ): void {
    this.requireActive(taskId);
    this.store.tasks.transition(taskId, status);
    this.events.publish("task.progress", taskId, {
      status,
      ...(data === undefined ? {} : { data }),
    });
  }

  private requireActive(taskId: string): ActiveTask {
    const active = this.active.get(taskId);
    if (!active) throw new Error("DeskPilot task is not active: " + taskId);
    return active;
  }

  private runCleanups(active: ActiveTask): Promise<void> {
    if (active.cleanupPromise) return active.cleanupPromise;
    active.cleanupPromise = (async () => {
      const errors: unknown[] = [];
      while (active.cleanups.length > 0) {
        const cleanup = active.cleanups.pop()!;
        try {
          await cleanup();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length > 0) {
        throw new AggregateError(errors, "DeskPilot task cleanup failed");
      }
    })();
    return active.cleanupPromise;
  }
}
