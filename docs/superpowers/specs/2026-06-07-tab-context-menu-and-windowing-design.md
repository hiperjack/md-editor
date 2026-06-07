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

### Phase 3 — ドラッグでの結合（実装済み）

**Rust（`tabwin.rs`）**
- 状態 `TabBarRects: Mutex<HashMap<label, Rect>>`（Rect は logical 画面座標 {x,y,w,h}）。
- `register_tabbar_rect(label, x, y, w, h)`: 各ウィンドウが自分のタブバー画面矩形を登録/更新。
- `find_drop_target(x, y, source_label) -> Option<label>`: 点を含むタブバーを持つ
  ウィンドウを返す（source 除外、実在しないウィンドウは無視）。
- `transfer_tab(target_label, payload)`: 対象ウィンドウへ `add-moved-tab` を送り、
  `set_focus` で前面化。

**フロント（各ウィンドウ）**
- 起動時にタブバー画面矩形を登録。`onMoved`/`onResized` で再登録。閉じる時は
  best-effort で登録解除。
- 矩形 = `innerPosition ÷ scaleFactor`（logical）＋ タブバーの `getBoundingClientRect`。
  座標は logical px で統一（ポインタ `screenX/Y` と同じ系）。
- `add-moved-tab` を購読 → 既存 `openMovedTab(payload)` でタブ追加＋前面化。

**切り離しリリース時の判定（`main.ts` の `onTearOff`）**
```
target = find_drop_target(pos)
if (target) → transfer_tab で結合（単一タブでも許可）
else if (タブが2つ以上) → 新規ウィンドウ化（Phase 2）
else → 何もしない
```
- `tabs.ts` の単一タブガードは撤去し、判定を `onTearOff` に集約する。

**移送内容**: Phase 1 と同じ `{filePath, content, baseline, diskContent}`。

**エラー処理**: `find_drop_target`/`transfer_tab` 失敗時は新規ウィンドウ化に
フォールバック。stale な矩形は Rust 側でウィンドウ実在チェックして無視。

**追補（実装済み）**
- 結合元が1タブだったら、移送後に元ウィンドウを閉じる（空タブを残さない）。
  保存ダイアログの誤発火を避けるため、先にタブを除去してから `close()` する。
- 結合ドラッグ中、結合先ウィンドウのタブバーに青い挿入インジケータを表示する。
  ソースは rAF スロットルで `drag_over(sourceLabel, x, y)` を送り、Rust が
  ヒットテストして対象へ `tabbar-dragover{x}`／直前対象へ `tabbar-dragleave` を送出
  （直前対象は `DragHover` で保持）。対象は画面 X をビューポート X に変換して既存の
  挿入位置計算で青線を表示。`drag_end`・`add-moved-tab` 受信時に確実に消す。
- イベント購読はグローバル `listen` ではなく `appWin.listen`（当該ウィンドウ宛てのみ）
  を使う。グローバル `listen` は全ターゲット宛てを受信するため、`emit_to` で
  絞ったイベントが全ウィンドウで発火してしまう（最近ファイルの二重オープン等）。

### 追加機能 — ウィンドウ間の同一ファイル二重オープン検知（実装済み）

複数ウィンドウで同じファイルを別々に開けてしまうのを防ぐため、別ウィンドウで開いて
いるファイルを開こうとしたらポップアップを表示する。

**Rust（全体レジストリ）**
- `OpenFiles: Mutex<HashMap<label, Vec<path>>>`（ウィンドウごとの開いているパス一覧）。
- `set_open_files(label, paths)`: そのウィンドウの一覧を置き換え。
- `find_file_window(path, source_label) -> Option<label>`: そのパスを開いている別の
  実在ウィンドウを返す。
- `activate_file_in_window(target_label, path)`: 対象へ `activate-file{path}` を送り
  `unminimize`＋`set_focus`。

**フロント**
- 各ウィンドウは store 変更時に開いているパス一覧を `set_open_files` で同期（変化時のみ）。
- `openOrSwitch`: 自ウィンドウ内（既存）→ 無ければ `find_file_window` で他ウィンドウ確認。
  見つかればポップアップ（切替 / ここで開く / キャンセル）。
  - 切替 → `activate_file_in_window`。自ウィンドウでは開かない。
  - ここで開く → 自ウィンドウで開く（意図的な二重を許可）。
  - キャンセル → 何もしない。
- `activate-file{path}` を購読 → `store.findByPath` でタブをアクティブ化。
- モーダル `confirmDuplicateWindow`（switch/open/cancel）と i18n `dlg.dupwin.*` を追加。
- 対象の全入口（メニュー開く/最近/ドラッグドロップ/ファイル関連付け）は `openOrSwitch`
  を通るため一括でカバー。

**エラー処理**: stale エントリは実在チェックで無視。コマンド失敗時は従来どおり開く。

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
