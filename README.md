# HTML Coursebook

[English](README.md) · [简体中文](README.zh-CN.md)

**Turn a local HTML project folder into one interactive document in Obsidian.**

Generated lessons, reports and small interactive projects often arrive as `index.html` plus scripts, styles and assets. HTML Coursebook keeps those files together on disk while presenting their folder as one clickable document in the native Files pane.

```text
Your vault/
└── Motion lab/                ← one document in the Files pane
    ├── index.html             ← opens when you click Motion lab
    ├── styles.css
    ├── app.js
    └── assets/
```

No conversion, packing, local server or Web Viewer core plugin is required for self-contained HTML projects.

## Features

- Automatically recognize folders containing `index.html` or `index.htm`.
- Show one document row while hiding the supporting files; reveal them temporarily from the context menu.
- Run local JavaScript, styles, images, video, Canvas and interactive content in a separate browser renderer.
- Reuse the existing tab on repeated clicks; Cmd/Ctrl-click or middle-click opens another tab.
- Search names, titles and static entry-page text from the course picker.
- Find text in the current page with Cmd/Ctrl+F, including when the page has keyboard focus.
- Reload changed course resources and preserve the reading position where possible.
- Copy a deep link into your Markdown notes or open a course in your default browser.
- Follow Obsidian's language: Simplified Chinese for Chinese locales, English otherwise. HTML content is not translated.

## Install

The [community listing](https://community.obsidian.md/plugins/html-coursebook) is public. As of November 9, 2026, the plugin is still absent from the installation registry used by Obsidian 1.15.0, so searching the in-app community browser returns no result. Use manual installation below until the registry includes it. A public listing alone does not confirm in-app availability.

Manual installation:

Download `main.js`, `manifest.json` and `styles.css` from the [latest GitHub release](https://github.com/gyula-coder/obsidian-html-coursebook/releases/latest), or build them from source. Place the three files in:

```text
<vault>/.obsidian/plugins/html-coursebook/
```

Reload Obsidian and enable **HTML Coursebook** under **Settings → Community plugins**. You do not need to enable “Show all file types.”

Minimum Obsidian version: **1.15.0**. Desktop only. Manually tested on macOS; Windows and Linux have not yet been manually verified.

## Use

1. Place a self-contained HTML project in your vault. Keep its relative paths and supporting files intact.
2. Click the folder's document row to open its entry page.
3. Use the book icon in the ribbon or **HTML Coursebook: Open course / search text** to find a course.
4. Right-click the document row for links, browser opening and temporary source visibility.

In **Settings → HTML Coursebook**, toggle live refresh or exclude specific vault-relative folder paths. Each exclusion also covers its descendants.

`index.html` takes precedence over `index.htm`. An index inside an already recognized course stays part of that course. Hidden folders and `node_modules` do not become courses.

## Scope and alternatives

HTML Coursebook focuses on **automatic HTML-folder recognition, a single row in the native Files pane, and interactive reading**. The source files remain ordinary files. Native folder operations still act on the entire folder.

Related projects include [Local HTML View](https://github.com/atlas555/obsidian-local-html-view) for opening HTML files, [HTML Shelf](https://github.com/prof18/html-shelf) for a separate HTML library, [File Bundles](https://github.com/mnaoumov/obsidian-file-bundles) for declared file dependencies, and [NestNote](https://github.com/exbob/obsidian-nest-note) for Markdown document folders. This project does not claim to be the first HTML reader or document-bundle plugin.

## Disclosures and limits

- **Network:** the plugin itself makes no network requests. A page can make requests if its HTML, CSS or scripts reference remote services. It does not make online content available offline.
- **Local files:** course discovery and text indexing are scoped to the current vault. Pages use local `file://` URLs and can reference resources outside their own folder or outside the vault, subject to Chromium's normal file security. The plugin does not enforce a resource boundary around a course. The system-file-manager action reveals a course folder, and the browser action opens its entry file.
- **Scripts:** local course scripts execute. The guest has Node integration disabled, context isolation and Chromium sandboxing enabled, no custom preload, and no filesystem API bridge to the host. These measures are not an audit of the HTML itself; open only projects you trust.
- **Privacy:** no telemetry, ads, account requirement, payment or remote dependency for the plugin. The opened page's own behavior is separate.
- **Discovery and clipboard:** discovery enumerates file paths in the current vault to find course entries. The search index reads recognized entry HTML. The copy-link action writes the selected course link to the clipboard only when requested; the plugin never reads the clipboard.
- **Search:** the course picker indexes static text from entry HTML. Content created later by JavaScript is not in that index. Use page search for rendered text. Obsidian's native search, graph and backlinks keep their existing indexing behavior.
- **Live refresh:** reloading resets in-page application state. Turn it off when working with a prototype that holds unsaved data.
- **Compatibility:** the native Files-pane presentation uses a small guarded integration with Obsidian's internal folder items and DOM. Future app changes or replacement file-tree plugins may require adaptation.

## Development

Node.js **24 or later** is required for development and the native TypeScript tests.

```sh
npm ci
npm run validate
```

Validation runs the official Obsidian ESLint rules, type checking, domain tests, a production build and release-metadata checks. The runtime has no bundled npm dependencies; Obsidian and Electron APIs are supplied by the desktop app.

`src/core.ts` contains discovery, path and search logic. `src/main.ts` contains the Files-pane adapter, settings and reader. Source files are not rewritten during reading. The public demo under `demo/` contains only synthetic content.

The GitHub Actions configuration checks the build on Linux, macOS and Windows. All three CI platforms have passed validation; this checks the build and tests, not the desktop UI on those systems. An exact semantic version tag such as `0.1.2` triggers release creation with the three installation assets. See [publishing notes](docs/PUBLISHING.md).

## License

[MIT](LICENSE). This is an independent community plugin and is not an official Obsidian product.
