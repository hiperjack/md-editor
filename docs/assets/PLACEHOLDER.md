# 画像メモ（人間向け）

README が参照する画像はすべてこのフォルダにあります。

| ファイル名 | 内容 | 状態 |
|---|---|---|
| `demo.gif` | 入力 → Mermaid 描画 → HTML プレビューまでの操作デモ（900px / 35 フレーム / 約5秒ループ） | ✅ 取得済み |
| `edit.png` | WYSIWYG 編集画面（ダークテーマ） | ✅ 取得済み |
| `mermaid.png` | Mermaid コードブロックのインラインプレビュー | ✅ 取得済み |
| `export.png` | HTML プレビュータブ（文書テーマ適用） | ✅ 取得済み |

## 生成方法（再生成・差し替え時の参考）

これらは Vite dev サーバ（`npm run dev`、localhost:1420）上で動作中の**実 UI** を Playwright でキャプチャしたものです（捏造ではありません）。UI はすべて Web 描画のため、ネイティブの Tauri ウィンドウと内容は同一です（OS のウィンドウ枠のみ写りません）。

- 静止画（png）: Playwright の `page.screenshot()`
- GIF: 操作中のフレームを連続キャプチャ → `ffmpeg`（palettegen / paletteuse）で結合

実機のスクリーンショット・録画に差し替えたい場合は、同じファイル名で上書きすれば README のパスはそのまま機能します。
