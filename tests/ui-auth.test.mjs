import assert from "node:assert/strict";
import fs from "node:fs/promises";

const index = await fs.readFile(new URL("../index.html", import.meta.url), "utf8");
const app = await fs.readFile(new URL("../js/app.js", import.meta.url), "utf8");
const css = await fs.readFile(new URL("../css/styles.css", import.meta.url), "utf8");

assert.match(index, />Email or username\s*<input type="text" name="identifier" autocomplete="username"/);
assert.doesNotMatch(index, /name="identifier"[^>]*type="email"/);
assert.match(app, /if \(!syncStatus\.signedIn\) \{[\s\S]*This device is locked/);
assert.match(app, /if \(!mount \|\| !syncStatus\.signedIn\) return;/);
assert.match(app, /<h4>Display name<\/h4>/);
assert.match(app, /<h4>Sign-in username<\/h4>/);
assert.match(css, /\.today-header h1 \{[^}]*overflow-wrap:\s*anywhere/);

console.log("lock-screen/editor reachability and mobile-overflow static tests passed");
