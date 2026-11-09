import assert from "node:assert/strict";
import test from "node:test";
import { cleanPath, discoverBundles, externalUrl, findBundle, movePath, searchCourses, type Course } from "../src/core.ts";

void test("a course stays one document even with nested HTML assets; sibling courses stay separate", () => {
  const bundles = discoverBundles([
    "atlas/vendor/demo/index.html", "atlas/index.html", "atlas/assets/poster.png",
    "courses/线性代数/index.htm", "atlas-2/index.html", "index.html",
    "node_modules/demo/index.html", ".trash/old/index.html",
  ]);
  assert.deepEqual(bundles.map((x) => x.root), ["atlas", "atlas-2", "courses/线性代数"]);
  assert.equal(findBundle("atlas-2/app.js", bundles)?.root, "atlas-2");
  assert.equal(findBundle("atlas-copy/app.js", bundles), undefined);
});

void test("entry precedence is deterministic and exclusions respect directory boundaries", () => {
  assert.deepEqual(discoverBundles(["a/index.htm", "a/index.html", "ab/index.html"], ["a"]).map((x) => x.root), ["ab"]);
  assert.equal(discoverBundles(["a/index.htm", "a/index.html"])[0].entry, "a/index.html");
  assert.equal(discoverBundles(["a/index.html", "a/index.htm"])[0].entry, "a/index.html");
});

void test("unsafe paths cannot become bundle roots or persisted reader paths", () => {
  for (const path of ["../atlas", "atlas/../other", "/tmp/atlas", "C:\\atlas", "a//b", "."]) assert.equal(cleanPath(path), null);
  assert.equal(cleanPath("课程\\动画/"), "课程/动画");
});

void test("renaming an ancestor updates an open reader without touching similarly named siblings", () => {
  assert.equal(movePath("courses/atlas", "courses", "学习"), "学习/atlas");
  assert.equal(movePath("courses-2/atlas", "courses", "学习"), "courses-2/atlas");
});

void test("search finds Chinese body text as well as names and requires all query words", () => {
  const course: Course = { root: "atlas", entry: "atlas/index.html", name: "atlas", title: "动画格式", text: "理解四元数插值与关键帧。", mtime: 1 };
  assert.equal(searchCourses([course], "四元数").length, 1);
  assert.equal(searchCourses([course], "ATLAS 关键帧").length, 1);
  assert.equal(searchCourses([course], "atlas 不存在").length, 0);
  assert.match(searchCourses([course], "插值")[0].snippet, /插值/);
});

void test("course links may open web and email addresses, never executable system protocols", () => {
  for (const value of ["javascript:alert(1)", "file:///etc/passwd", "obsidian://open", "data:text/html,x", "not a url"]) assert.equal(externalUrl(value), null);
  assert.equal(externalUrl("https://example.com/a?q=1"), "https://example.com/a?q=1");
  assert.equal(externalUrl("mailto:reader@example.com"), "mailto:reader@example.com");
});
