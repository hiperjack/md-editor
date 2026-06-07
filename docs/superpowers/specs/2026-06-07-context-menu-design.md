# 独自コンテキストメニュー 設計

## 目的

- アプリ全域で WebView2 標準（ブラウザ）の右クリックメニューを抑止する。タブバー・左（アウトライン）パネル・ツールバー等で標準メニューが出るのを止める。
- エディタ本文の右クリックだけは、このアプリ専用の文脈対応コンテキストメニューを表示する。

## 範囲（合意済み）

- ネイティブ抑止: **エディタ以外すべて**（＝全域で抑止し、エディタ内のみ独自メニュー）。
- メニュー内容: **編集操作 + 文脈対応**（右クリック対象に応じて項目を出し分ける）。

## コンポーネント構成

### `src/context-menu.ts`（新規・汎用UI）

再利用可能なフローティングメニュー。find-bar と同じDOM注入パターンを踏襲する。

- API: `showContextMenu(x, y, items)`。`items` は `MenuItem[]`。
  - `MenuItem = { type: "item"; label: string; action: () => void; disabled?: boolean } | { type: "separator" }`
- 描画先: `#app` 配下に一度だけ作る `#context-menu-root`。
- 表示位置: クリック座標。画面右端・下端を超える場合は内側へクランプ。
- 閉じる契機: 項目選択 / 外側クリック（mousedown, capture） / Esc / スクロール / ウィンドウリサイズ。
- 配色: テーマ変数 `--bg-1/--bg-2/--bg-3`, `--fg-0/--fg-1`, `--border`, `--accent` を使い、ダーク/ライト両対応。

### `src/editor-context-menu.ts`（新規・配線）

`EditorHost`・toolbar アクション（`fmt_*`）・`FindReplaceController` を受け取り、右クリック時の項目を組み立てる。

処理:
1. 右クリック座標から `view.posAtCoords` でドキュメント位置・ノードを判定。
2. 現在の選択が空なら、その位置へカーソル（または画像なら NodeSelection）を移動。標準的な右クリック挙動に合わせる。
3. 文脈に応じて項目を構築:
   - 切り取り / コピー（選択がある時のみ有効）
   - 貼り付け
   - すべて選択
   - ─── 選択テキストがある場合のみ: 太字 / 斜体 / リンク（既存 `fmt_bold` / `fmt_italic` / `fmt_link` を再利用）
   - ─── 画像ノード上の場合のみ: 画像を編集（既存 `imageActionFromMenu` 相当）
   - ─── 検索（`find.openFind`）

### `src/main.ts`

`contextmenu` を `capture: true` で1つだけ登録する。

```
target.closest(".editor-pane .ProseMirror") があれば
  → preventDefault + エディタ用メニュー表示
それ以外
  → preventDefault のみ（ネイティブ抑止）
```

### `src/i18n.ts`

`cm.*` キー（cut / copy / paste / selectAll / bold / italic / link / editImage / find）を ja・en 辞書に追加。

## クリップボード方式（WebView2）

- **コピー / 切り取り**: `document.execCommand("copy" | "cut")`。フォーカスのある ProseMirror 上で動作し、PM のクリップボード直列化を通るためリッチ内容を保持。切り取りは PM トランザクション扱いで undo 可能。
- **貼り付け**: WebView2 では `execCommand("paste")` が不可なことが多い。
  1. `navigator.clipboard.readText()` でテキスト取得。
  2. `DataTransfer` に `text/plain` を載せた合成 `paste` ClipboardEvent を `view.dom` に dispatch し、PM の貼り付け処理（Markdown 解釈）に通す。
  3. 上記が失敗（例外・未挿入）した場合は PM トランザクションで素テキストを `insertText` するフォールバック。

この貼り付け経路が唯一の技術的リスク。実装時に `tauri:dev` の実機で検証する。

## エラー処理

- clipboard API 失敗は `console.warn` し、貼り付けはフォールバックへ。
- `posAtCoords` が null の場合はカーソル移動を行わず、選択非依存の項目（貼り付け / すべて選択 / 検索）のみ有効にする。
- 操作後はエディタにフォーカスを戻す（既存 `runOnActive` / `editor.focus` と同方針）。

## テスト

- 手動（`tauri:dev`）:
  - タブバー / 左パネル / ツールバー / エディタ外余白で右クリック → 標準メニューが出ないこと。
  - エディタ内で右クリック → 独自メニュー表示。切取・コピー・貼付・全選択・太字/斜体/リンク・画像編集・検索が機能すること。
  - ダーク/ライト両テーマで配色が崩れないこと。
- `npm run typecheck` で型確認。
- （自動テスト基盤は現状なし。）
