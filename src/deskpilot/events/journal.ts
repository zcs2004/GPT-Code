import { randomUUID } from "node:crypto";
import type { DeskPilotStore } from "../storage";
import type { DeskPilotEvent, DeskPilotEventType } from "../events";

export type DeskPilotEventListener = (event: DeskPilotEvent) => void;

export class DeskPilotEventJournal {
  private readonly listeners = new Set<DeskPilotEventListener>();

  constructor(private readonly store: DeskPilotStore) {}

  publish<T>(
    event: DeskPilotEventType,
    taskId: string,
    data: T,
    timestamp = new Date().toISOString(),
  ): DeskPilotEvent<T> {
    const record: DeskPilotEvent<T> = {
      event,
      taskId,
      timestamp,
      data,
    };
    this.store.activityLogs.append({
      id: randomUUID(),
      taskId,
      eventType: event,
      details: data,
      createdAt: timestamp,
    });
    for (const listener of this.listeners) listener(record);
    return record;
  }

  subscribe(listener: DeskPilotEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
