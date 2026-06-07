# タブ右クリックメニュー & マルチウィンドウ 設計

## 目的

1. タブの右クリックで、このアプリ専用のコンテキストメニューを表示する。
2. タブをウィンドウ外へドラッグして離すと、新規ウィンドウとして開く（切り離し）。
3. 逆に、別ウィンドウのタブバーへドラッグして離すと、そのウィンドウにタブを追加する（結合）。

## 現状の前提（確認済み）

- タブ状態はフロントエンド（`src/store.ts`）のインメモリのみ。永続化なし。
- ウィンドウは単一（label `main`）。`tauri-plugin-single-instance` で2重起動は1つ目へ集約。
- `menu-action` と `open-file` は `app.emit`（全ウィンドウへブロードキャスト）。
  - → マルチウィンドウ化すると保存・フォーマット等が全ウィンドウで発火するため、フォーカス中ウィンドウ宛てルーティングへ修正が必要。
- メニューは `app.set_menu` でアプリ全体に設定（フォーカス中ウィンドウに適用される）。

## アーキテクチャ方針

### ウィンドウ生成（Rust 主導）

- 同一プロセス内に追加 `WebviewWindow` を生成する（single-instance は維持）。
- Rust コマンド `create_tab_window(payload)` を追加。
  - 一意ラベル（例 `tab-<連番>`）で `WebviewWindowBuilder` から index.html を開く。
  - `PendingTabs: Mutex<HashMap<String /*label*/, TabPayload>>` に payload を退避。
  - 任意で初期ウィンドウ位置（切り離し時の離した座標）を受け取る。
- 新ウィンドウのフロントは起動時に `take_pending_tab(label)` を呼び、payload があれば
  初期の空タブの代わりにそのタブを開く。なければ通常起動。
- 既存の `PendingPath` / `frontend_ready` と同じ流儀に揃える。

### タブ移送ペイロード

```
TabPayload = {
  filePath: string | null,
  content: string,      // 現在の表示内容（未保存分込み）
  diskContent: string,  // 直近のディスク内容（baseline 基準）
}
```

- `content` を新ウィンドウのエディタの表示初期値にする。
- 未保存（dirty）状態を保持するため、エディタに小さな拡張を入れる:
  - `Tab` に任意フィールド `initialContent?: string` を追加。
  - `editor.ts` の `make` は `defaultValue = tab.initialContent ?? tab.diskContent` で生成。
  - baseline は従来どおり「ディスク内容を正規化した文字列」を基準にする。
    `initialContent` が指定され、かつ `diskContent` と異なる場合は dirty として扱う。
  - 実装は Phase 1 の計画で確定する（baseline の算出方法を含む）。

### マルチウィンドウのルーティング修正（Phase 1 で必須）

- `menu-action`: `app.emit` → フォーカス中ウィンドウへ `emit_to(label, ...)`。
- `open-file`（外部ファイルオープン・最近のファイル）: フォーカス中ウィンドウ（無ければ `main`）へ `emit_to`。
- ファイルのドラッグ＆ドロップ（`win.onDragDropEvent`）と `onCloseRequested` は
  既にウィンドウ単位のため変更不要。

## フェーズ分割

### Phase 1 — タブ右クリックメニュー + 新規ウィンドウ基盤（実装済み）

- `tabs.ts` の各タブ要素に `contextmenu` を登録し、既存 `context-menu.ts` でメニュー表示。
- メニュー項目:
  - 閉じる
  - 他のタブをすべて閉じる
  - 右側のタブをすべて閉じる
  - ───
  - 新規ウィンドウで開く
  - パスをコピー（`filePath` が無いタブでは無効）
- 閉じる系は既存 `closeTab`（dirty 確認込み）をループ適用。複数 dirty タブはタブごとに確認。
- 「新規ウィンドウで開く」で、上記ウィンドウ生成基盤＋ルーティング修正を実装する。
  移送後、元ウィンドウからはそのタブを削除（`editor.destroy` + `store.removeTab`）。
- i18n: `tabcm.*`（close / closeOthers / closeRight / newWindow / copyPath）を ja・en に追加。

### Phase 2 — ドラッグでの切り離し

- タブの `pointerdown` で `setPointerCapture`（WebView2 で有効）し、`pointermove` /
  `pointerup` をウィンドウ外でも追跡。
- 既存 Sortable（並べ替え）との住み分け: タブバー矩形の内側で離したら従来の並べ替え、
  外側で離したら切り離し。閾値・判定ロジックは Phase 2 の計画で確定。
- ウィンドウ外で離したら Phase 1 の移送機構で新規ウィンドウ化。離した画面座標を
  新ウィンドウの初期位置に渡す。

### Phase 3 — ドラッグでの結合（最難所）

- 各ウィンドウは自分のタブバーの画面矩形を Rust に登録（移動・リサイズ時に更新）。
- 切り離しドラッグの `pointerup` 画面座標を Rust に渡し、登録済みの各ウィンドウの
  タブバー矩形とヒットテスト。
- 対象ウィンドウがあれば、そのウィンドウへ移送イベントを送ってタブ追加、
  元ウィンドウからは削除。対象が無ければ Phase 2 の新規ウィンドウ化にフォールバック。

## 主要な決定（承認済み）

1. ウィンドウ生成は Rust 主導（pending-tab マップ）で行う。
2. dirty なタブの移送は、内容と未保存マーカーの両方を引き継ぐ（保存プロンプトの安全性優先）。
3. 単一タブで「新規ウィンドウで開く」は許可し、元ウィンドウには空タブが再生成される
   挙動とする（特別扱いせず単純化）。

## エラー処理

- `create_tab_window` 失敗時は元タブを削除せず、`console.error` で通知。
- `take_pending_tab` が payload を返さない場合は通常の空タブ起動。
- `copyPath` のクリップボード失敗は `console.warn`。
- 閉じる系で保存がキャンセルされたタブはスキップ（既存 `closeTab` の挙動を踏襲）。

## テスト

- 手動（`tauri:dev` / `tauri:build` 実機）:
  - Phase 1: タブ右クリックで各項目が機能（閉じる系・新規ウィンドウ・パスコピー）。
    新規ウィンドウへ dirty タブを移送して内容と未保存マーカーが保持されること。
    新ウィンドウで保存・フォーマット・ファイルオープンがそのウィンドウだけに効くこと。
  - Phase 2: タブをウィンドウ外で離すと新規ウィンドウ化。内側では従来どおり並べ替え。
  - Phase 3: 別ウィンドウのタブバーへ離すと結合。外せば新規ウィンドウ化。
- `npm run typecheck` と `cargo`（`tauri:build`）でコンパイル確認。
- 自動テスト基盤は現状なし。
```
