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

A desktop app that lets you **edit Markdown in its finished, rendered form** instead of staring at raw syntax. There's no separate preview pane to jump back and forth to — what you write is the document. It also supports Mermaid diagrams, export to HTML and PDF, presenting your notes as slides, and working across multiple windows and tabs. An optional **Claude chat panel** answers questions about your document and proposes edits as reviewable diffs — using your Claude subscription, no API key.

## Why mdedit?

- **See it as you write it** — Edit directly with bold, headings, and lists already rendered (WYSIWYG). No round trips to a preview pane.
- **See the raw Markdown when you want** — Toggle between the rendered view and the raw Markdown source (with line numbers) with a single key (`Ctrl+Shift+I`).
- **Diagrams just work** — Mermaid you write in a code block becomes a live diagram in real time, and you can click to zoom. Diagram-only files (`.mmd` / `.mermaid`) open too.
- **Ask Claude about your document** — An optional chat panel talks to the [Claude Code CLI](https://claude.com/claude-code) with your existing subscription (no API key). Ask questions, get edits proposed as diffs you review and apply with one click, quote a selection from the right-click menu, and resume past conversations from the History menu.
- **Present without leaving the editor** — Turn the same document into 16:9 slides and present full-screen, with a thumbnail deck, a grid overview, and a laser pointer (`Ctrl+Shift+P`). Slides split at `---` or headings. The chat panel's **To slides** button (or the bundled [Claude Code skill](./skills/presentation-md)) turns your notes into presentation-ready Markdown.
- **Export what you see** — Export to HTML with the exact same look as the editor, and print to PDF.
- **Light and fast** — Built with Tauri, so the installer is small and startup is quick.
- **Bilingual** — Japanese and English UI, with switchable dark / light themes.

## Screenshots

| WYSIWYG editing | Claude chat | Presentation |
|---|---|---|
| ![Editing](./docs/assets/edit.png) | ![Claude chat](./docs/assets/chat.png) | ![Presentation](./docs/assets/presentation.png) |

| Mermaid preview | HTML export |
|---|---|
| ![Mermaid preview](./docs/assets/mermaid.png) | ![HTML export](./docs/assets/export.png) |

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

## Claude chat (optional)

mdedit can embed Claude as an editing assistant. It talks to the Claude Code CLI on your machine, so it runs on your existing Claude subscription — no API key to manage.

1. Install the [Claude Code CLI](https://claude.com/claude-code) and log in once (run `claude` in a terminal).
2. Turn on **Settings → "Use Claude chat"** — a chat button appears on the toolbar.
3. Open the panel and ask away. The open document (including unsaved edits) is the context.

What it can do:

- **Answer questions** about the document, streaming replies into the panel
- **Propose edits as a diff preview** — nothing changes until you click **Apply** (or open the result in a **new tab**); files on disk are never touched directly, and every apply is undoable
- **Work with selections** — select text and right-click → "Quote selection in chat", or just select and ask "rewrite this"
- **To slides** — one click converts the document into presentation-ready Markdown
- **History** — past conversations are archived and can be resumed later, context included
- **Web search** — on by default; turn it off in Settings when working with confidential documents

## Common shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+N` / `Ctrl+O` / `Ctrl+S` | New tab / Open / Save |
| `Ctrl+Shift+E` | Export as HTML |
| `Ctrl+Shift+V` | Open HTML preview tab |
| `Ctrl+Shift+P` | Open presentation view (`F` to present full-screen) |
| `Ctrl+Shift+I` | Toggle source (raw Markdown) view |
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
| AI assistant (optional) | Claude Code CLI (subscription auth) |

Design details, internals, directory layout, and the full shortcut list are documented in [docs/architecture.md](./docs/architecture.md).

## License

[MIT License](./LICENSE)
