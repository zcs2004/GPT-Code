const assert = require("node:assert/strict");
const test = require("node:test");
const { createDeskPilotCoreClient } = require("../electron/deskpilot-core.cjs");
const { createDeskPilotRuntime } = require("../electron/deskpilot-runtime.cjs");

function supervisorFor(script) {
  return { runtimeCommand(args) { return { executable: process.execPath, args: ["-e", script, ...args], cwd: process.cwd() }; } };
}

test("DeskPilot runtime keeps the database path in the child environment", async () => {
  const runtime = createDeskPilotRuntime({
    supervisor: supervisorFor(`process.stdout.write(JSON.stringify({databasePath:process.env.DESKPILOT_DATABASE_PATH,args:process.argv.slice(1)}));`),
    databasePath: "C:\\private\\DeskPilot\\deskpilot.sqlite",
  });
  const result = await runtime.snapshot();
  assert.equal(result.databasePath, "C:\\private\\DeskPilot\\deskpilot.sqlite");
  assert.deepEqual(result.args, ["deskpilot", "snapshot"]);
});

test("DeskPilot runtime exposes tasks and MCP connections without workspace file operations", async () => {
  const runtime = createDeskPilotRuntime({
    supervisor: supervisorFor(`process.stdout.write(JSON.stringify({args:process.argv.slice(1)}));`),
    databasePath: "C:\\private\\DeskPilot\\deskpilot.sqlite",
  });
  assert.equal(runtime.addWorkspace, undefined);
  assert.equal(runtime.listWorkspaceDirectory, undefined);
  assert.equal(runtime.prepareWorkspaceWrite, undefined);
  const cancel = await runtime.cancelTask("task-1");
  assert.deepEqual(cancel.args, ["deskpilot", "tasks", "cancel", "--id", "task-1"]);
  const approve = await runtime.decideApproval("approval-1", "Approved");
  assert.deepEqual(approve.args, ["deskpilot", "approvals", "decide", "--id", "approval-1", "--decision", "Approved"]);
});

test("DeskPilot runtime sends MCP configuration over stdin instead of process arguments", async () => {
  const runtime = createDeskPilotRuntime({
    supervisor: supervisorFor("let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>process.stdout.write(JSON.stringify({args:process.argv.slice(1),input:JSON.parse(input)})));"),
    databasePath: "C:\\private\\DeskPilot\\deskpilot.sqlite",
  });
  const config = { name: "Files", transport: "stdio", config: { command: "node", args: ["server.js"] } };
  const result = await runtime.addMcpServer(config);
  assert.deepEqual(result.args, ["deskpilot", "mcp", "add", "--input-stdin"]);
  assert.deepEqual(result.input, config);
});

test("DeskPilot runtime rejects invalid child JSON", async () => {
  const runtime = createDeskPilotRuntime({
    supervisor: supervisorFor(`process.stdout.write("not-json");`),
    databasePath: "C:\\private\\DeskPilot\\deskpilot.sqlite",
  });
  await assert.rejects(runtime.snapshot(), /invalid JSON/);
});

test("DeskPilot Core client keeps one resident child and sends task arguments over stdin", async () => {
  const core = createDeskPilotCoreClient({
    supervisor: supervisorFor("let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>{input+=c;while(input.includes('\\n')){const i=input.indexOf('\\n');const line=input.slice(0,i);input=input.slice(i+1);if(!line.trim())continue;const request=JSON.parse(line);const result=request.method==='shutdown'?{status:'stopped',pid:process.pid}:{pid:process.pid,args:process.argv.slice(1),method:request.method,params:request.params};process.stdout.write(JSON.stringify({id:request.id,result})+'\\n');if(request.method==='shutdown')setImmediate(()=>process.exit(0));}});"),
    databasePath: "C:\\private\\DeskPilot\\deskpilot.sqlite",
    browserDescriptorPath: "C:\\private\\DeskPilot\\browser-host.json",
  });
  const health = await core.start();
  const started = await core.startMcpToolTask({
    conversationId: "conversation-1",
    description: "fixture",
    serverId: "server-1",
    toolName: "write_note",
    arguments: { text: "raw-argument-must-not-enter-argv" },
  });
  assert.equal(health.pid, started.pid);
  assert.deepEqual(started.args, ["deskpilot-core"]);
  assert.equal(started.args.includes(started.params.arguments.text), false);
  await core.shutdown();
});
