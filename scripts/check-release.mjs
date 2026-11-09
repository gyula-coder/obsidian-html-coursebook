import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";

const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const manifest = await json("manifest.json");
const pkg = await json("package.json");
const versions = await json("versions.json");
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.equal(pkg.version, manifest.version);
assert.equal(versions[manifest.version], manifest.minAppVersion);
assert.equal(manifest.id, "html-coursebook");
assert.equal(manifest.isDesktopOnly, true);
assert.ok(manifest.description.length <= 250 && manifest.description.endsWith("."));
if (process.env.GITHUB_REF_TYPE === "tag") assert.equal(process.env.GITHUB_REF_NAME, manifest.version, "Release tag must match manifest.version exactly, without a v prefix.");
for (const path of ["main.js", "manifest.json", "styles.css", "README.md", "LICENSE"]) await access(path);
console.log(`Release metadata and assets verified: ${manifest.version}`);
