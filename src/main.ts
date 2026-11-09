import {
  App, FileSystemAdapter, ItemView, Notice, Plugin, PluginSettingTab,
  SuggestModal, TAbstractFile, TFile, TFolder, WorkspaceLeaf,
  getLanguage, setIcon, type SettingDefinitionItem, type ViewStateResult,
} from "obsidian";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { cleanPath, discoverBundles, externalUrl, findBundle, isRecord, movePath, searchCourses, type Bundle, type Course } from "./core";

const VIEW_TYPE = "html-coursebook-reader";
interface Settings { autoReload: boolean; ignoredFolders: string[] }
const DEFAULT_SETTINGS: Settings = { autoReload: true, ignoredFolders: [] };
const t = (english: string, chinese: string): string => getLanguage().startsWith("zh") ? chinese : english;

interface ExplorerItem {
  el: HTMLElement;
  selfEl: HTMLElement;
  collapsed: boolean;
  setCollapsed(collapsed: boolean): void;
}
interface ExplorerView {
  containerEl: HTMLElement;
  fileItems?: Record<string, ExplorerItem>;
}
interface Decoration {
  root: string;
  wrapper: HTMLElement;
  attributes: Record<string, string | null>;
  item?: ExplorerItem;
  wasCollapsed?: boolean;
}
interface Guest extends HTMLElement {
  executeJavaScript(code: string): Promise<unknown>;
  reload(): void;
  getURL(): string;
  findInPage(text: string, options?: { forward?: boolean; findNext?: boolean }): number;
  stopFindInPage(action: string): void;
}
type ElectronShell = { openExternal(url: string): Promise<void>; showItemInFolder(path: string): void };
const { shell } = require("electron") as { shell: ElectronShell };

export default class HtmlCoursebookPlugin extends Plugin {
  settings: Settings = { ...DEFAULT_SETTINGS };
  courses = new Map<string, Course>();
  revealed = new Set<string>();
  private observers = new Map<HTMLElement, MutationObserver>();
  private decorations = new Map<HTMLElement, Decoration>();
  private scanVersion = 0;
  private scanTimer = 0;
  private decorateTimer = 0;
  private stopped = false;

