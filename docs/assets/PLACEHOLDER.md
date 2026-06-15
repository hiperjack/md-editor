# Image assets / 画像メモ

## English

All images referenced by the README live in this folder.

| File | Content | Status |
|---|---|---|
| `demo.gif` | Operation demo: typing → Mermaid rendering → HTML preview (900px / 35 frames / ~5s loop) | ✅ present |
| `edit.png` | WYSIWYG editing (dark theme) | ✅ present |
| `mermaid.png` | Inline preview of a Mermaid code block | ✅ present |
| `export.png` | HTML preview tab (document theme applied) | ✅ present |

**How they were produced (for regeneration / replacement):** these are captures of the real UI running on the Vite dev server (`npm run dev`, localhost:1420) — they are not mocked. Because the UI is entirely web-rendered, the content is identical to the native Tauri window (only the OS window frame is absent).

- Still images (png): Playwright's `page.screenshot()`
- GIF: frames captured during the interaction, then combined with `ffmpeg` (palettegen / paletteuse)

To replace them with real screenshots/recordings, overwrite using the same file names — the README paths will keep working.

## 日本語

README が参照する画像はすべてこのフォルダにあります。

| ファイル | 内容 | 状態 |
|---|---|---|
| `demo.gif` | 入力 → Mermaid 描画 → HTML プレビューの操作デモ（900px / 35 フレーム / 約5秒ループ） | ✅ 取得済み |
| `edit.png` | WYSIWYG 編集画面（ダークテーマ） | ✅ 取得済み |
| `mermaid.png` | Mermaid コードブロックのインラインプレビュー | ✅ 取得済み |
| `export.png` | HTML プレビュータブ（文書テーマ適用） | ✅ 取得済み |

**生成方法（再生成・差し替え時の参考）:** これらは Vite dev サーバ（`npm run dev`、localhost:1420）上で動作中の実 UI を Playwright でキャプチャしたものです（捏造ではありません）。UI はすべて Web 描画のため、ネイティブの Tauri ウィンドウと内容は同一です（OS のウィンドウ枠のみ写りません）。

- 静止画（png）: Playwright の `page.screenshot()`
- GIF: 操作中のフレームを連続キャプチャ → `ffmpeg`（palettegen / paletteuse）で結合

実機のスクリーンショット・録画に差し替えたい場合は、同じファイル名で上書きすれば README のパスはそのまま機能します。
