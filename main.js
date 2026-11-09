/* HTML Coursebook — local HTML folders as documents. */
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => HtmlCoursebookPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var import_node_url = require("node:url");
var import_node_path = require("node:path");

// src/core.ts
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function cleanPath(value) {
  const path = value.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (!path || path.startsWith("/") || /^[a-z]:/i.test(path)) return null;
  const parts = path.split("/");
  if (parts.some((p) => !p || p === "." || p === "..")) return null;
  return parts.join("/");
}
function isWithin(path, root) {
  return path === root || path.startsWith(root + "/");
}
function discoverBundles(filePaths, ignoredFolders = []) {
  const ignored = ignoredFolders.map(cleanPath).filter((p) => p !== null);
  const candidates = /* @__PURE__ */ new Map();
  for (const original of filePaths) {
    const path = cleanPath(original);
    if (!path) continue;
    const parts = path.split("/");
    const file = parts.pop();
    if (!parts.length || !/^index\.html?$/i.test(file)) continue;
    if (parts.some((p) => p.startsWith(".") || p === "node_modules")) continue;
    const root = parts.join("/");
    if (ignored.some((p) => isWithin(root, p))) continue;
    const existing = candidates.get(root);
    if (!existing || file.toLowerCase() === "index.html" && !existing.entry.toLowerCase().endsWith("index.html")) {
      candidates.set(root, { root, entry: path, name: parts[parts.length - 1] });
    }
  }
  const sorted = [...candidates.values()].sort(
    (a, b) => a.root.split("/").length - b.root.split("/").length || a.root.localeCompare(b.root)
  );
  const roots = [];
  for (const candidate of sorted) {
    if (!roots.some((parent) => isWithin(candidate.root, parent.root))) roots.push(candidate);
  }
  return roots.sort((a, b) => a.root.localeCompare(b.root));
}
function findBundle(path, bundles) {
  for (const bundle of bundles) if (isWithin(path, bundle.root)) return bundle;
}
function movePath(path, oldPath, newPath) {
  return isWithin(path, oldPath) ? newPath + path.slice(oldPath.length) : path;
}
function externalUrl(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:", "mailto:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
function searchCourses(courses, query) {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/u).filter(Boolean);
  return courses.flatMap((course) => {
    const haystack = `${course.name}
${course.title}
${course.root}
${course.text}`.toLocaleLowerCase();
    if (!terms.every((term) => haystack.includes(term))) return [];
    const hit = terms.length ? course.text.toLocaleLowerCase().indexOf(terms[0]) : -1;
    const start = Math.max(0, hit - 35);
    return [{ course, snippet: (start ? "\u2026" : "") + course.text.slice(start, start + 130) + (course.text.length > start + 130 ? "\u2026" : "") }];
  });
}

