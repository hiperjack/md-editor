**English** | [日本語](./README.ja.md)

# mdedit

**A lightweight, free, open-source WYSIWYG Markdown editor.**
Edit with formatting applied as you type, preview Mermaid diagrams inline, and export to HTML exactly as it looks on screen. A solid alternative if you're looking to replace the now-paid Typora.

![GitHub release](https://img.shields.io/github/v/release/hiperjack/md-editor)
![License](https://img.shields.io/github/license/hiperjack/md-editor)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)

<!-- Most important: a single GIF showing launch-to-edit (docs/assets/demo.gif) -->
![mdedit demo](./docs/assets/demo.gif)

## What is mdedit?

A desktop app that lets you **edit Markdown in its finished, rendered form** instead of staring at raw syntax. There's no separate preview pane to jump back and forth to — what you write is the document. It also supports Mermaid diagrams, export to HTML and PDF, and working across multiple windows and tabs.

## Why mdedit?

- **See it as you write it** — Edit directly with bold, headings, and lists already rendered (WYSIWYG). No round trips to a preview pane.
- **Diagrams just work** — Mermaid you write in a code block becomes a live diagram in real time, and you can click to zoom. Diagram-only files (`.mmd` / `.mermaid`) open too.
- **Export what you see** — Export to HTML with the exact same look as the editor, and print to PDF.
- **Light and fast** — Built with Tauri, so the installer is small and startup is quick.
- **Bilingual** — Japanese and English UI, with switchable dark / light themes.

## Screenshots

| WYSIWYG editing | Mermaid preview | HTML export |
|---|---|---|
| ![Editing](./docs/assets/edit.png) | ![Mermaid preview](./docs/assets/mermaid.png) | ![HTML export](./docs/assets/export.png) |

## Download

Get the latest version from [Releases](https://github.com/hiperjack/md-editor/releases).

| OS | Format |
|---|---|
| Windows | `.msi` or `.exe` (installer) |
| macOS | `.dmg` |
| Linux | `.AppImage` or `.deb` |

> **If Windows shows a warning:** the current build is not code-signed, so you may see "Windows protected your PC" on launch. Click **More info** → **Run anyway** to start it (a signing certificate is under consideration).

> **If macOS says the app "is damaged and can't be opened":** the build uses ad-hoc signing, so on first launch right-click the app in Finder and choose **Open**.

## Basic usage

- Double-click a `.md` / `.markdown` file to open it in a new tab in the editor.
- `.mmd` / `.mermaid` files open as a diagram and are saved back to their original source format.
- `.html` files open in a read-only preview tab.
- Tabs can be reordered by dragging, and dragging one out of the window creates a new window.

## Common shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+N` / `Ctrl+O` / `Ctrl+S` | New tab / Open / Save |
| `Ctrl+Shift+E` | Export as HTML |
| `Ctrl+Shift+V` | Open HTML preview tab |
| `Ctrl+P` | Print (PDF save available) |
| `Ctrl+F` / `Ctrl+H` | Find / Replace |
| `Ctrl+Shift+O` | Toggle heading outline |
| `Ctrl+B` / `Ctrl+I` / `Ctrl+K` | Bold / Italic / Link |
| `Ctrl+,` | Open settings |

See [docs/architecture.md](./docs/architecture.md) for the full list of shortcuts.

## Build from source

**Requirements:** Node.js 18 or later, and Rust (see the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)).

```bash
# Install dependencies
npm install

# Run in development mode
npm run tauri:dev

# Build installers
npm run tauri:build
```

## Tech stack

| Layer | Technology |
|---|---|
| Desktop framework | Tauri 2.x (Rust) |
| Frontend | Vite + TypeScript (no UI framework) |
| Editor | Milkdown Crepe (ProseMirror-based WYSIWYG) |
| Diagrams | Mermaid |

Design details, internals, directory layout, and the full shortcut list are documented in [docs/architecture.md](./docs/architecture.md) (written in Japanese).

## License

[MIT License](./LICENSE)