  async onload(): Promise<void> {
    const raw: unknown = await this.loadData();
    const saved = isRecord(raw) ? raw : {};
    this.settings = {
      autoReload: typeof saved?.autoReload === "boolean" ? saved.autoReload : true,
      ignoredFolders: Array.isArray(saved?.ignoredFolders)
        ? saved.ignoredFolders.filter((p: unknown): p is string => typeof p === "string" && cleanPath(p) !== null)
        : [],
    };
    this.registerView(VIEW_TYPE, (leaf) => new CoursebookView(leaf, this));
    this.addSettingTab(new CoursebookSettings(this.app, this));
    this.addRibbonIcon("book-open", t("Open HTML course", "打开 HTML 课件"), () => this.openPicker());
    this.addCommand({ id: "open-course", name: t("Open course / search text", "打开课件 / 搜索正文"), callback: () => this.openPicker() });
    this.addCommand({ id: "rescan", name: t("Rescan course folders", "重新识别课件目录"), callback: async () => {
      await this.refreshCourses();
      new Notice(t(`Found ${this.courses.size} HTML courses.`, `已识别 ${this.courses.size} 份 HTML 课件`));
    } });
    this.addCommand({ id: "reload-course", name: t("Reload current course", "刷新当前课件"), checkCallback: (checking) => {
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
      if (!course || (file instanceof TFolder && file.path !== course.root)) return;
      menu.addSeparator();
      menu.addItem((item) => item.setTitle(t("Open HTML course", "打开 HTML 课件")).setIcon("book-open")
        .onClick(() => { void this.openCourse(course.root); }));
      menu.addItem((item) => item.setTitle(t("Open course in default browser", "在默认浏览器中打开课件")).setIcon("external-link")
        .onClick(() => { void this.openExternal(course); }));
      menu.addItem((item) => item.setTitle(t("Copy course link", "复制课件链接")).setIcon("link")
        .onClick(() => { void this.copyCourseLink(course); }));
      if (file instanceof TFolder) {
        const revealed = this.revealed.has(course.root);
        menu.addItem((item) => item.setTitle(revealed ? t("Show course as one document", "将课件显示为单个文档") : t("Temporarily show course contents", "临时显示课件内部文件"))
          .setIcon(revealed ? "file-code" : "folder-open").onClick(() => {
            if (revealed) this.revealed.delete(course.root); else this.revealed.add(course.root);
            this.decorateExplorers();
          }));
      }
    }));
    this.registerEvent(this.app.workspace.on("layout-change", () => { this.watchExplorers(); this.queueDecorate(); }));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.queueDecorate()));
    this.registerEvent(this.app.vault.on("create", (file) => { this.queueScan(); this.reloadAffected(file); }));
    this.registerEvent(this.app.vault.on("delete", (file) => { this.queueScan(); this.reloadAffected(file); }));
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

  onunload(): void {
    this.stopped = true;
    this.scanVersion++;
    window.clearTimeout(this.scanTimer);
    window.clearTimeout(this.decorateTimer);
    for (const observer of this.observers.values()) observer.disconnect();
    this.observers.clear();
    for (const row of [...this.decorations.keys()]) this.restoreRow(row);
  }

  private readerViews(): CoursebookView[] {
    return this.app.workspace.getLeavesOfType(VIEW_TYPE).map((leaf) => leaf.view)
      .filter((view): view is CoursebookView => view instanceof CoursebookView);
  }

  private reloadAffected(file: TAbstractFile): void {
    if (!this.settings.autoReload) return;
    const course = findBundle(file.path, this.courses.values());
    if (!course) return;
    for (const view of this.readerViews()) if (view.root === course.root) view.queueReload();
  }

  private queueScan(): void {
    window.clearTimeout(this.scanTimer);
    this.scanTimer = window.setTimeout(() => { void this.refreshCourses(); }, 180);
  }

  async refreshCourses(): Promise<void> {
    const version = ++this.scanVersion;
    const bundles = discoverBundles(this.app.vault.getFiles().map((file) => file.path), this.settings.ignoredFolders);
    const courses: Course[] = [];
    // Limit concurrent reads so a large imported course collection does not flood iCloud.
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

  private async readCourse(bundle: Bundle): Promise<Course> {
    const file = this.app.vault.getAbstractFileByPath(bundle.entry);
    const mtime = file instanceof TFile ? file.stat.mtime : 0;
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

  async resolveCourse(root: string): Promise<Course | undefined> {
    if (this.courses.has(root)) return this.courses.get(root);
    const valid = cleanPath(root);
    if (!valid) return;
    const folder = this.app.vault.getAbstractFileByPath(valid);
    if (!(folder instanceof TFolder)) return;
    const bundle = discoverBundles(folder.children.filter((f): f is TFile => f instanceof TFile).map((f) => f.path), this.settings.ignoredFolders)
      .find((b) => b.root === valid);
    return bundle ? this.readCourse(bundle) : undefined;
  }

  async openCourse(root: string, newTab = false): Promise<void> {
    const course = await this.resolveCourse(root);
    if (!course) { new Notice(t("No entry page found. Check that the folder contains index.html or index.htm.", "未找到课件入口，请确认目录内有 index.html 或 index.htm。")); return; }
    if (!newTab) {
      const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE).find((leaf) => (leaf.view as CoursebookView).root === root);
      if (existing) { await this.app.workspace.revealLeaf(existing); return; }
    }
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE, state: { root: course.root }, active: true });
    await this.app.workspace.revealLeaf(leaf);
    this.queueDecorate();
  }

  fileUrl(entry: string): string {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) throw new Error(t("HTML Coursebook requires a local desktop vault.", "HTML Coursebook 需要桌面端本地仓库。"));
    return pathToFileURL(join(adapter.getBasePath(), entry)).href;
  }

  async openExternal(course: Bundle): Promise<void> {
    await shell.openExternal(this.fileUrl(course.entry));
  }

  revealInFinder(course: Bundle): void {
    const adapter = this.app.vault.adapter;
    if (adapter instanceof FileSystemAdapter) shell.showItemInFolder(join(adapter.getBasePath(), course.root));
  }

  async copyCourseLink(course: Bundle): Promise<void> {
    const params = new URLSearchParams({ vault: this.app.vault.getName(), path: course.root });
    await navigator.clipboard.writeText(`obsidian://html-coursebook?${params}`);
    new Notice(t("Course link copied. Paste it into a note.", "已复制课件链接，可粘贴到笔记中。"));
  }

  private openPicker(): void { new CoursePicker(this.app, this).open(); }

  private watchExplorers(): void {
    if (this.stopped) return;
    const views = this.app.workspace.getLeavesOfType("file-explorer").map((leaf) => leaf.view as unknown as ExplorerView);
    const live = new Set(views.map((view) => view.containerEl));
    for (const [container, observer] of this.observers) {
      if (!live.has(container)) { observer.disconnect(); this.observers.delete(container); }
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
        if (this.courseRow(event.target)) { event.preventDefault(); event.stopImmediatePropagation(); }
      }, true);
      this.registerDomEvent(container, "keydown", (event) => {
        if (!["Enter", " ", "ArrowRight"].includes(event.key)) return;
        const row = this.courseRow(event.target);
        if (!row) return;
        event.preventDefault(); event.stopImmediatePropagation();
        void this.openCourse(row.dataset.path!, event.metaKey || event.ctrlKey);
      }, true);
    }
  }

  private courseRow(target: EventTarget | null): HTMLElement | null {
    const row = (target as Element | null)?.closest?.<HTMLElement>(".nav-folder-title[data-path]");
    const root = row?.dataset.path;
    return row && root && this.courses.has(root) && !this.revealed.has(root) ? row : null;
  }

  private onExplorerClick(event: MouseEvent): void {
    if (event.type === "auxclick" && event.button !== 1) return;
    if (event.type === "click" && event.button !== 0) return;
    const row = this.courseRow(event.target);
    if (!row) return;
    event.preventDefault(); event.stopImmediatePropagation();
    row.focus({ preventScroll: true });
    void this.openCourse(row.dataset.path!, event.metaKey || event.ctrlKey || event.button === 1);
  }

  private queueDecorate(): void {
    if (this.stopped || this.decorateTimer) return;
    this.decorateTimer = window.setTimeout(() => {
      this.decorateTimer = 0;
      if (!this.stopped) this.decorateExplorers();
    }, 40);
  }

  private decorateExplorers(): void {
    const active = this.app.workspace.getActiveViewOfType(CoursebookView)?.root;
    for (const [row, decoration] of [...this.decorations]) {
      if (!row.isConnected || row.dataset.path !== decoration.root || !this.courses.has(decoration.root) || this.revealed.has(decoration.root)) this.restoreRow(row);
    }
    for (const leaf of this.app.workspace.getLeavesOfType("file-explorer")) {
      const view = leaf.view as unknown as ExplorerView;
      for (const row of view.containerEl.querySelectorAll<HTMLElement>(".nav-folder-title[data-path]")) {
        const root = row.dataset.path!;
        const course = this.courses.get(root);
        if (!course || this.revealed.has(root)) continue;
        const wrapper = row.parentElement;
        if (!wrapper?.classList.contains("nav-folder")) continue;
        if (!this.decorations.has(row)) {
          const item = view.fileItems?.[root];
          const attributes: Record<string, string | null> = {};
          for (const name of ["title", "tabindex", "role", "aria-label"]) attributes[name] = row.getAttribute(name);
          this.decorations.set(row, { root, wrapper, attributes, item, wasCollapsed: item?.collapsed });
          wrapper.classList.add("hc-document-bundle");
          row.classList.add("hc-document-row");
          row.setAttribute("tabindex", "0");
          row.setAttribute("role", "button");
          const icon = row.ownerDocument.createElement("span");
          icon.className = "hc-document-icon";
          icon.setAttribute("aria-hidden", "true");
          setIcon(icon, "file-code");
          row.insertBefore(icon, row.querySelector(".nav-folder-title-content"));
        }
        const item = view.fileItems?.[root];
        if (item && !item.collapsed) item.setCollapsed(true);
        row.title = `${course.title}\n${t("HTML course · Click to open · Right-click to manage", "HTML 课件 · 点击打开 · 右键管理")}`;
        row.setAttribute("aria-label", `${course.name}, ${t("HTML course", "HTML 课件")}, ${course.title}`);
        row.classList.toggle("hc-is-active", active === root);
      }
    }
  }

  private restoreRow(row: HTMLElement): void {
    const decoration = this.decorations.get(row);
    if (!decoration) return;
    this.decorations.delete(row);
    decoration.wrapper.classList.remove("hc-document-bundle");
    row.classList.remove("hc-document-row", "hc-is-active");
    row.querySelector(".hc-document-icon")?.remove();
    for (const [name, value] of Object.entries(decoration.attributes)) {
      if (value === null) row.removeAttribute(name); else row.setAttribute(name, value);
    }
    if (row.isConnected && decoration.item && decoration.wasCollapsed === false) decoration.item.setCollapsed(false);
  }
}

