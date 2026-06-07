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

### Phase 2 — ドラッグでの切り離し（実装済み）

- `tabs.ts` の `Sortable.create` を独自のポインタドラッグに置換する。各タブに
  `pointerdown`/`pointermove`/`pointerup` を付け、`setPointerCapture` で
  ウィンドウ外まで追跡する（WebView2 で有効）。`sortablejs` 依存はタブから外す。
- ドラッグの流れ:
  - `pointerdown`（左ボタン、×ボタン以外）で開始位置・対象タブを記録し capture。
  - `pointermove` で移動が閾値（4px）を超えたらドラッグ開始。ウィンドウ内では挿入位置
    インジケータ（縦線）を表示し、ストアは触らない（再描画で capture 中の要素が
    消えるのを避け、確定はドロップ時に1回だけ）。ドラッグ中のタブは `.dragging` で半透明。
  - `pointerup`:
    - ウィンドウ外（`clientX/Y` がビューポート外）→ 切り離し。Phase 1 の
      `openTabInNewWindow(tabId, editor, {x,y})` に離した画面座標（`screenX/screenY`）を
      渡して新ウィンドウを開く。
    - ウィンドウ内 → 挿入位置を計算して `store.reorder` で並べ替えを確定。
  - ドラッグ後の `click` は抑止（選択との誤発火回避）。閾値未満はクリック＝選択。
- `TabBarHandlers` に `onTearOff(tabId, {x,y})` を追加し `main.ts` で配線。並べ替えは
  `tabs.ts` 内で `store.reorder` を直接呼ぶ。
- 内外判定はビューポート座標で簡潔に行う（タイトルバー/メニュー領域も「外」扱い）。
  新ウィンドウ位置は `screenX/screenY`（CSS px ≒ WebviewWindow の logical px）を使う。
- `pointercancel` でドラッグ状態をリセットする。

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
