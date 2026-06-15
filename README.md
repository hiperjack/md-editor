# mdedit

**軽量・無料・オープンソースの WYSIWYG Markdown エディタ。**
書式が反映されたまま編集でき、Mermaid 図のインラインプレビューと「見たまま」の HTML 出力に対応します。有料化した Typora の代替を探している人にも向いています。

![GitHub release](https://img.shields.io/github/v/release/hiperjack/md-editor)
![License](https://img.shields.io/github/license/hiperjack/md-editor)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)

<!-- 最重要: 起動〜編集の様子が伝わる GIF を 1 枚（docs/assets/demo.gif） -->
![mdedit のデモ](./docs/assets/demo.gif)

## mdedit とは

Markdown を「記号を見ながら書く」のではなく、**仕上がりの見た目のまま編集できる**デスクトップアプリです。プレビュー用の別ペインを行き来する必要がなく、書いたものがそのまま文書になります。Mermaid による図、HTML やPDFへの書き出し、複数ウィンドウ・タブでの作業にも対応しています。

## なぜ mdedit か

- **書いたまま見える** — 太字や見出し、リストが反映された状態で直接編集できます（WYSIWYG）。プレビューの往復が不要です。
- **図がそのまま描ける** — コードに書いた Mermaid がリアルタイムで図になり、クリックで拡大できます。図だけのファイル（`.mmd` / `.mermaid`）も開けます。
- **見たまま出力できる** — 編集画面とまったく同じ見た目で HTML に書き出し、PDF にも印刷できます。
- **軽くて速い** — Tauri 製のため、インストーラが小さく起動も軽快です。
- **日本語で使える** — 日本語・英語に対応し、ダーク／ライトのテーマを切り替えられます。

## スクリーンショット

| WYSIWYG 編集 | Mermaid プレビュー | HTML 出力 |
|---|---|---|
| ![編集画面](./docs/assets/edit.png) | ![Mermaid プレビュー](./docs/assets/mermaid.png) | ![HTML 出力](./docs/assets/export.png) |

## ダウンロード

最新版は [Releases](https://github.com/hiperjack/md-editor/releases) から入手できます。

| OS | 形式 |
|---|---|
| Windows | `.msi` または `.exe`（インストーラ） |
| macOS | `.dmg` |
| Linux | `.AppImage` または `.deb` |

> **Windows で警告が出る場合:** 現在のビルドはコード署名をしていないため、起動時に「Windows によって PC が保護されました」と表示されることがあります。［詳細情報］→［実行］で起動できます（署名証明書の導入は検討中です）。

> **macOS で「壊れているため開けません」と出る場合:** アドホック署名のため、初回は Finder でアプリを右クリック →［開く］で起動してください。

## 使い方の基本

- `.md` / `.markdown` ファイルをダブルクリックすると、エディタの新しいタブで開きます。
- `.mmd` / `.mermaid` ファイルは図として開き、保存時に元のソース形式へ戻します。
- `.html` ファイルは、読み取り専用のプレビュータブで表示します。
- タブはドラッグで並べ替えられ、ウィンドウの外へ出すと別ウィンドウになります。

## よく使うショートカット

| ショートカット | 動作 |
|---|---|
| `Ctrl+N` / `Ctrl+O` / `Ctrl+S` | 新規タブ / 開く / 保存 |
| `Ctrl+Shift+E` | HTML として出力 |
| `Ctrl+Shift+V` | HTML プレビュータブを開く |
| `Ctrl+P` | 印刷（PDF 保存も可能） |
| `Ctrl+F` / `Ctrl+H` | 検索 / 置換 |
| `Ctrl+Shift+O` | 見出しアウトラインの表示切替 |
| `Ctrl+B` / `Ctrl+I` / `Ctrl+K` | 太字 / 斜体 / リンク |
| `Ctrl+,` | 設定を開く |

全ショートカットの一覧は [docs/architecture.md](./docs/architecture.md) を参照してください。

## ソースからビルドする

**必要なもの:** Node.js 18 以上、Rust（[Tauri の前提条件](https://v2.tauri.app/start/prerequisites/)を参照）。

```bash
# 依存パッケージのインストール
npm install

# 開発モードで起動
npm run tauri:dev

# インストーラを生成
npm run tauri:build
```

## 技術スタック

| 層 | 採用技術 |
|---|---|
| デスクトップ基盤 | Tauri 2.x（Rust） |
| フロントエンド | Vite + TypeScript（UI フレームワーク不使用） |
| エディタ | Milkdown Crepe（ProseMirror 系 WYSIWYG） |
| 図 | Mermaid |

設計の詳細・内部実装・ディレクトリ構成・全ショートカット一覧は [docs/architecture.md](./docs/architecture.md) にまとめています。

## ライセンス

[MIT License](./LICENSE)
