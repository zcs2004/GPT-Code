const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { runBrowserHelperOperation, verifyConnectorWithBrowserHelper } = require("../electron/browser-helper-verifier.cjs");

test("launcher verification delegates exact connector selection to the browser helper protocol", async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-browser-helper-verify-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const script = path.join(root, "helper.cjs");
  fs.writeFileSync(script, `
    const input = require("node:readline").createInterface({ input: process.stdin });
    const send = value => process.stdout.write(JSON.stringify(value) + "\\n");
    send({ type: "ready" });
    input.on("line", line => {
      const message = JSON.parse(line);
      if (message.type === "shutdown") process.exit(0);
      if (message.type !== "verify") return;
      if (message.config.appName !== "Codex Native2") process.exit(2);
      if (message.config.browserHostDescriptorPath !== "/runtime/launcher-browser.json") process.exit(3);
      send({ type: "result", id: message.id, text: message.config.appName });
    });
  `);

  const result = await verifyConnectorWithBrowserHelper({
    helper: { executable: process.execPath, script },
    descriptorPath: "/runtime/launcher-browser.json",
    appName: "Codex Native2",
    logger: { info() {} },
  });

  assert.deepEqual(result, { ok: true, appName: "Codex Native2" });
});

test("launcher verification consumes a helper input EOF after the result", async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-browser-helper-eof-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const script = path.join(root, "helper.cjs");
  fs.writeFileSync(script, `
    const input = require("node:readline").createInterface({ input: process.stdin });
    const send = value => process.stdout.write(JSON.stringify(value) + "\\n");
    send({ type: "ready" });
    input.on("line", line => {
      const message = JSON.parse(line);
      if (message.type !== "verify") return;
      send({ type: "result", id: message.id, text: message.config.appName });
      process.stdin.destroy();
      setTimeout(() => process.exit(0), 100);
    });
  `);

  const result = await verifyConnectorWithBrowserHelper({
    helper: { executable: process.execPath, script },
    descriptorPath: "/runtime/launcher-browser.json",
    appName: "Codex Native2",
    logger: { info() {} },
  });

  assert.deepEqual(result, { ok: true, appName: "Codex Native2" });
});

test("launcher verification preserves the helper error class and correlation id", async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-browser-helper-error-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const script = path.join(root, "helper.cjs");
  fs.writeFileSync(script, `
    const input = require("node:readline").createInterface({ input: process.stdin });
    const send = value => process.stdout.write(JSON.stringify(value) + "\\n");
    send({ type: "ready" });
    input.on("line", line => {
      const message = JSON.parse(line);
      if (message.type === "shutdown") process.exit(0);
      if (message.type !== "verify") return;
      send({
        type: "error",
        id: message.id,
        name: "ChatGptPersistentBrowserStateError",
        message: "connector proof cleanup failed",
      });
    });
  `);

  await assert.rejects(
    verifyConnectorWithBrowserHelper({
      helper: { executable: process.execPath, script },
      descriptorPath: "/runtime/launcher-browser.json",
      appName: "Codex Native2",
      logger: { info() {} },
    }),
    (error) => {
      assert.equal(error.name, "ChatGptPersistentBrowserStateError");
      assert.equal(error.message, "connector proof cleanup failed");
      assert.match(error.operationId, /^verify-[a-f0-9]{24}$/);
      return true;
    },
  );
});

test("MCP acceptance payload is delivered over stdin and never exposed in helper argv", async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-browser-helper-acceptance-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const script = path.join(root, "helper.cjs");
  const probeId = `stage5_${"a".repeat(32)}`;
  const expectedReceipt = `receipt_${"B".repeat(32)}`;
  fs.writeFileSync(script, `
    const input = require("node:readline").createInterface({ input: process.stdin });
    const send = value => process.stdout.write(JSON.stringify(value) + "\\n");
    if (process.argv.some(value => value.includes("stage5_") || value.includes("receipt_"))) process.exit(9);
    send({ type: "ready" });
    input.on("line", line => {
      const message = JSON.parse(line);
      if (message.type === "shutdown") process.exit(0);
      if (message.type !== "acceptance") return;
      if (message.probeId !== ${JSON.stringify(probeId)}) process.exit(2);
      if (message.expectedReceipt !== ${JSON.stringify(expectedReceipt)}) process.exit(3);
      send({ type: "result", id: message.id, value: {
        effort: "High", response: "DESKPILOT MCP READY", tool: "deskpilot_acceptance_probe",
      } });
    });
  `);

  const result = await runBrowserHelperOperation({
    helper: { executable: process.execPath, script },
    descriptorPath: "/runtime/launcher-browser.json",
    appName: "Codex Native2",
    operation: "acceptance",
    useTemporaryChats: false,
    payload: { probeId, expectedReceipt },
    logger: { info() {} },
  });

  assert.deepEqual(result.value, {
    effort: "High",
    response: "DESKPILOT MCP READY",
    tool: "deskpilot_acceptance_probe",
  });
});