class CoursebookView extends ItemView {
  navigation = true;
  root = "";
  private course?: Course;
  private guest?: Guest;
  private frame!: HTMLElement;
  private findBar!: HTMLElement;
  private findInput!: HTMLInputElement;
  private findCount!: HTMLElement;
  private reloadTimer = 0;
  private findTimer = 0;
  private loadVersion = 0;
  private messagePrefix = "HC_" + crypto.randomUUID() + ":";
  private pendingScroll?: { x: number; y: number };

  constructor(leaf: WorkspaceLeaf, private plugin: HtmlCoursebookPlugin) { super(leaf); }
  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return this.course?.title || this.root.split("/").pop() || t("HTML course", "HTML 课件"); }
  getIcon(): string { return "file-code"; }
  getState(): Record<string, unknown> { return { root: this.root }; }

  async setState(state: { root?: string }, result: ViewStateResult): Promise<void> {
    this.root = cleanPath(state.root ?? "") ?? "";
    await this.loadCourse();
    await super.setState(state, result);
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("hc-reader");
    this.findBar = this.contentEl.createDiv({ cls: "hc-find-bar" });
    this.findBar.hidden = true;
    this.findInput = this.findBar.createEl("input", { type: "search", placeholder: t("Find text in this course…", "搜索课件正文…") });
    this.findInput.setAttribute("aria-label", t("Find course text", "搜索课件正文"));
    this.findCount = this.findBar.createSpan({ cls: "hc-find-count" });
    const button = (icon: string, label: string, action: () => void) => {
      const el = this.findBar.createEl("button", { cls: "hc-icon-button", attr: { "aria-label": label, title: label } });
      setIcon(el, icon); this.registerDomEvent(el, "click", action);
    };
    button("chevron-up", t("Previous match", "上一个结果"), () => this.find(false));
    button("chevron-down", t("Next match", "下一个结果"), () => this.find(true));
    button("x", t("Close search", "关闭搜索"), () => this.closeFind());
    this.registerDomEvent(this.findInput, "input", () => {
      window.clearTimeout(this.findTimer);
      this.findTimer = window.setTimeout(() => this.find(true, true), 120);
    });
    this.registerDomEvent(this.findInput, "keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); this.closeFind(); }
      if (event.key === "Enter") { event.preventDefault(); this.find(!event.shiftKey); }
    });
    this.frame = this.contentEl.createDiv({ cls: "hc-reader-frame" });
    this.addAction("search", t("Find text (Ctrl/Cmd+F)", "搜索正文 (Ctrl/Cmd+F)"), () => this.openFind());
    this.addAction("refresh-cw", t("Reload course", "重新加载课件"), () => { void this.reloadPage(); });
    this.addAction("link", t("Copy course link", "复制课件链接"), () => { if (this.course) void this.plugin.copyCourseLink(this.course); });
    this.addAction("external-link", t("Open in default browser", "在默认浏览器中打开"), () => { if (this.course) void this.plugin.openExternal(this.course); });
    this.addAction("folder-open", t("Show course in system file manager", "在系统文件管理器中显示课件"), () => { if (this.course) this.plugin.revealInFinder(this.course); });
    this.registerDomEvent(this.containerEl, "keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault(); event.stopPropagation(); this.openFind();
      }
    });
  }

  async onClose(): Promise<void> {
    this.loadVersion++;
    window.clearTimeout(this.reloadTimer);
    window.clearTimeout(this.findTimer);
    this.guest?.remove();
    this.guest = undefined;
    this.contentEl.empty();
  }

  private async loadCourse(): Promise<void> {
    const version = ++this.loadVersion;
    this.course = await this.plugin.resolveCourse(this.root);
    if (version !== this.loadVersion) return;
    this.frame.empty();
    this.guest = undefined;
    if (!this.course) {
      this.showMessage(t("Course entry not found", "找不到课件入口"), t("Check that the course folder is still in the vault and contains index.html or index.htm.", "请确认课件目录仍在仓库中，并包含 index.html 或 index.htm。"));
      return;
    }
    this.refreshHeader();
    this.pendingScroll = undefined;
    const loading = this.frame.createDiv({ cls: "hc-loading", text: t("Opening course…", "正在打开课件…") });
    const guest = this.frame.ownerDocument.createElement("webview") as Guest;
    guest.className = "hc-webview";
    guest.setAttribute("aria-label", this.course.title);
    // A separate renderer without Node or preload access; never disable web security.
    guest.setAttribute("webpreferences", "contextIsolation=yes,sandbox=yes,nodeIntegration=no,webSecurity=yes,allowRunningInsecureContent=no");
    guest.setAttribute("partition", `persist:html-coursebook-${hashString(this.root)}`);
    guest.addEventListener("dom-ready", () => {
      loading.remove();
      void this.prepareGuest(guest);
    });
    guest.addEventListener("did-fail-load", (event: Event) => {
      const failure = event as Event & { errorCode: number; errorDescription: string; isMainFrame: boolean };
      if (!failure.isMainFrame || failure.errorCode === -3) return;
      loading.remove();
      guest.remove();
      if (this.guest === guest) this.guest = undefined;
      this.showMessage(t("Could not open course", "课件未能打开"), t(`${failure.errorDescription}. Reload the page or use the toolbar to open it in your browser.`, `${failure.errorDescription}。可用右上角按钮在默认浏览器中打开，或重新加载。`));
    });
    guest.addEventListener("console-message", (event: Event) => {
      const message = (event as Event & { message: string }).message;
      if (typeof message !== "string" || !message.startsWith(this.messagePrefix)) return;
      try {
        const data: unknown = JSON.parse(message.slice(this.messagePrefix.length));
        if (!isRecord(data)) return;
        if (data.type === "find") this.openFind();
        if (data.type === "external" && typeof data.url === "string") {
          const url = externalUrl(data.url);
          if (url) void shell.openExternal(url);
        }
      } catch { /* Ignore unrelated course console output. */ }
    });
    guest.addEventListener("found-in-page", (event: Event) => {
      const { matches, activeMatchOrdinal } = (event as Event & { result: { matches: number; activeMatchOrdinal: number } }).result;
      this.findCount.textContent = matches ? `${activeMatchOrdinal} / ${matches}` : t("No matches", "无匹配");
    });
    this.guest = guest;
    guest.setAttribute("src", this.plugin.fileUrl(this.course.entry));
    this.frame.appendChild(guest);
  }

  private showMessage(title: string, description: string): void {
    this.frame.querySelector(".hc-message")?.remove();
    const message = this.frame.createDiv({ cls: "hc-message" });
    const icon = message.createDiv({ cls: "hc-message-icon" }); setIcon(icon, "file-code");
    message.createEl("h3", { text: title });
    message.createEl("p", { text: description });
  }

  private refreshHeader(): void {
    // Obsidian has no public title-change hook. Guard this small compatibility bridge.
    (this.leaf as WorkspaceLeaf & { updateHeader?: () => void }).updateHeader?.();
    const title = this.containerEl.querySelector<HTMLElement>(".view-header-title");
    if (title) title.textContent = this.getDisplayText();
  }

  private async prepareGuest(guest: Guest): Promise<void> {
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
        const scroll = this.pendingScroll; this.pendingScroll = undefined;
        await guest.executeJavaScript(`window.scrollTo({left:${Number(scroll.x) || 0},top:${Number(scroll.y) || 0},behavior:'instant'})`);
      }
      if (!this.findBar.hidden && this.findInput.value) this.find(true, true);
    } catch (error) {
      if (guest.isConnected) console.warn("HTML Coursebook: reader helpers unavailable", error);
    }
  }

  queueReload(): void {
    window.clearTimeout(this.reloadTimer);
    this.reloadTimer = window.setTimeout(() => { void this.reloadPage(); }, 600);
  }

  async reloadPage(): Promise<void> {
    const guest = this.guest;
    if (!guest) { await this.loadCourse(); return; }
    try {
      this.pendingScroll = await guest.executeJavaScript("(() => { history.scrollRestoration = 'manual'; return {x:window.scrollX,y:window.scrollY}; })()") as { x: number; y: number };
      guest.reload();
    } catch { await this.loadCourse(); }
  }

  renameRoot(oldPath: string, newPath: string): void {
    const moved = movePath(this.root, oldPath, newPath);
    if (moved !== this.root) {
      this.root = moved;
      void this.loadCourse();
      this.app.workspace.requestSaveLayout();
    }
  }

  onCoursesChanged(): void {
    if (!this.frame) return;
    const course = this.plugin.courses.get(this.root);
    if (!course) {
      this.loadVersion++;
      this.guest?.remove(); this.guest = undefined;
      this.frame.empty();
      this.showMessage(t("Course folder was removed or ignored", "课件目录已移除或被忽略"), t("Restore the folder and reload, or open another course from the course picker.", "恢复目录后点击重新加载，或从课件选择器打开其他课件。"));
      return;
    }
    this.course = course;
    this.refreshHeader();
    if (!this.guest) void this.loadCourse();
  }

  private openFind(): void {
    this.findBar.hidden = false;
    this.findInput.focus(); this.findInput.select();
  }
  private closeFind(): void {
    this.findBar.hidden = true;
    this.guest?.stopFindInPage("clearSelection");
    this.findCount.textContent = "";
    this.guest?.focus();
  }
  private find(forward: boolean, first = false): void {
    const text = this.findInput.value.trim();
    if (!text || !this.guest) {
      this.guest?.stopFindInPage("clearSelection");
      this.findCount.textContent = ""; return;
    }
    try { this.guest.findInPage(text, { forward, findNext: first }); }
    catch { this.findCount.textContent = t("Page is loading", "页面加载中"); }
  }
}

