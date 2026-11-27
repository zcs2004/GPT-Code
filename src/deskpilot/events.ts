export const DESKPILOT_EVENT_TYPES = [
  "message.started",
  "message.delta",
  "message.completed",
  "task.started",
  "task.progress",
  "tool.started",
  "tool.completed",
  "tool.failed",
  "approval.required",
  "task.completed",
  "task.failed",
  "task.cancelled",
] as const;

export type DeskPilotEventType = typeof DESKPILOT_EVENT_TYPES[number];

export interface DeskPilotEvent<T = unknown> {
  event: DeskPilotEventType;
  taskId: string;
  timestamp: string;
  data: T;
}