// src/main.ts
var VIEW_TYPE = "html-coursebook-reader";
var DEFAULT_SETTINGS = { autoReload: true, ignoredFolders: [] };
var t = (english, chinese) => (0, import_obsidian.getLanguage)().startsWith("zh") ? chinese : english;
var { shell } = require("electron");
var HtmlCoursebookPlugin = class extends import_obsidian.Plugin {
  settings = { ...DEFAULT_SETTINGS };
  courses = /* @__PURE__ */ new Map();
  revealed = /* @__PURE__ */ new Set();
  observers = /* @__PURE__ */ new Map();
  decorations = /* @__PURE__ */ new Map();
  scanVersion = 0;
  scanTimer = 0;
  decorateTimer = 0;
  stopped = false;
  async onload() {
    const raw = await this.loadData();
    const saved = isRecord(raw) ? raw : {};
    this.settings = {
      autoReload: typeof saved?.autoReload === "boolean" ? saved.autoReload : true,
      ignoredFolders: Array.isArray(saved?.ignoredFolders) ? saved.ignoredFolders.filter((p) => typeof p === "string" && cleanPath(p) !== null) : []
    };
    this.registerView(VIEW_TYPE, (leaf) => new CoursebookView(leaf, this));
    this.addSettingTab(new CoursebookSettings(this.app, this));
    this.addRibbonIcon("book-open", t("Open HTML course", "\u6253\u5F00 HTML \u8BFE\u4EF6"), () => this.openPicker());
    this.addCommand({ id: "open-course", name: t("Open course / search text", "\u6253\u5F00\u8BFE\u4EF6 / \u641C\u7D22\u6B63\u6587"), callback: () => this.openPicker() });
    this.addCommand({ id: "rescan", name: t("Rescan course folders", "\u91CD\u65B0\u8BC6\u522B\u8BFE\u4EF6\u76EE\u5F55"), callback: async () => {
      await this.refreshCourses();
      new import_obsidian.Notice(t(`Found ${this.courses.size} HTML courses.`, `\u5DF2\u8BC6\u522B ${this.courses.size} \u4EFD HTML \u8BFE\u4EF6`));
    } });
    this.addCommand({ id: "reload-course", name: t("Reload current course", "\u5237\u65B0\u5F53\u524D\u8BFE\u4EF6"), checkCallback: (checking) => {
      const view = this.app.workspace.getActiveViewOfType(CoursebookView);
      if (!view) return false;
      if (!checking) void view.reloadPage();
      return true;
    } });
    this.registerObsidianProtocolHandler("html-coursebook", (params) => {
      const root = cleanPath(params.path ?? "");
      if (root) void this.openCourse(root);
    });
    this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
      const course = findBundle(file.path, this.courses.values());
      if (!course || file instanceof import_obsidian.TFolder && file.path !== course.root) return;
      menu.addSeparator();
      menu.addItem((item) => item.setTitle(t("Open HTML course", "\u6253\u5F00 HTML \u8BFE\u4EF6")).setIcon("book-open").onClick(() => {
        void this.openCourse(course.root);
      }));
      menu.addItem((item) => item.setTitle(t("Open course in default browser", "\u5728\u9ED8\u8BA4\u6D4F\u89C8\u5668\u4E2D\u6253\u5F00\u8BFE\u4EF6")).setIcon("external-link").onClick(() => {
        void this.openExternal(course);
      }));
      menu.addItem((item) => item.setTitle(t("Copy course link", "\u590D\u5236\u8BFE\u4EF6\u94FE\u63A5")).setIcon("link").onClick(() => {
        void this.copyCourseLink(course);
      }));
      if (file instanceof import_obsidian.TFolder) {
        const revealed = this.revealed.has(course.root);
        menu.addItem((item) => item.setTitle(revealed ? t("Show course as one document", "\u5C06\u8BFE\u4EF6\u663E\u793A\u4E3A\u5355\u4E2A\u6587\u6863") : t("Temporarily show course contents", "\u4E34\u65F6\u663E\u793A\u8BFE\u4EF6\u5185\u90E8\u6587\u4EF6")).setIcon(revealed ? "file-code" : "folder-open").onClick(() => {
          if (revealed) this.revealed.delete(course.root);
          else this.revealed.add(course.root);
          this.decorateExplorers();
        }));
      }
    }));
    this.registerEvent(this.app.workspace.on("layout-change", () => {
      this.watchExplorers();
      this.queueDecorate();
    }));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.queueDecorate()));
    this.registerEvent(this.app.vault.on("create", (file) => {
      this.queueScan();
      this.reloadAffected(file);
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      this.queueScan();
      this.reloadAffected(file);
    }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      for (const view of this.readerViews()) view.renameRoot(oldPath, file.path);
      this.revealed = new Set([...this.revealed].map((p) => movePath(p, oldPath, file.path)));
      this.settings.ignoredFolders = this.settings.ignoredFolders.map((p) => movePath(p, oldPath, file.path));
      void this.saveData(this.settings);
      this.queueScan();
      this.reloadAffected(file);
    }));
    this.registerEvent(this.app.vault.on("modify", (file) => {
      const course = findBundle(file.path, this.courses.values());
      if (course?.entry === file.path) this.queueScan();
      this.reloadAffected(file);
    }));
    this.app.workspace.onLayoutReady(() => {
      if (this.stopped) return;
      this.watchExplorers();
      void this.refreshCourses();
    });
  }
  onunload() {
    this.stopped = true;
    this.scanVersion++;
    window.clearTimeout(this.scanTimer);
    window.clearTimeout(this.decorateTimer);
    for (const observer of this.observers.values()) observer.disconnect();
    this.observers.clear();
    for (const row of [...this.decorations.keys()]) this.restoreRow(row);
  }
  readerViews() {
    return this.app.workspace.getLeavesOfType(VIEW_TYPE).map((leaf) => leaf.view).filter((view) => view instanceof CoursebookView);
  }
  reloadAffected(file) {
    if (!this.settings.autoReload) return;
    const course = findBundle(file.path, this.courses.values());
    if (!course) return;
    for (const view of this.readerViews()) if (view.root === course.root) view.queueReload();
  }
  queueScan() {
    window.clearTimeout(this.scanTimer);
    this.scanTimer = window.setTimeout(() => {
      void this.refreshCourses();
    }, 180);
  }
  async refreshCourses() {
    const version = ++this.scanVersion;
    const bundles = discoverBundles(this.app.vault.getFiles().map((file) => file.path), this.settings.ignoredFolders);
    const courses = [];
    for (let i = 0; i < bundles.length; i += 4) {
      const records = await Promise.all(bundles.slice(i, i + 4).map((bundle) => this.readCourse(bundle)));
      if (this.stopped || version !== this.scanVersion) return;
      courses.push(...records);
    }
    this.courses = new Map(courses.map((course) => [course.root, course]));
    this.watchExplorers();
    this.decorateExplorers();
    for (const view of this.readerViews()) view.onCoursesChanged();
  }
  async readCourse(bundle) {
    const file = this.app.vault.getAbstractFileByPath(bundle.entry);
    const mtime = file instanceof import_obsidian.TFile ? file.stat.mtime : 0;
    const previous = this.courses.get(bundle.root);
    if (previous?.mtime === mtime && previous.entry === bundle.entry) return previous;
    try {
      const html = await this.app.vault.adapter.read(bundle.entry);
      const doc = new DOMParser().parseFromString(html, "text/html");
      const title = doc.title.trim() || bundle.name;
      doc.querySelectorAll("script,style,noscript,template").forEach((node) => node.remove());
      const text = (doc.body.textContent ?? "").replace(/\s+/gu, " ").trim();
      return { ...bundle, title, text, mtime };
    } catch (error) {
      console.warn("HTML Coursebook: cannot index", bundle.entry, error);
      return { ...bundle, title: bundle.name, text: "", mtime: -1 };
    }
  }
  async resolveCourse(root) {
    if (this.courses.has(root)) return this.courses.get(root);
    const valid = cleanPath(root);
    if (!valid) return;
    const folder = this.app.vault.getAbstractFileByPath(valid);
    if (!(folder instanceof import_obsidian.TFolder)) return;
    const bundle = discoverBundles(folder.children.filter((f) => f instanceof import_obsidian.TFile).map((f) => f.path), this.settings.ignoredFolders).find((b) => b.root === valid);
    return bundle ? this.readCourse(bundle) : void 0;
  }
  async openCourse(root, newTab = false) {
    const course = await this.resolveCourse(root);
    if (!course) {
      new import_obsidian.Notice(t("No entry page found. Check that the folder contains index.html or index.htm.", "\u672A\u627E\u5230\u8BFE\u4EF6\u5165\u53E3\uFF0C\u8BF7\u786E\u8BA4\u76EE\u5F55\u5185\u6709 index.html \u6216 index.htm\u3002"));
      return;
    }
    if (!newTab) {
      const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE).find((leaf2) => leaf2.view.root === root);
      if (existing) {
        await this.app.workspace.revealLeaf(existing);
        return;
      }
    }
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE, state: { root: course.root }, active: true });
    await this.app.workspace.revealLeaf(leaf);
    this.queueDecorate();
  }
  fileUrl(entry) {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof import_obsidian.FileSystemAdapter)) throw new Error(t("HTML Coursebook requires a local desktop vault.", "HTML Coursebook \u9700\u8981\u684C\u9762\u7AEF\u672C\u5730\u4ED3\u5E93\u3002"));
    return (0, import_node_url.pathToFileURL)((0, import_node_path.join)(adapter.getBasePath(), entry)).href;
  }
  async openExternal(course) {
    await shell.openExternal(this.fileUrl(course.entry));
  }
  revealInFinder(course) {
    const adapter = this.app.vault.adapter;
    if (adapter instanceof import_obsidian.FileSystemAdapter) shell.showItemInFolder((0, import_node_path.join)(adapter.getBasePath(), course.root));
  }
  async copyCourseLink(course) {
    const params = new URLSearchParams({ vault: this.app.vault.getName(), path: course.root });
    await navigator.clipboard.writeText(`obsidian://html-coursebook?${params}`);
    new import_obsidian.Notice(t("Course link copied. Paste it into a note.", "\u5DF2\u590D\u5236\u8BFE\u4EF6\u94FE\u63A5\uFF0C\u53EF\u7C98\u8D34\u5230\u7B14\u8BB0\u4E2D\u3002"));
  }
  openPicker() {
    new CoursePicker(this.app, this).open();
  }
  watchExplorers() {
    if (this.stopped) return;
    const views = this.app.workspace.getLeavesOfType("file-explorer").map((leaf) => leaf.view);
    const live = new Set(views.map((view) => view.containerEl));
    for (const [container, observer] of this.observers) {
      if (!live.has(container)) {
        observer.disconnect();
        this.observers.delete(container);
      }
    }
    for (const view of views) {
      const container = view.containerEl;
      if (this.observers.has(container)) continue;
      const observer = new MutationObserver(() => this.queueDecorate());
      observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-path"] });
      this.observers.set(container, observer);
      this.registerDomEvent(container, "click", (event) => this.onExplorerClick(event), true);
      this.registerDomEvent(container, "auxclick", (event) => this.onExplorerClick(event), true);
      this.registerDomEvent(container, "dblclick", (event) => {
        if (this.courseRow(event.target)) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      }, true);
      this.registerDomEvent(container, "keydown", (event) => {
        if (!["Enter", " ", "ArrowRight"].includes(event.key)) return;
        const row = this.courseRow(event.target);
        if (!row) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        void this.openCourse(row.dataset.path, event.metaKey || event.ctrlKey);
      }, true);
    }
  }
  courseRow(target) {
    const row = target?.closest?.(".nav-folder-title[data-path]");
    const root = row?.dataset.path;
    return row && root && this.courses.has(root) && !this.revealed.has(root) ? row : null;
  }
  onExplorerClick(event) {
    if (event.type === "auxclick" && event.button !== 1) return;
    if (event.type === "click" && event.button !== 0) return;
    const row = this.courseRow(event.target);
    if (!row) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    row.focus({ preventScroll: true });
    void this.openCourse(row.dataset.path, event.metaKey || event.ctrlKey || event.button === 1);
  }
  queueDecorate() {
    if (this.stopped || this.decorateTimer) return;
    this.decorateTimer = window.setTimeout(() => {
      this.decorateTimer = 0;
      if (!this.stopped) this.decorateExplorers();
    }, 40);
  }
  decorateExplorers() {
    const active = this.app.workspace.getActiveViewOfType(CoursebookView)?.root;
    for (const [row, decoration] of [...this.decorations]) {
      if (!row.isConnected || row.dataset.path !== decoration.root || !this.courses.has(decoration.root) || this.revealed.has(decoration.root)) this.restoreRow(row);
    }
    for (const leaf of this.app.workspace.getLeavesOfType("file-explorer")) {
      const view = leaf.view;
      for (const row of view.containerEl.querySelectorAll(".nav-folder-title[data-path]")) {
        const root = row.dataset.path;
        const course = this.courses.get(root);
        if (!course || this.revealed.has(root)) continue;
        const wrapper = row.parentElement;
        if (!wrapper?.classList.contains("nav-folder")) continue;
        if (!this.decorations.has(row)) {
          const item2 = view.fileItems?.[root];
          const attributes = {};
          for (const name of ["title", "tabindex", "role", "aria-label"]) attributes[name] = row.getAttribute(name);
          this.decorations.set(row, { root, wrapper, attributes, item: item2, wasCollapsed: item2?.collapsed });
          wrapper.classList.add("hc-document-bundle");
          row.classList.add("hc-document-row");
          row.setAttribute("tabindex", "0");
          row.setAttribute("role", "button");
          const icon = row.ownerDocument.createElement("span");
          icon.className = "hc-document-icon";
          icon.setAttribute("aria-hidden", "true");
          (0, import_obsidian.setIcon)(icon, "file-code");
          row.insertBefore(icon, row.querySelector(".nav-folder-title-content"));
        }
        const item = view.fileItems?.[root];
        if (item && !item.collapsed) item.setCollapsed(true);
        row.title = `${course.title}
${t("HTML course \xB7 Click to open \xB7 Right-click to manage", "HTML \u8BFE\u4EF6 \xB7 \u70B9\u51FB\u6253\u5F00 \xB7 \u53F3\u952E\u7BA1\u7406")}`;
        row.setAttribute("aria-label", `${course.name}, ${t("HTML course", "HTML \u8BFE\u4EF6")}, ${course.title}`);
        row.classList.toggle("hc-is-active", active === root);
      }
    }
  }
  restoreRow(row) {
    const decoration = this.decorations.get(row);
    if (!decoration) return;
    this.decorations.delete(row);
    decoration.wrapper.classList.remove("hc-document-bundle");
    row.classList.remove("hc-document-row", "hc-is-active");
    row.querySelector(".hc-document-icon")?.remove();
    for (const [name, value] of Object.entries(decoration.attributes)) {
      if (value === null) row.removeAttribute(name);
      else row.setAttribute(name, value);
    }
    if (row.isConnected && decoration.item && decoration.wasCollapsed === false) decoration.item.setCollapsed(false);
  }
};
var CoursebookView = class extends import_obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }
  navigation = true;
  root = "";
  course;
  guest;
  frame;
  findBar;
  findInput;
  findCount;
  reloadTimer = 0;
  findTimer = 0;
  loadVersion = 0;
  messagePrefix = "HC_" + crypto.randomUUID() + ":";
  pendingScroll;
  getViewType() {
    return VIEW_TYPE;
  }
  getDisplayText() {
    return this.course?.title || this.root.split("/").pop() || t("HTML course", "HTML \u8BFE\u4EF6");
  }
  getIcon() {
    return "file-code";
  }
  getState() {
    return { root: this.root };
  }
  async setState(state, result) {
    this.root = cleanPath(state.root ?? "") ?? "";
    await this.loadCourse();
    await super.setState(state, result);
  }
  async onOpen() {
    this.contentEl.addClass("hc-reader");
    this.findBar = this.contentEl.createDiv({ cls: "hc-find-bar" });
    this.findBar.hidden = true;
    this.findInput = this.findBar.createEl("input", { type: "search", placeholder: t("Find text in this course\u2026", "\u641C\u7D22\u8BFE\u4EF6\u6B63\u6587\u2026") });
    this.findInput.setAttribute("aria-label", t("Find course text", "\u641C\u7D22\u8BFE\u4EF6\u6B63\u6587"));
    this.findCount = this.findBar.createSpan({ cls: "hc-find-count" });
    const button = (icon, label, action) => {
      const el = this.findBar.createEl("button", { cls: "hc-icon-button", attr: { "aria-label": label, title: label } });
      (0, import_obsidian.setIcon)(el, icon);
      this.registerDomEvent(el, "click", action);
    };
    button("chevron-up", t("Previous match", "\u4E0A\u4E00\u4E2A\u7ED3\u679C"), () => this.find(false));
    button("chevron-down", t("Next match", "\u4E0B\u4E00\u4E2A\u7ED3\u679C"), () => this.find(true));
    button("x", t("Close search", "\u5173\u95ED\u641C\u7D22"), () => this.closeFind());
    this.registerDomEvent(this.findInput, "input", () => {
      window.clearTimeout(this.findTimer);
      this.findTimer = window.setTimeout(() => this.find(true, true), 120);
    });
    this.registerDomEvent(this.findInput, "keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.closeFind();
      }
      if (event.key === "Enter") {
        event.preventDefault();
        this.find(!event.shiftKey);
      }
    });
    this.frame = this.contentEl.createDiv({ cls: "hc-reader-frame" });
    this.addAction("search", t("Find text (Ctrl/Cmd+F)", "\u641C\u7D22\u6B63\u6587 (Ctrl/Cmd+F)"), () => this.openFind());
    this.addAction("refresh-cw", t("Reload course", "\u91CD\u65B0\u52A0\u8F7D\u8BFE\u4EF6"), () => {
      void this.reloadPage();
    });
    this.addAction("link", t("Copy course link", "\u590D\u5236\u8BFE\u4EF6\u94FE\u63A5"), () => {
      if (this.course) void this.plugin.copyCourseLink(this.course);
    });
    this.addAction("external-link", t("Open in default browser", "\u5728\u9ED8\u8BA4\u6D4F\u89C8\u5668\u4E2D\u6253\u5F00"), () => {
      if (this.course) void this.plugin.openExternal(this.course);
    });
    this.addAction("folder-open", t("Show course in system file manager", "\u5728\u7CFB\u7EDF\u6587\u4EF6\u7BA1\u7406\u5668\u4E2D\u663E\u793A\u8BFE\u4EF6"), () => {
      if (this.course) this.plugin.revealInFinder(this.course);
    });
    this.registerDomEvent(this.containerEl, "keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        event.stopPropagation();
        this.openFind();
      }
    });
  }
  async onClose() {
    this.loadVersion++;
    window.clearTimeout(this.reloadTimer);
    window.clearTimeout(this.findTimer);
    this.guest?.remove();
    this.guest = void 0;
    this.contentEl.empty();
  }
  async loadCourse() {
    const version = ++this.loadVersion;
    this.course = await this.plugin.resolveCourse(this.root);
    if (version !== this.loadVersion) return;
    this.frame.empty();
    this.guest = void 0;
    if (!this.course) {
      this.showMessage(t("Course entry not found", "\u627E\u4E0D\u5230\u8BFE\u4EF6\u5165\u53E3"), t("Check that the course folder is still in the vault and contains index.html or index.htm.", "\u8BF7\u786E\u8BA4\u8BFE\u4EF6\u76EE\u5F55\u4ECD\u5728\u4ED3\u5E93\u4E2D\uFF0C\u5E76\u5305\u542B index.html \u6216 index.htm\u3002"));
      return;
    }
    this.refreshHeader();
    this.pendingScroll = void 0;
    const loading = this.frame.createDiv({ cls: "hc-loading", text: t("Opening course\u2026", "\u6B63\u5728\u6253\u5F00\u8BFE\u4EF6\u2026") });
    const guest = this.frame.ownerDocument.createElement("webview");
    guest.className = "hc-webview";
    guest.setAttribute("aria-label", this.course.title);
    guest.setAttribute("webpreferences", "contextIsolation=yes,sandbox=yes,nodeIntegration=no,webSecurity=yes,allowRunningInsecureContent=no");
    guest.setAttribute("partition", `persist:html-coursebook-${hashString(this.root)}`);
    guest.addEventListener("dom-ready", () => {
      loading.remove();
      void this.prepareGuest(guest);
    });
    guest.addEventListener("did-fail-load", (event) => {
      const failure = event;
      if (!failure.isMainFrame || failure.errorCode === -3) return;
      loading.remove();
      guest.remove();
      if (this.guest === guest) this.guest = void 0;
      this.showMessage(t("Could not open course", "\u8BFE\u4EF6\u672A\u80FD\u6253\u5F00"), t(`${failure.errorDescription}. Reload the page or use the toolbar to open it in your browser.`, `${failure.errorDescription}\u3002\u53EF\u7528\u53F3\u4E0A\u89D2\u6309\u94AE\u5728\u9ED8\u8BA4\u6D4F\u89C8\u5668\u4E2D\u6253\u5F00\uFF0C\u6216\u91CD\u65B0\u52A0\u8F7D\u3002`));
    });
    guest.addEventListener("console-message", (event) => {
      const message = event.message;
      if (typeof message !== "string" || !message.startsWith(this.messagePrefix)) return;
      try {
        const data = JSON.parse(message.slice(this.messagePrefix.length));
        if (!isRecord(data)) return;
        if (data.type === "find") this.openFind();
        if (data.type === "external" && typeof data.url === "string") {
          const url = externalUrl(data.url);
          if (url) void shell.openExternal(url);
        }
      } catch {
      }
    });
    guest.addEventListener("found-in-page", (event) => {
      const { matches, activeMatchOrdinal } = event.result;
      this.findCount.textContent = matches ? `${activeMatchOrdinal} / ${matches}` : t("No matches", "\u65E0\u5339\u914D");
    });
    this.guest = guest;
    guest.setAttribute("src", this.plugin.fileUrl(this.course.entry));
    this.frame.appendChild(guest);
  }
  showMessage(title, description) {
    this.frame.querySelector(".hc-message")?.remove();
    const message = this.frame.createDiv({ cls: "hc-message" });
    const icon = message.createDiv({ cls: "hc-message-icon" });
    (0, import_obsidian.setIcon)(icon, "file-code");
    message.createEl("h3", { text: title });
    message.createEl("p", { text: description });
  }
  refreshHeader() {
    this.leaf.updateHeader?.();
    const title = this.containerEl.querySelector(".view-header-title");
    if (title) title.textContent = this.getDisplayText();
  }
  async prepareGuest(guest) {
    const prefix = JSON.stringify(this.messagePrefix);
    try {
      await guest.executeJavaScript(`(() => {
        if (window.__htmlCoursebookPrepared) return;
        window.__htmlCoursebookPrepared = true;
        const send = (data) => console.info(${prefix} + JSON.stringify(data));
        document.addEventListener('click', (event) => {
          const anchor = event.target?.closest?.('a[href]');
          if (!anchor || anchor.hasAttribute('download')) return;
          const url = new URL(anchor.href, location.href);
          if (['https:', 'http:', 'mailto:'].includes(url.protocol)) {
            event.preventDefault(); event.stopImmediatePropagation();
            send({type: 'external', url: url.href});
          }
        }, true);
        document.addEventListener('keydown', (event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
            event.preventDefault(); event.stopImmediatePropagation(); send({type: 'find'});
          }
        }, true);
      })()`);
      if (this.pendingScroll) {
        const scroll = this.pendingScroll;
        this.pendingScroll = void 0;
        await guest.executeJavaScript(`window.scrollTo({left:${Number(scroll.x) || 0},top:${Number(scroll.y) || 0},behavior:'instant'})`);
      }
      if (!this.findBar.hidden && this.findInput.value) this.find(true, true);
    } catch (error) {
      if (guest.isConnected) console.warn("HTML Coursebook: reader helpers unavailable", error);
    }
  }
  queueReload() {
    window.clearTimeout(this.reloadTimer);
    this.reloadTimer = window.setTimeout(() => {
      void this.reloadPage();
    }, 600);
  }
  async reloadPage() {
    const guest = this.guest;
    if (!guest) {
      await this.loadCourse();
      return;
    }
    try {
      this.pendingScroll = await guest.executeJavaScript("(() => { history.scrollRestoration = 'manual'; return {x:window.scrollX,y:window.scrollY}; })()");
      guest.reload();
    } catch {
      await this.loadCourse();
    }
  }
  renameRoot(oldPath, newPath) {
    const moved = movePath(this.root, oldPath, newPath);
    if (moved !== this.root) {
      this.root = moved;
      void this.loadCourse();
      this.app.workspace.requestSaveLayout();
    }
  }
  onCoursesChanged() {
    if (!this.frame) return;
    const course = this.plugin.courses.get(this.root);
    if (!course) {
      this.loadVersion++;
      this.guest?.remove();
      this.guest = void 0;
      this.frame.empty();
      this.showMessage(t("Course folder was removed or ignored", "\u8BFE\u4EF6\u76EE\u5F55\u5DF2\u79FB\u9664\u6216\u88AB\u5FFD\u7565"), t("Restore the folder and reload, or open another course from the course picker.", "\u6062\u590D\u76EE\u5F55\u540E\u70B9\u51FB\u91CD\u65B0\u52A0\u8F7D\uFF0C\u6216\u4ECE\u8BFE\u4EF6\u9009\u62E9\u5668\u6253\u5F00\u5176\u4ED6\u8BFE\u4EF6\u3002"));
      return;
    }
    this.course = course;
    this.refreshHeader();
    if (!this.guest) void this.loadCourse();
  }
  openFind() {
    this.findBar.hidden = false;
    this.findInput.focus();
    this.findInput.select();
  }
  closeFind() {
    this.findBar.hidden = true;
    this.guest?.stopFindInPage("clearSelection");
    this.findCount.textContent = "";
    this.guest?.focus();
  }
  find(forward, first = false) {
    const text = this.findInput.value.trim();
    if (!text || !this.guest) {
      this.guest?.stopFindInPage("clearSelection");
      this.findCount.textContent = "";
      return;
    }
    try {
      this.guest.findInPage(text, { forward, findNext: first });
    } catch {
      this.findCount.textContent = t("Page is loading", "\u9875\u9762\u52A0\u8F7D\u4E2D");
    }
  }
};
var CoursePicker = class extends import_obsidian.SuggestModal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.setPlaceholder(t("Search HTML courses by name, title or text\u2026", "\u641C\u7D22 HTML \u8BFE\u4EF6\uFF1A\u540D\u79F0\u3001\u6807\u9898\u6216\u6B63\u6587\u2026"));
    this.setInstructions([{ command: "\u2191 \u2193", purpose: t("Choose course", "\u9009\u62E9\u8BFE\u4EF6") }, { command: "\u21B5", purpose: t("Open", "\u6253\u5F00") }, { command: "esc", purpose: t("Close", "\u5173\u95ED") }]);
    this.emptyStateText = t("No matching courses. Folders containing index.html are detected automatically.", "\u6CA1\u6709\u5339\u914D\u7684\u8BFE\u4EF6\u3002\u542B index.html \u7684\u76EE\u5F55\u4F1A\u81EA\u52A8\u8BC6\u522B\u3002");
  }
  getSuggestions(query) {
    return searchCourses([...this.plugin.courses.values()], query).slice(0, 60);
  }
  renderSuggestion(result, el) {
    el.addClass("hc-course-suggestion");
    const title = el.createDiv({ cls: "hc-suggestion-title" });
    const icon = title.createSpan();
    (0, import_obsidian.setIcon)(icon, "file-code");
    title.createSpan({ text: result.course.title });
    el.createDiv({ cls: "hc-suggestion-path", text: result.course.root });
    if (result.snippet) el.createDiv({ cls: "hc-suggestion-snippet", text: result.snippet });
  }
  onChooseSuggestion(result, event) {
    void this.plugin.openCourse(result.course.root, event.metaKey || event.ctrlKey);
  }
};
var CoursebookSettings = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  getSettingDefinitions() {
    return [
      {
        name: t("Course folders", "\u8BFE\u4EF6\u76EE\u5F55"),
        desc: t("Folders containing index.html or index.htm appear as single documents. Right-click to temporarily show their contents.", "\u542B index.html \u6216 index.htm \u7684\u76EE\u5F55\u81EA\u52A8\u663E\u793A\u4E3A\u5355\u4E2A\u8BFE\u4EF6\u3002\u53F3\u952E\u8BFE\u4EF6\u53EF\u4E34\u65F6\u67E5\u770B\u5185\u90E8\u6587\u4EF6\u3002")
      },
      {
        name: t("Reload after changes", "\u4FEE\u6539\u540E\u81EA\u52A8\u5237\u65B0"),
        desc: t("Refresh open pages when course files change, preserving the reading position where possible.", "\u8BFE\u4EF6\u4E2D\u7684\u6587\u4EF6\u53D8\u5316\u65F6\u5237\u65B0\u5DF2\u6253\u5F00\u7684\u9875\u9762\uFF0C\u5E76\u5C3D\u91CF\u4FDD\u7559\u9605\u8BFB\u4F4D\u7F6E\u3002"),
        control: { type: "toggle", key: "autoReload", defaultValue: true }
      },
      {
        name: t("Ignored folders", "\u5FFD\u7565\u76EE\u5F55"),
        desc: t("One vault-relative path per line. These folders and their descendants remain ordinary folders.", "\u6BCF\u884C\u4E00\u4E2A\u4ED3\u5E93\u5185\u7684\u76F8\u5BF9\u8DEF\u5F84\u3002\u8FD9\u4E9B\u76EE\u5F55\u53CA\u5176\u5B50\u76EE\u5F55\u6309\u666E\u901A\u6587\u4EF6\u5939\u663E\u793A\u3002"),
        control: { type: "textarea", key: "ignoredFolders", rows: 5, placeholder: t("Projects\nArchive/Old courses", "\u5F00\u53D1\u9879\u76EE\n\u5F52\u6863/\u65E7\u8BFE\u4EF6") }
      },
      {
        name: t("Rescan courses", "\u91CD\u65B0\u8BC6\u522B\u8BFE\u4EF6"),
        desc: t(`${this.plugin.courses.size} courses found.`, `\u5F53\u524D\u8BC6\u522B\u5230 ${this.plugin.courses.size} \u4EFD\u8BFE\u4EF6\u3002`),
        render: (setting) => {
          setting.addButton((button) => button.setButtonText(t("Rescan", "\u91CD\u65B0\u626B\u63CF")).onClick(async () => {
            await this.plugin.refreshCourses();
            this.update();
          }));
        }
      }
    ];
  }
  getControlValue(key) {
    if (key === "autoReload") return this.plugin.settings.autoReload;
    if (key === "ignoredFolders") return this.plugin.settings.ignoredFolders.join("\n");
    return void 0;
  }
  async setControlValue(key, value) {
    if (key === "autoReload" && typeof value === "boolean") this.plugin.settings.autoReload = value;
    else if (key === "ignoredFolders" && typeof value === "string") {
      this.plugin.settings.ignoredFolders = value.split("\n").map(cleanPath).filter((p) => p !== null);
    } else return;
    await this.plugin.saveData(this.plugin.settings);
    if (key === "ignoredFolders") await this.plugin.refreshCourses();
  }
};
function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}
