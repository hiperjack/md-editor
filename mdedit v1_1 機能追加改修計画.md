# mdedit v1.1 機能追加改修計画

作成日: 2026-06-13
対象: 自作Markdownエディタ（Tauri 2.x / CodeMirror 6 / markdown-it 構成、Windows専用）
前提: v1.0（タブ対応・ライブプレビュー・ファイル関連付け）が完成していること

-----

## 1. 改修の目的とスコープ

v1.0は「mdファイルをダブルクリックで素早く開いて編集する」ことに特化していた。v1.1では「書いたものを人に渡せる形にする」ことを目的に、以下の4機能を追加する。

|# |機能       |概要                                        |
|--|---------|------------------------------------------|
|F1|HTML出力   |スタイル込みの単体HTMLファイルとして保存                    |
|F2|PDF出力    |印刷ダイアログ経由（Microsoft Print to PDF）でPDF化    |
|F3|Mermaid描画|```mermaid コードブロックをプレビュー・HTML出力で図として描画    |
|F4|.mmd対応   |Mermaid単体ファイル（.mmd）を開いて編集・プレビュー・出力できるようにする|

横断要素として、出力時の見た目（色・フォント・装飾）をユーザーが設定画面で変更できる**テーマ設定**を導入する。テーマはプレビュー・HTML出力・PDF印刷の3経路で共有する。

### スコープ外（v1.2以降に温存）

- PrintToPdfAsync（WebView2 API）によるダイアログなし直接PDF生成
- 複数テーマのプリセット切り替え（v1.1は1テーマをユーザーがカスタマイズする方式）
- Mermaid以外の図表系プラグイン（PlantUML等）
- エクスポートの一括処理（複数タブまとめて出力）

-----

## 2. アーキテクチャ変更概要

### 2.1 新規モジュール（フロントエンド）

```
src/
├── main.ts            （既存・初期化に追記）
├── store.ts           （既存・設定状態を追加）
├── editor.ts          （既存・.mmd言語モード分岐を追加）
├── preview.ts         （既存・レンダリングパイプラインを改修）
├── theme.ts           ★ テーマ定義・CSS変数の適用・設定値のバリデーション
├── settings.ts        ★ 設定モーダルUI（開閉・フォーム・即時プレビュー反映）
├── exporter.ts        ★ HTML出力（単体HTML組み立て・保存）
├── mermaid-renderer.ts ★ Mermaidブロック検出・SVG描画・キャッシュ
└── styles/
    ├── style.css      （既存・アプリUI用）
    ├── document.css   ★ 文書テーマの基礎CSS（CSS変数参照）
    └── print.css      ★ @media print 用（A4余白・改ページ制御・UI非表示）
```

### 2.2 Rust側の変更（src-tauri）

|項目             |内容                                                                                                     |
|---------------|-------------------------------------------------------------------------------------------------------|
|commands.rs    |`save_settings` / `load_settings` を追加（appDataDirのJSON読み書き）。既存の `write_file` はHTML出力でそのまま流用             |
|tauri.conf.json|fileAssociationsに `mmd` を追加。CSPにMermaid描画用の `style-src 'unsafe-inline'` と `img-src data:` を許可（後述のリスク参照）|
|依存追加           |なし（tauri-plugin-storeを使わず、設定はシンプルなJSON直書きとする。理由: 依存最小方針の維持と、設定構造が単純であるため）                              |

### 2.3 npm依存の追加

```json
{
  "dependencies": {
    "mermaid": "^11.x",
    "markdown-it-anchor": "^9.x",
    "markdown-it-toc-done-right": "^4.x",
    "markdown-it-github-alerts": "^1.x"
  }
}
```

mermaidはバンドルサイズが大きい（minifyで1MB超）ため、動的import（`import('mermaid')`）とし、mermaidブロックが初めて検出されたときだけロードする。md内に図がない通常利用では起動・プレビュー速度に影響を与えない。

-----

## 3. 機能別設計

### F1: HTML出力

#### 3.1.1 ユーザー操作

- メニューまたはショートカット **Ctrl+E** で「HTMLとして出力」
- 保存ダイアログ（tauri-plugin-dialog、既存導入済み）でパス指定。デフォルトファイル名は `元ファイル名.html`

#### 3.1.2 出力HTMLの構成

単体で配布できる自己完結型HTMLとする。外部ファイル参照を一切持たない。

```
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>{元ファイル名}</title>
  <style>
    /* 1. document.css の内容をインライン展開 */
    /* 2. テーマ設定値をCSS変数として埋め込み */
    /* 3. highlight.js テーマCSS をインライン展開 */
  </style>
