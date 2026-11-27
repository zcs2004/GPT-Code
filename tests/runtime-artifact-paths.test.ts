import { describe, expect, test } from "bun:test";
import { containsEmbeddedPath } from "../scripts/runtime-artifact-paths";

describe("runtime artifact path detection", () => {
  test("does not treat an XML identifier prefix as a source path", () => {
    expect(containsEmbeddedPath("<workspace_roots><root>/project</root></workspace_roots>", "/workspace")).toBe(false);
  });

  test("detects exact source paths and their descendants", () => {
    expect(containsEmbeddedPath('sourceRoot="/workspace"', "/workspace")).toBe(true);
    expect(containsEmbeddedPath('entry="/workspace/src/cli.ts"', "/workspace")).toBe(true);
  });

  test("does not reject a different path that only shares the prefix", () => {
    expect(containsEmbeddedPath('entry="/workspace-backup/src/cli.ts"', "/workspace")).toBe(false);
  });
});
