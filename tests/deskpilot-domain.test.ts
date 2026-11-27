import { describe, expect, test } from "bun:test";
import {
  assertTaskStatusTransition,
  canTransitionTaskStatus,
  isTerminalTaskStatus,
  permissionDecision,
} from "../src/deskpilot";

describe("DeskPilot task lifecycle", () => {
  test("allows the V0.1.0 approval and tool wait loop", () => {
    expect(canTransitionTaskStatus("Pending", "Running")).toBe(true);
    expect(canTransitionTaskStatus("Running", "WaitingApproval")).toBe(true);
    expect(canTransitionTaskStatus("WaitingApproval", "Running")).toBe(true);
    expect(canTransitionTaskStatus("Running", "WaitingTool")).toBe(true);
    expect(canTransitionTaskStatus("WaitingTool", "Running")).toBe(true);
    expect(canTransitionTaskStatus("Running", "Completed")).toBe(true);
  });

  test("terminal tasks cannot be revived", () => {
    expect(isTerminalTaskStatus("Completed")).toBe(true);
    expect(isTerminalTaskStatus("Failed")).toBe(true);
    expect(isTerminalTaskStatus("Cancelled")).toBe(true);
    expect(() => assertTaskStatusTransition("Completed", "Running")).toThrow(
      "Invalid DeskPilot task transition: Completed -> Running",
    );
  });
});

describe("DeskPilot permission policy", () => {
  test("L0 is automatic only inside an explicitly authorized scope", () => {
    expect(permissionDecision(0, { scopeAuthorized: true })).toBe("allow");
    expect(permissionDecision(0, { scopeAuthorized: false })).toBe("approval-required");
  });

  test("write, destructive, shell and external actions require approval", () => {
    for (const level of [1, 2, 3, 4, 5] as const) {
      expect(permissionDecision(level, { scopeAuthorized: true })).toBe("approval-required");
    }
  });
});