</head>
<body>
  <main class="document">
    {markdown-it レンダリング結果}
    ※ Mermaidブロックは出力時点でSVGに変換済み（F3参照）
  </main>
</body>
</html>
```

**設計上のポイント**: Mermaidを出力時にSVG化して埋め込むことで、出力HTMLはJavaScript不要になる。社内共有やメール添付で開いてもらう際に、スクリプトブロックの警告が出ない・オフラインで確実に表示される、という実用上の利点がある。

#### 3.1.3 レンダリングパイプライン（プレビューと共通化）

```
mdテキスト
  → markdown-it（+ anchor + toc-done-right + github-alerts + task-lists）
  → HTML文字列
  → Mermaidブロック置換（mermaid-renderer.ts）
  → プレビューDOM挿入 ／ exporter.tsでの単体HTML組み立て
```

プレビューと出力で同じパイプラインを通すことで「プレビューで見た通りに出力される」ことを保証する。既存のpreview.tsのレンダリング処理を `render-pipeline.ts` 相当に切り出すか、preview.ts内の関数をexporter.tsから呼ぶ形にリファクタリングする。

#### 3.1.4 自動加飾の内訳

|加飾         |実現方法                                                            |設定でON/OFF|
|-----------|----------------------------------------------------------------|:-------:|
|目次の自動生成    |markdown-it-toc-done-right（md先頭に `[[toc]]` がなくても、設定ONなら出力時に自動挿入）|○        |
|シンタックスハイライト|highlight.js（既存導入済み）。出力時はテーマCSSをインライン化                          |○        |
|表のスタイリング   |document.css（縞模様・ヘッダ強調・はみ出し時横スクロール）                             |○        |
|コールアウト変換   |markdown-it-github-alerts（`> [!NOTE]` 等5種を色付きボックスに変換）           |○        |
|見出し番号の自動付与 |CSSカウンタ（h1〜h3対象、document.cssの `.numbered-headings` クラスで切替）      |○        |

### F2: PDF出力

#### 3.2.1 方式

WebView2の `window.print()` を呼び、Windowsの印刷ダイアログから「Microsoft Print to PDF」を選んでもらう方式。追加依存ゼロで、印刷CSSの整備だけで成立する。

#### 3.2.2 ユーザー操作

- メニューまたは **Ctrl+P** で印刷ダイアログを起動
- 印刷対象はプレビューペインの内容のみ（print.cssでエディタ・タブバー・UI要素を `display: none`）

#### 3.2.3 print.css の要点

```css
@media print {
  /* UI要素の非表示 */
  .tab-bar, .editor-pane, .toolbar { display: none !important; }
  .preview-pane { width: 100%; overflow: visible; }

  /* A4前提のページ設定 */
  @page { size: A4; margin: 20mm 18mm; }

  /* 改ページ制御 */
  h1, h2 { break-after: avoid; }        /* 見出し直後の孤立を防ぐ */
  pre, table, figure { break-inside: avoid; } /* コード・表・図の分断を防ぐ */
  p { orphans: 3; widows: 3; }

  /* 印刷向けの色調整 */
  pre code { background: #f5f5f5; -webkit-print-color-adjust: exact; }
}
```

注意: `break-inside: avoid` は1ページに収まらない長大なコードブロックでは効かない。これは仕様上の制約として許容する（無理に分割制御せずブラウザ任せとする）。

### F3: Mermaid描画

#### 3.3.1 検出と描画

markdown-itのfenceレンダラをフックし、`language-mermaid` のコードブロックを `<div class="mermaid-block" data-source="...">` のプレースホルダに変換する。レンダリング後、mermaid-renderer.tsが各プレースホルダに対して `mermaid.render()` を呼び、SVGに差し替える。

#### 3.3.2 ライブプレビューでのパフォーマンス対策

打鍵のたびに全図を再描画すると重いので、以下の2段構えとする。

1. **デバウンス分離**: 通常のmd再描画は既存の200msのまま。Mermaid再描画だけ**800ms**の別デバウンスとする
1. **コンテンツハッシュキャッシュ**: 図のソース文字列のハッシュをキーにSVGをMapにキャッシュし、ソースが変わっていない図は再描画しない。タブ切り替え時もキャッシュが効く

描画エラー（文法ミス中の入力途中など）の場合は、直前の正常なSVGを表示し続け、ブロック右上に小さくエラーインジケータを出す。エラーメッセージで図が消えてプレビューがガタつく事態を防ぐ。

#### 3.3.3 HTML出力時のSVG埋め込み

出力時は全mermaidブロックを同期的に `mermaid.render()` でSVG化してからHTMLに埋め込む。図が多い場合に備え、出力中はプログレス表示（「図を変換中… 3/8」程度の簡易なもの）を出す。

### F4: .mmdファイル対応

#### 3.4.1 挙動定義

|項目    |挙動                                                          |
|------|------------------------------------------------------------|
|開く    |ダブルクリック・Ctrl+O・タブで.mmdを開ける                                  |
|エディタ  |CodeMirrorはプレーンテキストモード（Mermaid用言語モードは存在しないため。簡易ハイライトはv1.2検討）|
|プレビュー |ファイル全体を**1つのMermaidソース**として描画。markdown-itは通さない              |
|HTML出力|SVG1枚を中央配置した単体HTMLを出力                                       |
|PDF出力 |F2と同じ印刷経路。図1枚のレイアウトに合わせ、print.cssで中央寄せ                      |
|保存    |既存のwrite_fileそのまま                                           |

#### 3.4.2 実装方針

store.tsのタブ状態に `fileType: "md" | "mmd"` を追加し、preview.tsの冒頭でパイプラインを分岐する。拡張子判定はファイルオープン時に行う。新規タブ（無題）はmd扱いとし、.mmdとして保存した時点でfileTypeを切り替える。

#### 3.4.3 ファイル関連付け

tauri.conf.json に追記:

```json
{
  "ext": ["mmd"],
  "name": "Mermaid Diagram",
  "description": "Mermaid Diagram File",
  "role": "Editor"
}
```

v1.0と同様、インストーラでの関連付け上書きには注意する（.mmdは競合アプリが少ないため既定で関連付けてよい）。

-----

## 4. テーマ設定（横断機能）

### 4.1 設定項目（v1.1）

|カテゴリ|項目                |UI                                            |デフォルト            |
|----|------------------|----------------------------------------------|-----------------|
|文字  |本文フォント            |セレクト（游ゴシック / メイリオ / BIZ UDゴシック / Noto Sans JP）|游ゴシック            |
|文字  |基本フォントサイズ         |数値（12〜20px）                                   |16px             |
|文字  |行間                |数値（1.4〜2.0）                                   |1.7              |
|色   |アクセント色（見出し・リンク・罫線）|カラーピッカー                                       |#2563eb          |
|色   |本文色 / 背景色         |カラーピッカー×2                                     |#1f2937 / #ffffff|
|見出し |見出し下線スタイル         |セレクト（なし / 下線 / 左ボーダー）                         |下線               |
|加飾  |目次自動挿入            |トグル                                           |OFF              |
|加飾  |見出し番号             |トグル                                           |OFF              |
|加飾  |コールアウト変換          |トグル                                           |ON               |
|加飾  |表の縞模様             |トグル                                           |ON               |
|コード |ハイライトテーマ          |セレクト（github / atom-one-dark / vs）             |github           |

### 4.2 実現方式

- document.cssはすべてCSS変数（`--doc-accent`, `--doc-font-size` 等）を参照する作りにする
- theme.tsが設定JSONを読み、`:root` のCSS変数とbodyのモディファイアクラス（`.numbered-headings` 等）を適用する
- 設定モーダルでの変更は**即時にプレビューへ反映**する（保存ボタンで永続化、キャンセルで復元）
- HTML出力時は、同じ設定値からCSS変数定義を文字列生成して `<style>` に埋め込む

### 4.3 設定の永続化

`{appDataDir}/settings.json` にRustコマンド経由で読み書きする。

```json
{
  "version": 1,
  "theme": {
    "fontFamily": "yu-gothic",
    "fontSize": 16,
    "lineHeight": 1.7,
    "accentColor": "#2563eb",
    "textColor": "#1f2937",
    "bgColor": "#ffffff",
    "headingStyle": "underline",
    "highlightTheme": "github"
  },
  "decorations": {
    "autoToc": false,
    "headingNumbers": false,
    "callouts": true,
    "stripedTables": true
  }
}
```

`version` キーを最初から入れておき、将来の設定項目追加時のマイグレーションに備える。読み込み時に不正値はデフォルトへフォールバックする（theme.tsでバリデーション）。

-----

## 5. 実装順序

「動く実感」を早く得られる順かつ、後工程の手戻りが起きない順に並べる。

1. **document.cssの基礎構築**（CSS変数前提の文書スタイル。まずデフォルト値ハードコードでプレビューに適用し、見た目の土台を確定させる）
1. **markdown-itプラグイン組み込み**（anchor / toc / github-alerts。プレビューで効果確認）
1. **theme.ts + settings.json読み書き**（Rustコマンド追加。設定→CSS変数反映の経路を通す）
1. **settings.ts（設定モーダルUI）**（即時プレビュー反映・保存・キャンセル復元）
1. **exporter.ts（HTML出力）**（パイプライン共通化のリファクタリングを含む。Ctrl+E）
1. **print.css + Ctrl+P**（PDF出力成立。ここまででF1・F2完了）
1. **mermaid-renderer.ts（プレビュー側）**（動的import・デバウンス・キャッシュ・エラー時の前回表示維持）
1. **HTML出力へのSVG埋め込み**（exporter.tsとの結合。プログレス表示）
1. **.mmd対応**（fileType分岐・プレビュー分岐・保存）
1. **tauri.conf.json更新**（.mmd関連付け・CSP調整）→ `npm run tauri build` で結合確認

ステップ6完了時点で一度リリース可能（F1+F2のみのv1.1-beta）。Mermaid系（7〜9）は独立性が高いので、品質が安定するまで切り離して進められる。

-----

## 6. リスクと対策

|リスク                                |影響             |対策                                                                             |
|-----------------------------------|---------------|-------------------------------------------------------------------------------|
|mermaidのバンドルサイズ（1MB超）              |起動・初回プレビューの体感低下|動的importで初回検出時のみロード。ロード中はブロックにスピナー表示                                           |
|TauriのCSPがmermaidのインラインstyle/SVGを拒否|図が描画されない       |CSPに `style-src 'unsafe-inline'` `img-src data: blob:` を追加。影響範囲を確認のうえ最小限の緩和に留める|
|入力途中のMermaid文法エラーで図が消える            |プレビューのガタつき     |前回成功SVGの表示維持＋エラーインジケータ（3.3.2）                                                  |
|window.print()がプレビュー外の要素を巻き込む      |印刷結果にUIが混入     |print.cssで明示的に非表示指定。ビルド版で必ず実機確認（dev環境とWebView2の挙動差に注意）                         |
|巨大なコードブロック・表の改ページ崩れ                |PDFの見栄え低下      |break-inside: avoidで基本制御し、1ページ超は仕様として許容（3.2.3）                                 |
|設定JSONの破損・旧バージョン                   |起動時エラー         |バリデーション＋デフォルトフォールバック＋versionキーによる将来のマイグレーション余地（4.3）                            |
|パイプライン共通化リファクタリングの回帰               |既存プレビューの不具合    |ステップ5の前にプレビューの挙動を手動テスト項目化し、リファクタ後に同項目で再確認                                      |

-----

## 7. 完了チェックリスト（v1.1）

### F1: HTML出力

- [ ] Ctrl+Eで保存ダイアログが開き、単体HTMLが出力される
- [ ] 出力HTMLがオフライン・スクリプト無効環境でも正しく表示される
- [ ] 目次・コールアウト・見出し番号・表スタイルが設定通りに反映される
- [ ] シンタックスハイライトが選択テーマで適用される

### F2: PDF出力

- [ ] Ctrl+Pで印刷ダイアログが開き、プレビュー内容のみが印刷対象になる
- [ ] A4で見出しの孤立・表とコードの分断が起きない（通常サイズの範囲で）
- [ ] Microsoft Print to PDFでの出力結果がプレビューの見た目と一致する

### F3: Mermaid

- [ ] ```mermaid ブロックがプレビューで図として描画される
- [ ] 入力途中の文法エラーで図が消えず、前回表示が維持される
- [ ] 図のないmdファイルでmermaidがロードされない（DevToolsのNetworkで確認）
- [ ] HTML出力にSVGとして埋め込まれ、出力先で表示される

### F4: .mmd

- [ ] .mmdのダブルクリックでアプリが起動し、図がプレビューされる
- [ ] .mmdの編集・保存・HTML出力・印刷が一通り動作する
- [ ] mdタブと.mmdタブの混在時にプレビュー切替が正しく動作する

### テーマ設定

- [ ] 設定モーダルの変更が即時プレビューに反映される
- [ ] 保存後にアプリ再起動しても設定が維持される
- [ ] settings.jsonを削除・破損させてもデフォルトで正常起動する
- [ ] プレビュー・HTML出力・PDF印刷の3経路で見た目が一致する