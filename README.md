# mdedit

軽量なMarkdownエディタ。Tauri 2.x + Vite + TypeScript で構築された、単一ウィンドウ・複数タブのデスクトップアプリ。

`.md` ファイルをダブルクリックすると、既存ウィンドウの新規タブで開きます。

## 特徴

- **WYSIWYG編集**: [Milkdown Crepe](https://milkdown.dev/) を採用。書式が反映された状態のまま編集でき、別ペインのプレビューは不要
- **検索・置換**: `Ctrl+F` で検索バー、`Ctrl+H` で置換欄を展開。大文字小文字の区別 / 正規表現（`$1` 等のキャプチャ参照置換）/ 単語単位一致 / すべて置換に対応。ProseMirror ドキュメント上で動作し undo も効く
- **見出しアウトライン**: 左サイドに見出し一覧パネル（`Ctrl+Shift+O` または左端のツールバーボタンでトグル、表示状態は永続化）。項目クリックで該当見出しへジャンプ（エディタ上端に整列）、スクロールに連動して現在地の見出しをハイライト
- **シングルインスタンス**: `.md` をダブルクリック → 既存ウィンドウの新規タブで開く
- **タブ操作**: ドラッグで並び替え、ミドルクリックで閉じる、横長になれば横スクロール
- **最近使ったファイル**: ファイルメニューに最近開いた `.md` を表示（設定でオン/オフ。6 件目以降はサブメニューにまとめる）
- **印刷**: `Ctrl+P` で md 本文のみを印刷（タブ・ツールバー・アウトライン等の UI と行番号を除外し、ダークテーマの淡色文字は黒に変換）
- **未保存検知**: 「Milkdown 正規化後の文字列」を baseline にして比較。WYSIWYG特有の自動正規化による誤発火を回避
- **GFM対応**: テーブル、タスクリスト、打ち消し線（CommonMark + GFM プリセット）
- **国際化**: 日本語 / 英語 / システム言語連動の切替（メニュー・設定UI・確認ダイアログがすべて連動）
- **テーマ**: ダーク / ライト / システム連動。`prefers-color-scheme` の動的変更にも追従
- **画像の柔軟な扱い**:
  - md ファイルとの相対パスで画像を表示（Tauri asset プロトコル経由）
  - 慣例パス `<mdDir>/img/<basename>/<file>` を自動解決（フォールバックとして md 隣のファイルも試行）
  - 画像ダブルクリックで URL → 代替テキスト → 幅(px) を編集（元サイズもプロンプトでヒント表示）
  - 画像上で `Alt+ホイール` でピクセル幅をその場で拡縮（保存・再読込でサイズが維持される）
- **Obsidian Live Preview 風の編集体験**:
  - ソース 1 行 = 表示 1 行（hardbreak で改行）
  - 引用ブロックの先頭で `Backspace` → 引用解除
  - 連続 Enter で末尾に空段落を追加可能
- **フォント設定**: 本文・コード用フォントを別々に指定。コード文字色も任意指定（既定は本文色追従）
- **ドラッグ&ドロップ**: `.md` / `.markdown` ファイルをウィンドウへ直接ドロップ
- **行番号オーバーレイ**: WYSIWYGペインに行番号を重ねて表示
- **設定プレビュー**: 設定ダイアログから「プレビュー」ボタンで適用前の見え方を試せる（キャンセルで元に戻る）

## 技術スタック

| 層 | 採用 |
|---|---|
| デスクトップフレームワーク | Tauri 2.x（Rust） |
| フロントエンドビルド | Vite + TypeScript |
| エディタ | [@milkdown/crepe](https://www.npmjs.com/package/@milkdown/crepe)（ProseMirror 系 WYSIWYG） |
| Markdown 拡張 | `@milkdown/kit` の commonmark / gfm preset、`remark-breaks` |
| ドラッグ並び替え | SortableJS |
| 状態管理 | 自前ストア（外部ライブラリなし） |

UI フレームワーク（React/Vue）は不使用。状態の中心はストア、UI は関数生成する素朴な構造。

## 動作要件

- Node.js 18 以上
- Rust（Tauri 2.x の前提条件 / [Tauri 公式ガイド](https://v2.tauri.app/start/prerequisites/) 参照）

## セットアップ

```bash
# 依存パッケージのインストール
npm install

# 開発モード（Vite + Tauri）
npm run tauri:dev

# 型チェック
npm run typecheck

# プロダクションビルド（インストーラ生成）
npm run tauri:build
```

ビルド成果物：
- バイナリ: `src-tauri/target/release/mdedit.exe`
- インストーラ:
  - MSI: `src-tauri/target/release/bundle/msi/mdedit_<version>_x64_ja-JP.msi`
  - NSIS: `src-tauri/target/release/bundle/nsis/mdedit_<version>_x64-setup.exe`

## キーボードショートカット

### ファイル操作

| ショートカット | 動作 |
|---|---|
| `Ctrl+N` | 新規タブ |
| `Ctrl+O` | ファイルを開く |
| `Ctrl+S` | 保存 |
| `Ctrl+Shift+S` / `F12` | 名前を付けて保存 |
| `Ctrl+W` | タブを閉じる |

「編集」メニューには元に戻す / やり直し / 切り取り / コピー / 貼り付け / すべて選択（OS 標準のアクセラレータ）を用意。

### タブ操作

| ショートカット | 動作 |
|---|---|
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | 次 / 前のタブへ切替 |
| `Ctrl+1`〜`Ctrl+9` | n 番目のタブへ切替 |

### 検索・置換

| ショートカット | 動作 |
|---|---|
| `Ctrl+F` | 検索バーを開く |
| `Ctrl+H` | 置換欄付きで検索バーを開く |
| `Enter` / `Shift+Enter`（検索欄） | 次 / 前のマッチへ移動 |
| `Esc`（検索バー） | 閉じてエディタに戻る |

### 書式（ツールバーおよびネイティブメニュー）

| ショートカット | 動作 |
|---|---|
| `Ctrl+B` | 太字 |
| `Ctrl+I` | 斜体 |
| `Ctrl+Shift+X` | 打ち消し |
| `Ctrl+E` | インラインコード |
| `Ctrl+Alt+1` 〜 `Ctrl+Alt+3` | 見出し1〜3 |
| `Ctrl+K` | リンク |

ツールバーには上記に加えて、左端にアウトライン表示トグル、続けてファイル操作（新規 / 開く / 保存 / 名前を付けて保存）、見出し（H1–H4）、リスト / 引用 / コードブロック / 表 / 画像 / 水平線 ボタンを配置。右端には設定（歯車）アイコン。

### 表示・ズーム

| ショートカット | 動作 |
|---|---|
| `Ctrl+=` / `Ctrl+ホイール↑` | フォントサイズ拡大 |
| `Ctrl+-` / `Ctrl+ホイール↓` | フォントサイズ縮小 |
| `Ctrl+0` | フォントサイズをリセット |
| `Ctrl+Shift+O` | 見出しアウトラインパネルの表示/非表示 |
| `Alt+ホイール`（画像上） | 画像ブロックのピクセル幅を拡縮 |

### 編集

| ショートカット | 動作 |
|---|---|
| `Backspace`（引用先頭） | 引用ブロックを解除 |
| `Enter`（コードブロック内末尾の空行で2回目） | コードブロックから抜ける |
| 画像ダブルクリック | URL / 代替テキスト / 幅(px) を編集 |

### 印刷・ブラウザ標準キーの扱い

WebView 標準のキー動作のうち、実害のあるもの・未提供のものを抑止または再割り当てしている。

| ショートカット | 動作 |
|---|---|
| `Ctrl+P` | md 本文のみを印刷（ブラウザ標準の印刷ダイアログは抑止） |
| `F12` | 名前を付けて保存（DevTools は抑止） |
| `Ctrl+R` / `Ctrl+Shift+R` / `F5` / `Shift+F5` | 抑止（再読み込みによるタブ・未保存内容の消失を防ぐ） |
| `Ctrl+Shift+I` | 抑止（DevTools inspect） |

## ディレクトリ構成

```
md-editor/
├── src/                         # フロントエンド（TypeScript）
│   ├── main.ts                  # エントリポイント
│   ├── editor.ts                # Milkdown Crepe 連携・タブ別エディタ管理
│   ├── store.ts                 # タブ状態管理
│   ├── tabs.ts                  # タブバーUI
│   ├── toolbar.ts               # 書式・ファイル・設定ツールバー
│   ├── shortcuts.ts             # キーボードショートカット
│   ├── find-replace.ts          # 検索・置換バー（UI＋オーケストレーション）
│   ├── search-core.ts           # 検索の純粋ロジック（regex構築・マッチ・置換解決）
│   ├── search-plugin.ts         # 検索マッチのハイライト（ProseMirror Decoration）
│   ├── outline.ts               # 見出しアウトラインパネル（左サイドバー）
│   ├── actions.ts               # 開く / 保存 / 閉じる等のファイル操作
│   ├── modal.ts                 # 確認ダイアログ
│   ├── settings.ts              # フォント / 言語 / テーマ等の設定永続化
│   ├── settings-modal.ts        # 設定UI（Preview ボタン付き）
│   ├── line-numbers.ts          # 行番号オーバーレイ
│   ├── image-resolver.ts        # 画像 src の相対パス解決（asset URL 変換）
│   ├── image-edit.ts            # 画像 URL/alt/幅 編集ダイアログ
│   ├── i18n.ts                  # 多言語対応（ja/en）
│   ├── title.ts                 # ウィンドウタイトル更新
│   └── style.css
├── src-tauri/                   # バックエンド（Rust）
│   ├── src/
│   │   ├── main.rs
│   │   ├── lib.rs
│   │   ├── commands.rs          # フロントから呼ぶコマンド
│   │   ├── menu.rs              # ネイティブメニュー
│   │   ├── recent.rs            # 最近使ったファイル
│   │   ├── i18n.rs              # メニュー側の多言語対応
│   │   └── startup.rs           # 起動引数 / シングルインスタンス処理
│   ├── capabilities/            # Tauri 権限定義
│   ├── icons/                   # アプリアイコン
│   ├── Cargo.toml
│   └── tauri.conf.json
├── scripts/                     # 補助スクリプト（アイコン透過処理など）
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## 設計メモ

### 「保存確認が誤発火しない」設計

Milkdown Crepe は WYSIWYG エディタなので、ファイル読み込み時に内容が正規化される（例: 末尾改行の調整、リスト記号の統一など）。生のファイル内容と比較すると、ユーザーが何もしていなくても dirty 判定になってしまう。

`editor.ts` ではこの問題を以下で回避している:

- 初回シリアライズ結果（`crepe.getMarkdown()`）を `baseline` として保持
- `markdownUpdated` イベントで現在の markdown と baseline を比較し、`isDirty` を判定
- 保存後は `baseline` を現在の markdown に再セット

### タブ別 EditorState の保持

各タブは独立した Crepe インスタンスを持つ。非アクティブなエディタは `#editor-pane-park` という退避用コンテナに DOM ごと移動させる。これは WebView2 が複数の合成レイヤを抱え込むと残像が出る問題を回避するためで、`display: none` ではなく親要素の付け替えで対応している。

### 画像のピクセル幅指定

`image-block` ノードの `ratio` 属性を「ピクセル幅」として再解釈している。`> 10` のとき明示的なピクセル幅、`≤ 10` のとき自動（natural fit）扱い。ratio 値は markdown の alt フィールドにシリアライズされるので、`![320](img.png)` の形で永続化される。alt が空 / 数値でなければ自動扱いに復帰。

### 相対パス画像の解決

Tauri の `assetProtocol` を有効化し、`convertFileSrc()` で WebView から読み込める URL に変換する。MutationObserver で `<img>` 要素を監視し、src が markdown 上の値（相対 / 絶対 / `file://`）の間は asset URL に書き換える。

ベアファイル名（ディレクトリ区切りなし）は `<mdDir>/img/<basename>/<file>` を優先試行し、`<img onerror>` でロード失敗したら `<mdDir>/<file>` にフォールバックする 2 段構え。

### 検索・置換の方式

DOM を直接書き換えず、ProseMirror のドキュメントモデル上で検索・置換する。textblock 単位で文字列を連結して `find-replace.ts` がマッチ位置を doc 位置へ変換し、`tr.insertText` で置換する。コードブロックも PM ノードとして同じ仕組みで扱え、状態の整合性と undo が保たれる。マッチのハイライトは `search-plugin.ts` の Decoration で描画。

### アウトラインの現在地ハイライト

`outline.ts` はエディタのスクロールコンテナ（`.editor-pane`）の `scroll` を監視し、上端を越えた最後の見出しを「現在地」として `.is-current` を付与する（rAF スロットリング）。項目クリック時は PM 標準の `scrollIntoView`（下端寄せ）を使わず、見出し DOM を `scrollIntoView({ block: "start" })` で上端に整列させる。

### ブラウザ標準キーの抑止と再割り当て

WebView2 は再読み込み（`Ctrl+R` / `F5`）やズーム、印刷などのブラウザ標準キーをそのまま処理する。特に再読み込みはフロントエンドを初期化してメモリ上のタブ状態を失わせ、`onCloseRequested` の未保存確認も発火しないため危険。`main.ts` の capture フェーズ keydown ハンドラでこれらを `preventDefault` し、再読み込み・DevTools(inspect) を抑止、`F12` を「名前を付けて保存」、`Ctrl+P` を `@media print` による本文限定印刷へ振り替えている。

## ライセンス

[MIT License](./LICENSE)