class CoursePicker extends SuggestModal<{ course: Course; snippet: string }> {
  constructor(app: App, private plugin: HtmlCoursebookPlugin) {
    super(app);
    this.setPlaceholder(t("Search HTML courses by name, title or text…", "搜索 HTML 课件：名称、标题或正文…"));
    this.setInstructions([{ command: "↑ ↓", purpose: t("Choose course", "选择课件") }, { command: "↵", purpose: t("Open", "打开") }, { command: "esc", purpose: t("Close", "关闭") }]);
    this.emptyStateText = t("No matching courses. Folders containing index.html are detected automatically.", "没有匹配的课件。含 index.html 的目录会自动识别。");
  }
  getSuggestions(query: string): { course: Course; snippet: string }[] {
    return searchCourses([...this.plugin.courses.values()], query).slice(0, 60);
  }
  renderSuggestion(result: { course: Course; snippet: string }, el: HTMLElement): void {
    el.addClass("hc-course-suggestion");
    const title = el.createDiv({ cls: "hc-suggestion-title" });
    const icon = title.createSpan(); setIcon(icon, "file-code");
    title.createSpan({ text: result.course.title });
    el.createDiv({ cls: "hc-suggestion-path", text: result.course.root });
    if (result.snippet) el.createDiv({ cls: "hc-suggestion-snippet", text: result.snippet });
  }
  onChooseSuggestion(result: { course: Course }, event: MouseEvent | KeyboardEvent): void {
    void this.plugin.openCourse(result.course.root, event.metaKey || event.ctrlKey);
  }
}

