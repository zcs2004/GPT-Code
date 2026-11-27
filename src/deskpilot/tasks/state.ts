import type { TaskStatus } from "../types";

const TASK_TRANSITIONS: Readonly<Record<TaskStatus, ReadonlySet<TaskStatus>>> = {
  Pending: new Set(["Running", "Cancelled"]),
  Running: new Set(["WaitingApproval", "WaitingTool", "Completed", "Failed", "Cancelled"]),
  WaitingApproval: new Set(["Running", "Failed", "Cancelled"]),
  WaitingTool: new Set(["Running", "Failed", "Cancelled"]),
  Completed: new Set(),
  Failed: new Set(),
  Cancelled: new Set(),
};

export function canTransitionTaskStatus(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_TRANSITIONS[from].has(to);
}

export function assertTaskStatusTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransitionTaskStatus(from, to)) {
    throw new Error(`Invalid DeskPilot task transition: ${from} -> ${to}`);
  }
}

export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return status === "Completed" || status === "Failed" || status === "Cancelled";
}
