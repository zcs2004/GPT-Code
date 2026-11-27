import type { PermissionContext, PermissionDecision, PermissionLevel } from "../types";

/**
 * DeskPilot's local gateway is the authority for tool approval.
 *
 * L0 may execute automatically only after the user has explicitly authorized the
 * containing scope. L1-L5 always require a concrete approval in V0.1.0.
 */
export function permissionDecision(
  level: PermissionLevel,
  context: PermissionContext,
): PermissionDecision {
  if (level === 0 && context.scopeAuthorized) return "allow";
  return "approval-required";
}