class CoursebookSettings extends PluginSettingTab {
  constructor(app: App, private plugin: HtmlCoursebookPlugin) { super(app, plugin); }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: t("Course folders", "课件目录"),
        desc: t("Folders containing index.html or index.htm appear as single documents. Right-click to temporarily show their contents.", "含 index.html 或 index.htm 的目录自动显示为单个课件。右键课件可临时查看内部文件。"),
      },
      {
        name: t("Reload after changes", "修改后自动刷新"),
        desc: t("Refresh open pages when course files change, preserving the reading position where possible.", "课件中的文件变化时刷新已打开的页面，并尽量保留阅读位置。"),
        control: { type: "toggle", key: "autoReload", defaultValue: true },
      },
      {
        name: t("Ignored folders", "忽略目录"),
        desc: t("One vault-relative path per line. These folders and their descendants remain ordinary folders.", "每行一个仓库内的相对路径。这些目录及其子目录按普通文件夹显示。"),
        control: { type: "textarea", key: "ignoredFolders", rows: 5, placeholder: t("Projects\nArchive/Old courses", "开发项目\n归档/旧课件") },
      },
      {
        name: t("Rescan courses", "重新识别课件"),
        desc: t(`${this.plugin.courses.size} courses found.`, `当前识别到 ${this.plugin.courses.size} 份课件。`),
        render: (setting) => {
          setting.addButton((button) => button.setButtonText(t("Rescan", "重新扫描")).onClick(async () => {
            await this.plugin.refreshCourses(); this.update();
          }));
        },
      },
    ];
  }

  getControlValue(key: string): unknown {
    if (key === "autoReload") return this.plugin.settings.autoReload;
    if (key === "ignoredFolders") return this.plugin.settings.ignoredFolders.join("\n");
    return undefined;
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    if (key === "autoReload" && typeof value === "boolean") this.plugin.settings.autoReload = value;
    else if (key === "ignoredFolders" && typeof value === "string") {
      this.plugin.settings.ignoredFolders = value.split("\n").map(cleanPath).filter((p): p is string => p !== null);
    } else return;
    await this.plugin.saveData(this.plugin.settings);
    if (key === "ignoredFolders") await this.plugin.refreshCourses();
  }
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}
