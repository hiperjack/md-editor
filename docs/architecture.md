**English** | [日本語](./architecture.ja.md)

# mdedit Architecture & Design Notes

This document collects the technical details of mdedit: an exhaustive feature description, the tech stack, the full list of keyboard shortcuts, the directory layout, and design notes on the internals. For a user-facing overview, see [README.md](../README.md).

mdedit is a multi-window, multi-tab desktop Markdown editor built with Tauri 2.x + Vite + TypeScript. It edits Markdown (`.md` / `.markdown`) and standalone Mermaid files (`.mmd` / `.mermaid`), and supports HTML export and printing (to PDF). Double-clicking a `.md` / `.mmd` file opens it in a new tab in the existing window. `.html` / `.htm` files (including via drag-and-drop or dropping onto the app icon) open in a read-only preview tab backed by a sandboxed iframe.

The menu bar is drawn in HTML rather than natively, so it supports mnemonic keyboard operation such as `Alt+F`→`N` (new tab).

## Features in detail

- **WYSIWYG editing**: Uses [Milkdown Crepe](https://milkdown.dev/). You edit with formatting already applied — no separate preview pane needed.
- **Mermaid support**:
  - ` ```mermaid ` code blocks are previewed as live diagrams inline within the editor
  - Standalone `.mmd` / `.mermaid` files open as "Markdown with the whole file wrapped in a single mermaid fence", and on save the fence is stripped to restore the raw source
  - Clicking a diagram opens a zoom viewer with wheel-zoom, pan (hand), and a text-selection mode toggle
  - The inline preview width can be set to "fit editor width (shrink)" or "natural size (horizontal scroll on overflow)" (Settings → View → Mermaid)
  - Colors follow the display theme (dark/light); on HTML export they follow the document background. There is also a setting to hide Mermaid code blocks by default
- **Menu bar (HTML-based, Alt operation)**: File / Edit / Format / View / Help. Press `Alt+<letter>` to open a menu, then a item's mnemonic letter to run it (e.g. `Alt+F`→`N` for new tab). While open, ↑↓ move between items, ←→ switch menus, `Enter` runs, `Esc` closes. Mouse operation (click to open/close, hover to switch) is also supported. Each item also shows its shortcut.
- **HTML preview tab**:
  - Right-click a tab or press `Ctrl+Shift+V` to show, in a read-only tab, the result of the exact same pipeline used for HTML export (guaranteeing "what you see is what gets exported")
  - `.html` / `.htm` files are shown in a read-only tab inside a sandboxed iframe (scripts disabled, styles isolated)
  - While viewing an HTML export preview (derived from Markdown), pressing "Export as HTML" saves a self-contained HTML file from the original source
  - Independent `Ctrl+wheel` zoom (separate from the editor); the document is shown full-width
  - Mermaid diagrams inside the preview tab can also be clicked to open the zoom viewer
  - Supports detaching to / merging into another window
- **Heading folding**: Hovering a heading shows a triangle icon on its left; clicking folds/unfolds the blocks beneath it (display only while editing — it does not affect the saved content). It is two-way linked with the left outline panel, so folding in either place stays consistent.
- **HTML export / printing**: `Ctrl+Shift+E` exports HTML with the document theme applied. `Ctrl+P` prints the body only (the dialog can save to PDF). An `.mmd` tab becomes a standalone HTML file with the single diagram centered.
- **Presentation view (slideshow)**: `Ctrl+Shift+P` (or right-click a tab → "Open presentation view", or the toolbar button) opens a read-only presentation tab built from the *same* render pipeline as HTML export, so slides look identical to the document. The document is split into 16:9 slides at `<hr>` (`---`) boundaries, or — when there are no horizontal rules — at H1/H2 headings. Each slide is laid out in three fixed zones: title (the leading heading), message (the first paragraph after it), and body (everything else, auto-zoomed to fit with in-zone scrolling below a minimum scale). Three views share one canvas renderer: a **deck** (thumbnail sidebar + main slide), a **grid** overview, and a **full-screen** present mode. A laser pointer (`L`) and "present from this slide" are available. The HTML-preview zoom level is inherited when the view opens.
- **Document theme**: Font, line height, heading styles, colors, etc. can be adjusted in settings and are reflected in preview / export / print. The settings dialog is organized into tabs (General / Mermaid / HTML preview, etc.).
- **Multi-window**: Drag a tab out of the window to create a new window (detach); drag it onto another window's tab bar to merge. If the source had only one tab, the source window closes. Opening the same file in multiple windows is detected and shown via a popup.
- **Find & replace**: `Ctrl+F` opens the search bar, `Ctrl+H` expands the replace field. Supports case sensitivity, regular expressions (capture-reference replacement like `$1`), whole-word matching, and replace-all. It operates on the ProseMirror document, so undo works.
- **Heading outline**: A heading-list panel on the left (toggle with `Ctrl+Shift+O` or the leftmost toolbar button; visibility is persisted). Clicking an item jumps to that heading (aligned to the top of the editor); the current heading is highlighted as you scroll. The panel width is adjustable by dragging the divider (persisted), items with child headings get an expand/collapse toggle (▸/▾), and it is two-way linked with the heading folding in the editor body. The outline also works in HTML preview tabs.
- **Single instance**: Double-click a `.md` / `.mmd` → it opens in a new tab in the existing window.
- **Tab operations**: Reorder by dragging, detach by dragging out of the window, merge into another window, close with middle-click, horizontal scroll when the tab strip gets long. Right-clicking a tab opens a dedicated menu (Close / Close others / Close to the right / HTML preview / Open in new window / Copy path).
- **Recent files**: The File menu lists recently opened files (on/off in settings). If a file from history or a file-association launch can't be found, an error is reported.
- **Unsaved-change detection**: Compares against a baseline of the "post-Milkdown-normalization string", avoiding false positives caused by WYSIWYG auto-normalization.
- **GFM support**: Tables, task lists, strikethrough, GitHub alerts, table of contents (`[[toc]]`), heading anchors (CommonMark + GFM preset).
- **Internationalization**: Switch between Japanese / English / follow-system language (the menu bar, settings UI, and confirmation dialogs all switch together).
- **Themes**: Dark / light / follow-system. Also tracks dynamic changes to `prefers-color-scheme`.
- **Context menu**: A custom right-click menu on the editor (cut/copy/paste/select-all; bold/italic/link when text is selected; image editing over an image; find). Outside the editor, the default menu is suppressed.
- **Flexible image handling**:
  - Displays images by path relative to the md file (via the Tauri asset protocol)
  - Auto-resolves the conventional path `<mdDir>/img/<basename>/<file>` (falling back to a file next to the md)
  - Double-click an image to edit URL → alt text → width (px) (the original size is hinted in the prompt)
  - `Alt+wheel` over an image resizes its pixel width in place (the size is preserved across save/reload)
  - On HTML export, local images are embedded as data URIs
- **Editing key behavior**:
  - `Enter` makes a new paragraph; `Shift+Enter` inserts a soft line break within a paragraph (same as common editors)
  - On load, single line breaks in the source are shown as line breaks (`remark-breaks`, for compatibility with files made in Obsidian, etc.)
  - `Backspace` at the start of a blockquote → un-quote
  - `Backspace` at the start of a list item → merge with the previous line rather than removing the list (standard behavior)
- **Font settings**: Specify body and code fonts separately. Code text color can also be set (defaults to following the body color).
- **Drag & drop**: Drop `.md` / `.markdown` / `.mmd` / `.mermaid` / `.html` / `.htm` files directly onto the window (dropping onto the app icon and file-association launch are also supported; `.html` opens in a preview tab).
- **Line-number overlay**: Line numbers are overlaid on the WYSIWYG pane.
- **Settings preview**: A "Preview" button in the settings dialog lets you try the look before applying (Cancel reverts).

## Tech stack

| Layer | Choice |
|---|---|
| Desktop framework | Tauri 2.x (Rust) |
| Frontend build | Vite + TypeScript |
| Editor | [@milkdown/crepe](https://www.npmjs.com/package/@milkdown/crepe) (ProseMirror-based WYSIWYG) |
| Markdown extensions (editing) | `@milkdown/kit` commonmark / gfm preset, `remark-breaks` |
| Markdown extensions (output) | `markdown-it` (anchor / toc / github-alerts / custom task lists) + `highlight.js` |
| Diagrams | [Mermaid](https://mermaid.js.org/) (dynamic import) |
| Drag reordering | SortableJS (tab dragging is custom-built) |
| State management | Custom store (no external library) |

No UI framework (React/Vue) is used. State lives in the store, and the UI is a plain structure produced by functions.

## Requirements

- Node.js 18 or later
- Rust (Tauri 2.x prerequisites / see the [Tauri official guide](https://v2.tauri.app/start/prerequisites/))

## Setup

```bash
# Install dependencies
npm install

# Development mode (Vite + Tauri)
npm run tauri:dev

# Type check
npm run typecheck

# Production build (generate installers)
npm run tauri:build
```

Build artifacts:
- Binary: `src-tauri/target/release/mdedit.exe`
- Installers:
  - MSI: `src-tauri/target/release/bundle/msi/mdedit_<version>_x64_ja-JP.msi`
  - NSIS: `src-tauri/target/release/bundle/nsis/mdedit_<version>_x64-setup.exe`

> Cross-platform distribution is built automatically by `.github/workflows/release.yml` when a `v*` tag is pushed (Windows / macOS Intel + Apple Silicon / Linux). With `bundle.targets` set to `"all"` and macOS using ad-hoc signing (`signingIdentity: "-"`), each OS emits its native formats (dmg / AppImage / deb, etc.).

## Keyboard shortcuts

### File operations & output

| Shortcut | Action |
|---|---|
| `Ctrl+N` | New tab |
| `Ctrl+O` | Open file |
| `Ctrl+S` | Save |
| `Ctrl+Shift+S` / `F12` | Save as |
| `Ctrl+W` | Close tab |
| `Ctrl+Shift+E` | Export as HTML |
| `Ctrl+Shift+V` | Open HTML preview tab |
| `Ctrl+P` | Print body only (PDF save available) |
| `Ctrl+,` | Open settings |

The Edit menu provides Undo (`Ctrl+Z`) / Redo (`Ctrl+Y`) / Cut (`Ctrl+X`) / Copy (`Ctrl+C`) / Paste (`Ctrl+V`) / Select All (`Ctrl+A`). Undo/redo use the ProseMirror history; copy/cut go through the clipboard.

### Menu bar (Alt operation)

The native menu was removed and replaced with an HTML menu bar (because in WebView2 the Alt mnemonics of native menus don't work).

| Operation | Action |
|---|---|
| `Alt+F` / `Alt+E` / `Alt+O` / `Alt+V` / `Alt+H` | Open File / Edit / Format / View / Help |
| Letter key after opening | Run that item's mnemonic (e.g. `Alt+F`→`N` for new tab) |
| `↑` / `↓` | Move between items |
| `←` / `→` | Switch to the adjacent menu |
| `Enter` / `Esc` | Run / Close |

### Tab operations

| Shortcut | Action |
|---|---|
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Switch to next / previous tab |
| `Ctrl+1`–`Ctrl+9` | Switch to the n-th tab |

Dragging to reorder, detaching out of the window, merging into another window, and the right-click menu are also supported.

### Find & replace

| Shortcut | Action |
|---|---|
| `Ctrl+F` | Open the search bar |
| `Ctrl+H` | Open the search bar with the replace field |
| `Enter` / `Shift+Enter` (in the search field) | Go to next / previous match |
| `Esc` (search bar) | Close and return to the editor |

### Formatting (toolbar and menu)

| Shortcut | Action |
|---|---|
| `Ctrl+B` | Bold |
| `Ctrl+I` | Italic |
| `Ctrl+Shift+X` | Strikethrough |
| `Ctrl+E` | Inline code |
| `Ctrl+Alt+1` – `Ctrl+Alt+3` | Heading 1–3 |
| `Ctrl+K` | Link |

In addition to the above, the toolbar has (from the left) the outline toggle, then file operations (New / Open / Save / Save As / Export HTML / HTML preview), headings (H1–H4), and list / quote / code block / table / image / horizontal-rule buttons. The settings (gear) icon is on the far right.

### View & zoom

| Shortcut | Action |
|---|---|
| `Ctrl+=` / `Ctrl+wheel up` | Increase font size (on an HTML preview tab, zooms that preview independently) |
| `Ctrl+-` / `Ctrl+wheel down` | Decrease font size (same) |
| `Ctrl+0` | Reset font size |
| `Ctrl+Shift+O` | Show/hide the heading outline panel |
| `Alt+wheel` (over an image) | Resize the image block's pixel width |
| Click (a Mermaid diagram) | Open the zoom viewer (wheel-zoom / pan / selection-mode toggle) |

### Presentation view

Opened with `Ctrl+Shift+P`. The following keys are active while a presentation tab is focused:

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+P` | Open the presentation view for the current document |
| `→` / `↓` / `PageDown` / `Space` | Next slide |
| `←` / `↑` / `PageUp` | Previous slide |
| `Home` / `End` | First / last slide |
| `G` | Toggle deck / grid overview |
| `L` | Toggle the laser pointer |
| `F` / `F5` / `Enter` | Present full-screen |
| `Esc` | Exit full-screen / leave grid |
| `Ctrl+wheel` (grid) | Adjust the tile column width |

### Editing

| Shortcut | Action |
|---|---|
| `Enter` / `Shift+Enter` | New paragraph / soft line break within a paragraph |
| `Backspace` (start of a blockquote) | Remove the blockquote |
| `Backspace` (start of a list item) | Merge with the previous line (does not remove the list) |
| `Enter` (second time on a trailing empty line inside a code block) | Exit the code block |
| Triangle icon on heading hover | Fold/unfold the contents below (display only) |
| Double-click an image | Edit URL / alt text / width (px) |

### Printing & handling of browser default keys

Among the WebView's default key behaviors, the harmful or unsupported ones are suppressed or reassigned.

| Shortcut | Action |
|---|---|
| `Ctrl+P` | Print the md body only (the browser's default print dialog is suppressed) |
| `F12` | Save as (DevTools is suppressed) |
| `Ctrl+R` / `Ctrl+Shift+R` / `F5` / `Shift+F5` | Suppressed (to prevent reloads from losing tabs / unsaved content) |
| `Ctrl+Shift+I` | Suppressed (DevTools inspect) |

## Directory layout

```
md-editor/
├── src/                         # Frontend (TypeScript)
│   ├── main.ts                  # Entry point
│   ├── editor.ts                # Milkdown Crepe integration, per-tab editor management, preview-tab creation
│   ├── edit-ops.ts              # The actual Edit-menu operations (undo/copy/paste, etc.)
│   ├── heading-fold.ts          # Heading folding (ProseMirror Decoration)
│   ├── store.ts                 # Tab state management
│   ├── tabs.ts                  # Tab bar UI (reorder / detach / merge / right-click)
│   ├── menu-bar.ts              # HTML menu bar (Alt operation, dropdowns)
│   ├── toolbar.ts               # Formatting / file / output / settings toolbar
│   ├── shortcuts.ts             # Keyboard shortcuts
│   ├── actions.ts               # File operations: open / save / close / cross-window transfer, etc.
│   ├── context-menu.ts          # Generic context-menu foundation
│   ├── editor-context-menu.ts   # The editor's custom right-click menu
│   ├── find-replace.ts          # Find & replace bar (UI + orchestration)
│   ├── search-core.ts           # Pure search logic (regex building / matching / replacement resolution)
│   ├── search-plugin.ts         # Highlighting of search matches (ProseMirror Decoration)
│   ├── outline.ts               # Heading outline panel (left sidebar)
│   ├── render-pipeline.ts       # markdown → document HTML rendering for output
│   ├── exporter.ts              # HTML export / HTML preview-tab creation
│   ├── print.ts                 # Body-only printing (@media print)
│   ├── mermaid-renderer.ts      # Renders Mermaid to SVG (dynamic import)
│   ├── diagram-viewer.ts        # Diagram zoom viewer (zoom / pan / selection mode)
│   ├── presentation.ts          # Presentation view (slide split, deck / grid / full-screen, laser)
│   ├── mmd.ts                   # Fence wrap/unwrap for .mmd / .mermaid
│   ├── doc-styles.ts            # Supplies/injects document CSS and highlight themes
│   ├── theme.ts                 # Document theme (font/color/headings, etc.) and CSS-variable generation
│   ├── embed-images.ts          # Embeds local images as data URIs on HTML export
│   ├── modal.ts                 # Confirmation dialog
│   ├── about-modal.ts           # Version info (clickable GitHub link)
│   ├── progress.ts              # Progress toast (e.g. while converting diagrams)
│   ├── settings.ts              # Persistence of font / language / theme, etc.
│   ├── settings-modal.ts        # Settings UI (tabbed, with a Preview button)
│   ├── line-numbers.ts          # Line-number overlay
│   ├── blank-lines.ts           # Blank-line preservation
│   ├── image-resolver.ts        # Relative-path resolution for image src (asset URL conversion)
│   ├── image-edit.ts            # Image URL/alt/width edit dialog
│   ├── i18n.ts                  # Internationalization (ja/en)
│   ├── title.ts                 # Window title updates
│   ├── styles/                  # Document CSS / print CSS
│   └── style.css
├── src-tauri/                   # Backend (Rust)
│   ├── src/
│   │   ├── main.rs
│   │   ├── lib.rs
│   │   ├── commands.rs          # Commands called from the frontend (get recent files, launch external URLs, etc.)
│   │   ├── recent.rs            # Recent files
│   │   ├── i18n.rs              # Holds language state (the menu is drawn on the frontend HTML side)
│   │   ├── tabwin.rs            # Cross-window tab transfer / merge / duplicate-open detection
│   │   └── startup.rs           # Launch arguments / single-instance handling
│   ├── capabilities/            # Tauri permission definitions
│   ├── icons/                   # App icons
│   ├── Cargo.toml
│   └── tauri.conf.json
├── scripts/                     # Helper scripts (icon transparency processing, etc.)
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## Design notes

### Designing so the "unsaved changes" prompt never misfires

Because Milkdown Crepe is a WYSIWYG editor, content is normalized on load (e.g. adjusting trailing newlines, unifying list markers). Comparing against the raw file content would mark the document dirty even when the user did nothing.

`editor.ts` avoids this as follows:

- Keeps the first serialization result (`crepe.getMarkdown()`) as the `baseline`
- On each `markdownUpdated` event, compares the current markdown against the baseline to decide `isDirty`
- After saving, resets the `baseline` to the current markdown

### Preserving per-tab EditorState

Each tab has its own Crepe instance. Inactive editors are moved, DOM and all, into a parking container called `#editor-pane-park`. This works around a WebView2 issue where holding multiple compositing layers leaves ghosting artifacts; rather than `display: none`, the parent element is reparented.

### Keeping HTML export and the preview tab identical

HTML export and the HTML preview tab go through the same `render-pipeline.ts`. The preview tab doesn't use Crepe; it shows the already-rendered HTML (`<main class="document">`) read-only. The document CSS (`doc-styles.ts`) and highlight theme are injected when the preview is shown, so the background and styles aren't lost even when detached to another window. This guarantees "it exports exactly as the preview looks".

### Mermaid and the diagram viewer

` ```mermaid ` blocks and `.mmd` / `.mermaid` files are converted to SVG by `mermaid-renderer.ts` (Mermaid itself is over 1 MB, so it is dynamically imported). Colors follow the display theme (on export they follow the document background). Clicking a diagram opens the zoom viewer in `diagram-viewer.ts`, with wheel-zoom, pan (hand), and a text-selection mode toggle. For inline diagrams in the editor, the viewer can jump back to the source code.

### Presentation view

`presentation.ts` reuses the exporter's rendered document HTML (`<main class="document">`) so slides match the HTML export pixel-for-pixel. Splitting is done on the *rendered DOM*, not the raw Markdown — splitting raw text would corrupt it (e.g. `text\n---` becomes a setext H2). Boundaries are `<hr>` first, falling back to H1/H2 when no rules are present. Each slide's children are assigned to three zones (title / message / body); the body is fit with a CSS `zoom` and drops to in-zone scrolling below a minimum scale. The deck, grid, and full-screen views all mount the same 16:9 canvas and only swap the outer layout. The presentation control bar lives in the app toolbar via a registered slot (a callback avoids a `presentation.ts ↔ main.ts` import cycle), and the current slide index is remembered per tab across re-renders.

### Cross-window tab transfer

A tab's contents (including unsaved changes and the baseline; for preview tabs, the HTML) are transferred via `tabwin.rs`'s `TabPayload`. Detaching creates a new `WebviewWindow` and hands the payload over through a pending map; merging hit-tests the target window's tab-bar rectangle and forwards there. A window that drops to one tab after a transfer is closed. Attempting to open the same file in multiple windows is detected and shown via a popup.

### Specifying image pixel width

The `ratio` attribute of the `image-block` node is reinterpreted as "pixel width". When `> 10` it is an explicit pixel width; when `≤ 10` it is treated as automatic (natural fit). The ratio value is serialized into the markdown alt field, so it persists in the form `![320](img.png)`. If the alt is empty or non-numeric, it reverts to automatic.

### Resolving relative-path images

Tauri's `assetProtocol` is enabled, and `convertFileSrc()` converts paths into URLs the WebView can load. A MutationObserver watches `<img>` elements and rewrites the src to an asset URL while it equals the markdown value (relative / absolute / `file://`).

A bare file name (no directory separator) tries `<mdDir>/img/<basename>/<file>` first and, if loading fails (`<img onerror>`), falls back to `<mdDir>/<file>` — a two-stage approach. On HTML export, `embed-images.ts` embeds the resolved images as data URIs.

### Find & replace approach

Rather than rewriting the DOM directly, find & replace operates on the ProseMirror document model. `find-replace.ts` concatenates strings per textblock, converts match positions to doc positions, and replaces with `tr.insertText`. Code blocks are handled the same way as PM nodes, preserving state consistency and undo. Match highlighting is drawn with a Decoration in `search-plugin.ts`.

### Current-location highlighting in the outline

`outline.ts` watches the `scroll` of the editor's scroll container (`.editor-pane`) and marks the last heading that crossed the top edge as "current" with `.is-current` (rAF-throttled). When an item is clicked, instead of PM's default `scrollIntoView` (which aligns to the bottom), the heading DOM is aligned to the top with `scrollIntoView({ block: "start" })`. The same outline behavior applies in HTML preview tabs.

### HTML menu bar

The menu is drawn in HTML by `menu-bar.ts`. In Tauri + WebView2, while the editor (webview) has focus, the Alt mnemonics of a native menu don't reach the menu, so the native menu was removed and replaced with a custom menu bar. The mnemonics of the top items and each entry are handled with a JS `keydown` (capture); `Alt+<letter>` opens a menu, and while open it is operated with the item's mnemonic letter, arrows, Enter, and Esc. Each action delegates to the existing frontend actions (File/Format/View/Help) and edit operations (`edit-ops.ts`). Recent files are fetched via the `list_recent_files` command and assembled dynamically.

### Suppressing and reassigning browser default keys

WebView2 processes browser default keys such as reload (`Ctrl+R` / `F5`), zoom, and print as-is. Reload in particular is dangerous: it reinitializes the frontend and loses in-memory tab state, and the `onCloseRequested` unsaved-changes check doesn't fire either. The capture-phase keydown handler in `main.ts` `preventDefault`s these, suppresses reload and DevTools (inspect), reassigns `F12` to "Save as", and reassigns `Ctrl+P` to body-only printing via `@media print`.
