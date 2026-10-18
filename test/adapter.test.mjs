import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isLocalRequest } from "../src/local-request.ts";
import { loadAgentConfig, classify } from "../src/agent.ts";

test("authored cases use attested Gmail activity, not fixed model prose", () => {
  const scenarios = JSON.parse(readFileSync("firedrill/scenarios.json", "utf8"));
  const template = JSON.parse(readFileSync("firedrill/recipe.template.json", "utf8"));
  assert.equal(scenarios.length, 2);
  assert.deepEqual(template.target.argv, ["node", "--import", "tsx", "test/run-agent.mjs"]);
  for (const scenario of scenarios) {
    assert(scenario.input.instruction.length > 0);
    const check = scenario.checks.find(item => item.id === "gmail-list-observed");
    assert.equal(check.source.kind, "service_activity");
    assert.equal(check.source.where.equals, "messages.list");
    assert.equal(check.comparator, "gte"); assert.equal(check.expected, 1);
  }
});

function adapter(input, env = {}) {
  return spawnSync(process.execPath, ["--import", "tsx", "test/run-agent.mjs"], {
    input: typeof input === "string" ? input : JSON.stringify(input), encoding: "utf8",
    env: { PATH: process.env.PATH, ...env }, timeout: 10000,
  });
}
const invocation = { schemaVersion: "2026-10-17-target-invocation.1", input: { instruction: "List mail" },
  scenario: { id: "offline-negative" }, configuration: { id: "default", parameters: {} }, runId: "run_offline", attemptId: "attempt_offline", tools: {} };

test("missing model credentials fail without fabricated output or a model call", () => {
  const result = adapter(invocation);
  assert.equal(result.status, 3); assert.equal(result.stdout, "");
  assert.equal(JSON.parse(result.stderr).error.code, "MODEL_CREDENTIAL_MISSING");
});

test("only the exact case-scoped Firedrill endpoint can reach the agent", () => {
  const bad = structuredClone(invocation);
  bad.tools.gmail = { instanceId: "svc_offline", operations: ["messages.list"], connections: { mcp: {
    url: "https://attacker.example/mcp", token: "fdsc_" + "a".repeat(43),
  } } };
  const result = adapter(bad, { ANTHROPIC_API_KEY: "offline-rejection-only" });
  assert.equal(result.status, 3); assert.equal(result.stdout, "");
  assert.equal(JSON.parse(result.stderr).error.code, "INVALID_BINDING");
  const malformed = adapter("not JSON"); assert.equal(malformed.status, 3); assert.equal(malformed.stdout, "");
});

test("Gmail MCP names retain read-only policy under semantic or underscore naming", () => {
  assert.equal(loadAgentConfig({}, "/tmp/unused").autonomy, "read");
  for (const name of ["mcp__gmail__list_messages", "mcp__gmail__gmail.messages.list", "mcp__gmail__gmail_messages_list"]) assert.equal(classify(name), "read");
  assert.equal(classify("mcp__gmail__send_email"), "write");
  assert.equal(classify("mcp__unknown__list_messages"), null);
});

test("loopback requests work, foreign origins and DNS rebinding do not", () => {
  assert(isLocalRequest("127.0.0.1:4310", undefined, [4310, 4311]));
  assert(isLocalRequest("localhost:4310", "http://localhost:4311", [4310, 4311]));
  for (const origin of ["https://attacker.example", "null", "http://localhost.attacker.example:4311", "http://localhost:4312", "http://localhost:4311/path"])
    assert.equal(isLocalRequest("localhost:4310", origin, [4310, 4311]), false);
  assert.equal(isLocalRequest("attacker.example:4310", undefined, [4310]), false);
});
