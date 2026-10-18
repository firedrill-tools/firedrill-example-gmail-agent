import { constants, existsSync, closeSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import { Firedrill } from "@firedrill-run/sdk";

if (process.argv.slice(2).some(value => value !== "--from-env") || process.argv.length > 3) throw new Error("Use npm run firedrill:prepare [-- --from-env]. This only prepares synthetic Tools and recipes; it never runs the agent.");
const fromEnv = process.argv.includes("--from-env"), directory = resolve(".firedrill");
const client = existsSync("firedrill.config.json") ? Firedrill.fromConfig() : new Firedrill();
if (!client.projectId || !client.environmentId) throw new Error("Run npx --no-install firedrill init first, or select both FIREDRILL_PROJECT_ID and FIREDRILL_ENVIRONMENT_ID in CI.");
if (!existsSync(directory)) mkdirSync(directory, { mode: 0o700 });
const stat = lstatSync(directory);
if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(directory) !== directory || stat.uid !== process.getuid() || stat.mode & 0o077) throw new Error(".firedrill must be a private, caller-owned regular directory; no files or cloud resources were changed.");
const read = path => {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try { const file = fstatSync(fd); if (!file.isFile() || file.size > 1048576) throw new Error("Input must be a bounded regular JSON file."); return JSON.parse(readFileSync(fd, "utf8")); }
  finally { closeSync(fd); }
};
const save = (path, value) => {
  const content = JSON.stringify(value, null, 2) + "\n";
  if (existsSync(path)) {
    if (JSON.stringify(read(path)) === JSON.stringify(value)) return;
    throw new Error(`Existing generated file differs and was preserved: ${path}. Preserve it before deliberately preparing another recipe/scope.`);
  }
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, content); fsyncSync(fd); } finally { closeSync(fd); }
};

let buildId, datasetId;
if (fromEnv) {
  buildId = process.env.FIREDRILL_GMAIL_BUILD_ID; datasetId = process.env.FIREDRILL_GMAIL_DATASET_ID;
  if (![buildId, datasetId].every(value => typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value))) throw new Error("CI needs the exact FIREDRILL_GMAIL_BUILD_ID and FIREDRILL_GMAIL_DATASET_ID printed by local preparation. No resource was created.");
} else {
  const intentPath = resolve(directory, "gmail-acquisition-intent.json");
  let intent;
  if (existsSync(intentPath)) {
    intent = read(intentPath);
    if (intent.projectId !== client.projectId || intent.environmentId !== client.environmentId || intent.catalogId !== "gmail" || intent.initialData !== "starter") throw new Error("Saved preparation belongs to a different scope/data selection. Keep its intent and deliberately use another project checkout.");
  } else {
    const release = await client.services.catalogRelease("gmail");
    intent = { projectId: client.projectId, environmentId: client.environmentId, catalogId: "gmail", releaseDigest: release.releaseDigest, initialData: "starter", idempotencyKey: `gmail-example-${randomUUID()}` };
    save(intentPath, intent);
  }
  const selection = { catalogId: intent.catalogId, releaseDigest: intent.releaseDigest, initialData: intent.initialData };
  let acquisition = await client.services.acquire(selection, intent.idempotencyKey);
  const deadline = Date.now() + 90000;
  while (["prepared", "building", "seeding"].includes(acquisition.phase) && Date.now() < deadline) {
    await wait(1000); acquisition = await client.services.acquisition(acquisition.id);
  }
  if (acquisition.phase !== "ready" || !acquisition.buildId || !acquisition.datasetId) throw new Error(`Gmail acquisition is ${acquisition.phase}. Repeat npm run firedrill:prepare to recover the same saved operation; do not delete the intent or allocate a replacement.`);
  buildId = acquisition.buildId; datasetId = acquisition.datasetId;
}
const [build, dataset] = await Promise.all([client.services.build(buildId), client.services.dataset(datasetId)]);
if (build.status !== "ready" || build.projectId !== client.projectId || build.manifest.id !== "gmail" ||
    !build.manifest.operations?.some(operation => operation.id === "messages.list") || dataset.projectId !== client.projectId || dataset.buildId !== buildId) throw new Error("The selected build/dataset is not a ready Gmail release in this project. Nothing was run.");

const template = read(resolve("firedrill/recipe.template.json")), scenarios = read(resolve("firedrill/scenarios.json"));
const recipe = { ...template, scenarios, services: [{ alias: "gmail", buildId, datasetId, seed: "20261018", operations: ["messages.list"] }] };
save(resolve(directory, "recipe.pass.json"), recipe);
const deliberatelyFailing = structuredClone(recipe);
deliberatelyFailing.name = "Gmail agent — deliberately failing read-count expectation";
const selected = deliberatelyFailing.scenarios.find(scenario => scenario.id === "list-inbox");
selected.id = "list-inbox-deliberate-expectation";
selected.name = "Deliberate negative control: incorrectly expect zero reads";
selected.description = "The agent is still asked to list mail. Only this expectation is deliberately wrong to demonstrate a real failed CI gate; this is not evidence of an agent defect.";
const check = selected.checks.find(item => item.id === "gmail-list-observed");
check.comparator = "equals"; check.expected = 0;
check.description = "Deliberate negative control: incorrectly expect zero Gmail list calls although the task asks for a listing";
save(resolve(directory, "recipe.deliberate-failure.json"), deliberatelyFailing);
console.log(JSON.stringify({ projectId: client.projectId, environmentId: client.environmentId, buildId, datasetId,
  recipes: [".firedrill/recipe.pass.json", ".firedrill/recipe.deliberate-failure.json"], runsPerRecipe: 2, operations: ["messages.list"], targetInvoked: false,
  next: "npx --no-install firedrill simulate .firedrill/recipe.pass.json", recovery: "npm run firedrill:prepare" }, null, 2));
