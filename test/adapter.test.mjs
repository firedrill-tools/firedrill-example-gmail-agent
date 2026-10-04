import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isLocalRequest } from "../src/local-request.ts";
import { loadAgentConfig, classify } from "../src/agent.ts";
import { validateToolSetupTestDefinitions } from "@firedrill-run/cloud";

test("saved test, command and read-only actor match", () => {
  const source = JSON.parse(readFileSync("firedrill.tests.json", "utf8"));
  const config = JSON.parse(readFileSync("firedrill.config.json", "utf8"));
  validateToolSetupTestDefinitions(source);
  const drill = source.drills[0];
  assert.equal(source.targets[0].target.id, drill.targetId);
  assert.equal(source.scenarios[0].id, drill.scenarioId);
  assert.equal(source.scenarios[0].actors[0].id, drill.actorId);
  assert.deepEqual(source.scenarios[0].actors[0].grants, [drill.assertions[0].operation]);
  const command = config.targets[drill.targetId];
  assert.equal(command.bindingEnvironment.GMAIL_MCP_URL, "FIREDRILL_MCP_URL");
  assert.equal(command.bindingEnvironment.GMAIL_MCP_TOKEN, "FIREDRILL_MCP_TOKEN");
});

test("an unconfigured agent adapter returns failure, never a fabricated pass", () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "test/run-agent.mjs"], {
    input: JSON.stringify({ schemaVersion: 1, instruction: "List messages" }),
    encoding: "utf8", env: { PATH: process.env.PATH }, timeout: 10000,
  });
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "failed");
  assert.equal(output.error.code, "target.CONFIGURATION_MISSING");
});

test("safe local defaults and unknown tools are denied", () => {
  assert.equal(loadAgentConfig({}, "/tmp/unused").autonomy, "read");
  assert.equal(classify("mcp__gmail__list_messages"), "read");
  assert.equal(classify("mcp__gmail__send_email"), "write");
  assert.equal(classify("mcp__unknown__list_messages"), null);
});

test("invalid tasks and non-Firedrill endpoints fail before calling a model", () => {
  for (const input of [JSON.stringify({ schemaVersion: 1, instruction: "List messages" }), "not JSON"]) {
    const result = spawnSync(process.execPath, ["--import", "tsx", "test/run-agent.mjs"], {
      input, encoding: "utf8", timeout: 10000,
      env: { PATH: process.env.PATH, GMAIL_MCP_URL: "https://attacker.example/mcp", GMAIL_MCP_TOKEN: "example-only", ANTHROPIC_API_KEY: "example-only" },
    });
    assert.equal(result.status, 0);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "failed");
    assert.equal(output.error.code, "target.ADAPTER_FAILED");
  }
});

test("loopback requests work, foreign origins and DNS rebinding do not", () => {
  assert(isLocalRequest("127.0.0.1:4310", undefined, [4310, 4311]));
  assert(isLocalRequest("localhost:4310", "http://localhost:4311", [4310, 4311]));
  for (const origin of ["https://attacker.example", "null", "http://localhost.attacker.example:4311", "http://localhost:4312", "http://localhost:4311/path"]) {
    assert.equal(isLocalRequest("localhost:4310", origin, [4310, 4311]), false);
  }
  assert.equal(isLocalRequest("attacker.example:4310", undefined, [4310]), false);
});
