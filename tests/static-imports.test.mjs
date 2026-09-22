import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Pages deploys tracked files, not every file on a developer's disk. Check the
// staged/tracked module graph so an omitted new import cannot ship a blank app.
const root = fileURLToPath(new URL("../", import.meta.url));
const tracked = new Set(execFileSync("git", ["ls-files", "--cached", "-z"], { cwd: root, encoding: "utf8" }).split("\0"));
const visited = new Set();
async function walk(file) {
  const deployedFile = file.split("?", 1)[0];
  assert.ok(tracked.has(deployedFile), `Module ${deployedFile} is not tracked/staged for deployment`);
  if (visited.has(deployedFile)) return;
  visited.add(deployedFile);
  const source = await fs.readFile(path.join(root, deployedFile), "utf8");
  const imports = [...source.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["'](\.[^"']+)["']/g)].map((match) => match[1]);
  for (const imported of imports) await walk(path.posix.normalize(path.posix.join(path.posix.dirname(deployedFile), imported)));
}
await walk("js/app.js");
await walk("js/reset.js");
console.log(`Verified ${visited.size} deployed modules are tracked and resolvable`);
