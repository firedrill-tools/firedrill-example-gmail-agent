import { existsSync } from "node:fs";
import { Firedrill, FiredrillError, batchReceipt, simulationExitCode } from "@firedrill-run/sdk";

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--resume" || !/^[A-Za-z0-9_-]{1,160}$/.test(args[1]))) throw new Error("Use npm run simulate, or npm run simulate -- --resume SAVED_OPERATION_ID.");
const expectation = process.env.FIREDRILL_EXPECTATION ?? "pass";
if (!["pass", "deliberate-failure"].includes(expectation)) throw new Error("FIREDRILL_EXPECTATION must be pass or deliberate-failure.");
if (!process.env.ANTHROPIC_API_KEY) throw new Error("Supply ANTHROPIC_API_KEY through your shell/CI secret manager. This runner does not load .env or browser credentials.");
const client = existsSync("firedrill.config.json") ? Firedrill.fromConfig() : new Firedrill();
const controller = new AbortController(), stop = () => controller.abort();
process.once("SIGINT", stop); process.once("SIGTERM", stop);
try {
  const options = { signal: controller.signal, ...(process.env.CI ? { submissionOrigin: "ci" } : {}),
    onProgress: progress => { if (progress.batchId || progress.runId) process.stderr.write(JSON.stringify({ phase: progress.phase, batchId: progress.batchId, runId: progress.runId, operationId: progress.operationId }) + "\n"); } };
  const result = args[1] ? await client.resume(args[1], undefined, options)
    : await client.simulate(`.firedrill/recipe.${expectation}.json`, undefined, options);
  console.log(JSON.stringify(batchReceipt(result), null, 2));
  process.exitCode = simulationExitCode(result);
} catch (error) {
  if (error instanceof FiredrillError) {
    const operationId = error.details.operationId;
    process.stderr.write(JSON.stringify({ error: { code: error.code, message: error.message, repair: error.repair,
      ...(operationId ? { operationId, recovery: `npm run simulate -- --resume ${operationId}` } : {}) } }) + "\n");
  } else process.stderr.write(JSON.stringify({ error: { code: "RUNNER_UNCONFIRMED", message: "The simulation response was not confirmed; inspect the last saved operation before rerunning the agent." } }) + "\n");
  process.exitCode = 2;
} finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
