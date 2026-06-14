import { settings, FONT_PRESETS, type Theme, type LangSetting } from "./settings";
import {
  docTheme,
  validateDocSettings,
  DEFAULT_DOC_SETTINGS,
  DOC_FONT_PRESETS,
  docThemeCssVars,
  docModifierClasses,
  type DocSettings,
  type DocFontId,
  type HeadingStyle,
  type HighlightTheme,
  type MermaidColorScheme,
} from "./theme";
import { renderDocumentBody } from "./render-pipeline";
import { ensureDocumentStyles, setHljsThemeStyle } from "./doc-styles";
import { onLangChange, t } from "./i18n";

type SectionKey = "font" | "display" | "docTheme" | "language";

export function openFontSettings(): Promise<void> {
  return new Promise((resolve) => {
    const root = document.getElementById("modal-root");
    if (!root) {
      resolve();
      return;
    }
    // 既に設定ダイアログが開いていれば二重に開かない
    // （メニュー accelerator とフロントの Ctrl+, が両方発火しても1つに保つ）。
    if (root.querySelector(".settings-dialog")) {
      resolve();
      return;
    }

    const before = settings.get();
    // 編集中の値（Apply時に確定）
    const draft = {
      fontFamily: before.fontFamily,
      codeFontFamily: before.codeFontFamily,
      codeFontColor: before.codeFontColor,
      fontSize: before.fontSize,
      showRecent: before.showRecent,
      lang: before.lang as LangSetting,
      theme: before.theme as Theme,
    };
    // 文書テーマ（HTML出力・印刷用）のドラフト。Applyで永続化、Cancelで破棄。
    const docDraft: DocSettings = docTheme.get();
    // プレビューでライブ反映した文書テーマを、キャンセル時に戻すための初期値。
    const beforeDoc: DocSettings = docTheme.get();

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";

    const dialog = document.createElement("div");
    dialog.className = "modal-dialog settings-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");

    const title = document.createElement("div");
    title.className = "modal-title";
    title.textContent = t("settings.title");
    dialog.appendChild(title);

    // ── レイアウト：左ナビ + 右パネル ────────────────────
    const layout = document.createElement("div");
    layout.className = "settings-layout";

    const nav = document.createElement("div");
    nav.className = "settings-nav";

    const panelHost = document.createElement("div");
    panelHost.className = "settings-panel";

    layout.appendChild(nav);
    layout.appendChild(panelHost);
    dialog.appendChild(layout);

    const sections: { key: SectionKey; labelKey: string }[] = [
      { key: "font", labelKey: "settings.section.font" },
      { key: "display", labelKey: "settings.section.display" },
      { key: "docTheme", labelKey: "settings.section.docTheme" },
      { key: "language", labelKey: "settings.section.language" },
    ];

    let active: SectionKey = "font";
    const navButtons = new Map<SectionKey, HTMLElement>();

    const renderActive = () => {
      panelHost.innerHTML = "";
      panelHost.appendChild(buildPanel(active));
      for (const [k, btn] of navButtons) {
        btn.classList.toggle("active", k === active);
      }
    };

    for (const s of sections) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "settings-nav-item";
      btn.textContent = t(s.labelKey);
      btn.addEventListener("click", () => {
        active = s.key;
        renderActive();
      });
      navButtons.set(s.key, btn);
      nav.appendChild(btn);
    }

    function buildPanel(key: SectionKey): HTMLElement {
      const wrap = document.createElement("div");
      wrap.className = "settings-panel-body";
      if (key === "font") wrap.appendChild(buildFontPanel());
      else if (key === "display") wrap.appendChild(buildDisplayPanel());
      else if (key === "docTheme") wrap.appendChild(buildDocThemePanel());
      else wrap.appendChild(buildLanguagePanel());
      return wrap;
    }

    function buildFontPanel(): HTMLElement {
      const c = document.createElement("div");

      // 本文フォント
      const fontRow = document.createElement("label");
      fontRow.className = "settings-row";
      const fontSpan = document.createElement("span");
      fontSpan.textContent = t("settings.font.family");
      fontRow.appendChild(fontSpan);
      const fontSelect = buildFontSelect(draft.fontFamily);
      fontSelect.addEventListener("change", () => {
        draft.fontFamily = fontSelect.value;
        updatePreview();
      });
      fontRow.appendChild(fontSelect);
      c.appendChild(fontRow);

      // コード用フォント
      const codeFontRow = document.createElement("label");
      codeFontRow.className = "settings-row";
      const codeFontSpan = document.createElement("span");
      codeFontSpan.textContent = t("settings.font.codeFamily");
      codeFontRow.appendChild(codeFontSpan);
      const codeFontSelect = buildFontSelect(draft.codeFontFamily);
      codeFontSelect.addEventListener("change", () => {
        draft.codeFontFamily = codeFontSelect.value;
        updatePreview();
      });
      codeFontRow.appendChild(codeFontSelect);
      c.appendChild(codeFontRow);

      // コード文字色
      const codeColorRow = document.createElement("label");
      codeColorRow.className = "settings-row";
      const codeColorSpan = document.createElement("span");
      codeColorSpan.textContent = t("settings.font.codeColor");
      codeColorRow.appendChild(codeColorSpan);
      const codeColorWrap = document.createElement("div");
      codeColorWrap.className = "settings-color-wrap";
      const codeColorFollow = document.createElement("input");
      codeColorFollow.type = "checkbox";
      codeColorFollow.checked = !draft.codeFontColor;
      const codeColorFollowLabel = document.createElement("label");
      codeColorFollowLabel.className = "settings-color-follow";
      codeColorFollowLabel.appendChild(codeColorFollow);
      const codeColorFollowText = document.createElement("span");
      codeColorFollowText.textContent = t("settings.font.codeColorFollow");
      codeColorFollowLabel.appendChild(codeColorFollowText);
      const codeColorInput = document.createElement("input");
      codeColorInput.type = "color";
      codeColorInput.className = "settings-color-input";
      // type=color は #rrggbb を要求するため、空ならフォールバック値を入れておく。
      // アプリアイコンに合わせた青系をデフォルトにする。
      codeColorInput.value = draft.codeFontColor || "#1d4ed8";
      codeColorInput.disabled = codeColorFollow.checked;
      codeColorFollow.addEventListener("change", () => {
        codeColorInput.disabled = codeColorFollow.checked;
        draft.codeFontColor = codeColorFollow.checked ? "" : codeColorInput.value;
        updatePreview();
      });
      codeColorInput.addEventListener("input", () => {
        if (!codeColorFollow.checked) {
          draft.codeFontColor = codeColorInput.value;
          updatePreview();
        }
      });
      codeColorWrap.appendChild(codeColorFollowLabel);
      codeColorWrap.appendChild(codeColorInput);
      codeColorRow.appendChild(codeColorWrap);
      c.appendChild(codeColorRow);

      // 文字サイズ
      const sizeRow = document.createElement("label");
      sizeRow.className = "settings-row";
      const sizeSpan = document.createElement("span");
      sizeSpan.textContent = t("settings.font.size");
      sizeRow.appendChild(sizeSpan);
      const sizeInput = document.createElement("input");
      sizeInput.type = "number";
      sizeInput.min = "8";
      sizeInput.max = "48";
      sizeInput.step = "1";
      sizeInput.value = String(draft.fontSize);
      sizeInput.className = "settings-input";
      sizeInput.addEventListener("input", () => {
        const n = parseInt(sizeInput.value, 10);
        if (Number.isFinite(n)) draft.fontSize = n;
        updatePreview();
      });
      sizeRow.appendChild(sizeInput);
      c.appendChild(sizeRow);

      // 本文プレビュー
      const preview = document.createElement("div");
      preview.className = "settings-preview";
      preview.textContent = t("settings.font.preview");
      c.appendChild(preview);

      // コードプレビュー
      const codePreview = document.createElement("div");
      codePreview.className = "settings-preview";
      codePreview.textContent = t("settings.font.codePreview");
      c.appendChild(codePreview);

      function updatePreview() {
        preview.style.fontFamily = draft.fontFamily;
        preview.style.fontSize = `${draft.fontSize}px`;
        codePreview.style.fontFamily = draft.codeFontFamily;
        codePreview.style.fontSize = `${draft.fontSize}px`;
        codePreview.style.color = draft.codeFontColor || "";
      }
      updatePreview();

      return c;
    }

    /** プリセット一覧 + 既存値が一致しなければ「カスタム」項目を頭に挿入したselect。 */
    function buildFontSelect(currentValue: string): HTMLSelectElement {
      const sel = document.createElement("select");
      sel.className = "settings-input";
      let matched = false;
      for (const preset of FONT_PRESETS) {
        const opt = document.createElement("option");
        opt.value = preset.value;
        opt.textContent = t(preset.labelKey);
        if (preset.value === currentValue) {
          opt.selected = true;
          matched = true;
        }
        sel.appendChild(opt);
      }
      if (!matched) {
        const opt = document.createElement("option");
        opt.value = currentValue;
        opt.textContent = t("settings.font.custom").replace(
          "{value}",
          currentValue,
        );
        opt.selected = true;
        sel.insertBefore(opt, sel.firstChild);
      }
      return sel;
    }

    function buildDisplayPanel(): HTMLElement {
      const c = document.createElement("div");

      // テーマ
      const themeRow = document.createElement("label");
      themeRow.className = "settings-row";
      const themeSpan = document.createElement("span");
      themeSpan.textContent = t("settings.display.theme");
      themeRow.appendChild(themeSpan);
      const themeSelect = document.createElement("select");
      themeSelect.className = "settings-input";
      const themeOptions: { value: Theme; labelKey: string }[] = [
        { value: "system", labelKey: "settings.display.theme.system" },
        { value: "dark", labelKey: "settings.display.theme.dark" },
        { value: "light", labelKey: "settings.display.theme.light" },
      ];
      for (const opt of themeOptions) {
        const o = document.createElement("option");
        o.value = opt.value;
        o.textContent = t(opt.labelKey);
        if (opt.value === draft.theme) o.selected = true;
        themeSelect.appendChild(o);
      }
      themeSelect.addEventListener("change", () => {
        draft.theme = themeSelect.value as Theme;
      });
      themeRow.appendChild(themeSelect);
      c.appendChild(themeRow);

      // 最近使ったファイル
      const row = document.createElement("label");
      row.className = "settings-row settings-row-checkbox";
      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = draft.showRecent;
      check.className = "settings-input";
      check.addEventListener("change", () => {
        draft.showRecent = check.checked;
      });
      const text = document.createElement("span");
      text.textContent = t("settings.display.showRecent");
      row.appendChild(check);
      row.appendChild(text);
      c.appendChild(row);

      // ── Mermaid 設定 ────────────────────────────────────
      const mermaidHeading = document.createElement("div");
      mermaidHeading.className = "settings-subheading";
      mermaidHeading.textContent = t("settings.section.mermaid");
      c.appendChild(mermaidHeading);

      const mermaidNote = document.createElement("div");
      mermaidNote.className = "settings-note";
      mermaidNote.textContent = t("mermaid.note");
      c.appendChild(mermaidNote);

      // 配色セレクト（個別指定）。先に生成して、チェックボックスから enable/disable する。
      const mermaidRow = document.createElement("label");
      mermaidRow.className = "settings-row";
      const mermaidSpan = document.createElement("span");
      mermaidSpan.textContent = t("mermaid.theme");
      mermaidRow.appendChild(mermaidSpan);
      const mermaidSelect = document.createElement("select");
      mermaidSelect.className = "settings-input";
      const mermaidOptions: { value: MermaidColorScheme; labelKey: string }[] = [
        { value: "system", labelKey: "mermaid.theme.system" },
        { value: "light", labelKey: "mermaid.theme.light" },
        { value: "dark", labelKey: "mermaid.theme.dark" },
      ];
      for (const opt of mermaidOptions) {
        const o = document.createElement("option");
        o.value = opt.value;
        o.textContent = t(opt.labelKey);
        if (opt.value === docDraft.theme.mermaidTheme) o.selected = true;
        mermaidSelect.appendChild(o);
      }
      mermaidSelect.addEventListener("change", () => {
        docDraft.theme.mermaidTheme = mermaidSelect.value as MermaidColorScheme;
      });

      // 「表示テーマに揃える」チェックボックス（既定ON）。ONのときは個別セレクトを無効化。
      const followRow = document.createElement("label");
      followRow.className = "settings-row settings-row-checkbox";
      const follow = document.createElement("input");
      follow.type = "checkbox";
      follow.className = "settings-input";
      follow.checked = docDraft.theme.mermaidFollowApp;
      const followText = document.createElement("span");
      followText.textContent = t("mermaid.followApp");
      follow.addEventListener("change", () => {
        docDraft.theme.mermaidFollowApp = follow.checked;
        mermaidSelect.disabled = follow.checked;
      });
      followRow.appendChild(follow);
      followRow.appendChild(followText);
      c.appendChild(followRow);

      mermaidSelect.disabled = docDraft.theme.mermaidFollowApp;
      mermaidRow.appendChild(mermaidSelect);
      c.appendChild(mermaidRow);

      // 「コードを既定で隠す」チェックボックス（既定ON）
      const collapseRow = document.createElement("label");
      collapseRow.className = "settings-row settings-row-checkbox";
      const collapse = document.createElement("input");
      collapse.type = "checkbox";
      collapse.className = "settings-input";
      collapse.checked = docDraft.theme.mermaidCollapsed;
      const collapseText = document.createElement("span");
      collapseText.textContent = t("mermaid.collapse");
      collapse.addEventListener("change", () => {
        docDraft.theme.mermaidCollapsed = collapse.checked;
      });
      collapseRow.appendChild(collapse);
      collapseRow.appendChild(collapseText);
      c.appendChild(collapseRow);

      return c;
    }

    /**
     * 文書テーマ（HTML出力・PDF印刷の見た目）設定パネル。
     * 変更は即座にパネル下部のサンプルプレビューへ反映する。
     * 実際のレンダリングパイプライン（render-pipeline.ts）でサンプルを
     * 描画するため、出力と同じ見た目が保証される。
     */
    function buildDocThemePanel(): HTMLElement {
      const c = document.createElement("div");

      const note = document.createElement("div");
      note.className = "settings-note";
      note.textContent = t("docTheme.note");
      c.appendChild(note);

      const addSelectRow = (
        label: string,
        options: { value: string; label: string }[],
        current: string,
        onChange: (v: string) => void,
      ) => {
        const row = document.createElement("label");
        row.className = "settings-row";
        const span = document.createElement("span");
        span.textContent = label;
        row.appendChild(span);
        const sel = document.createElement("select");
        sel.className = "settings-input";
        for (const opt of options) {
          const o = document.createElement("option");
          o.value = opt.value;
          o.textContent = opt.label;
          if (opt.value === current) o.selected = true;
          sel.appendChild(o);
        }
        sel.addEventListener("change", () => onChange(sel.value));
        row.appendChild(sel);
        c.appendChild(row);
      };

      const addNumberRow = (
        label: string,
        min: number,
        max: number,
        step: number,
        current: number,
        onChange: (v: number) => void,
      ) => {
        const row = document.createElement("label");
        row.className = "settings-row";
        const span = document.createElement("span");
        span.textContent = label;
        row.appendChild(span);
        const input = document.createElement("input");
        input.type = "number";
        input.min = String(min);
        input.max = String(max);
        input.step = String(step);
        input.value = String(current);
        input.className = "settings-input";
        input.addEventListener("input", () => {
          const n = parseFloat(input.value);
          if (Number.isFinite(n)) onChange(n);
        });
        row.appendChild(input);
        c.appendChild(row);
      };

      const addColorRow = (
        label: string,
        current: string,
        onChange: (v: string) => void,
      ) => {
        const row = document.createElement("label");
        row.className = "settings-row";
        const span = document.createElement("span");
        span.textContent = label;
        row.appendChild(span);
        const input = document.createElement("input");
        input.type = "color";
        input.className = "settings-color-input";
        input.value = current;
        input.addEventListener("input", () => onChange(input.value));
        row.appendChild(input);
        c.appendChild(row);
      };

      const addCheckRow = (
        label: string,
        current: boolean,
        onChange: (v: boolean) => void,
      ) => {
        const row = document.createElement("label");
        row.className = "settings-row settings-row-checkbox";
        const check = document.createElement("input");
        check.type = "checkbox";
        check.checked = current;
        check.className = "settings-input";
        check.addEventListener("change", () => onChange(check.checked));
        const text = document.createElement("span");
        text.textContent = label;
        row.appendChild(check);
        row.appendChild(text);
        c.appendChild(row);
      };

      addSelectRow(
        t("docTheme.font.family"),
        DOC_FONT_PRESETS.map((p) => ({ value: p.id, label: t(p.labelKey) })),
        docDraft.theme.fontFamily,
        (v) => {
          docDraft.theme.fontFamily = v as DocFontId;
          updateSample();
        },
      );
      addNumberRow(t("docTheme.fontSize"), 12, 20, 1, docDraft.theme.fontSize, (n) => {
        docDraft.theme.fontSize = n;
        updateSample();
      });
      addNumberRow(
        t("docTheme.lineHeight"),
        1.4,
        2.0,
        0.1,
        docDraft.theme.lineHeight,
        (n) => {
          docDraft.theme.lineHeight = n;
          updateSample();
        },
      );
      addColorRow(t("docTheme.accent"), docDraft.theme.accentColor, (v) => {
        docDraft.theme.accentColor = v;
        updateSample();
      });
      addColorRow(t("docTheme.textColor"), docDraft.theme.textColor, (v) => {
        docDraft.theme.textColor = v;
        updateSample();
      });
      addColorRow(t("docTheme.bgColor"), docDraft.theme.bgColor, (v) => {
        docDraft.theme.bgColor = v;
        updateSample();
      });
      addSelectRow(
        t("docTheme.headingStyle"),
        [
          { value: "none", label: t("docTheme.headingStyle.none") },
          { value: "underline", label: t("docTheme.headingStyle.underline") },
          { value: "left-border", label: t("docTheme.headingStyle.leftBorder") },
        ],
        docDraft.theme.headingStyle,
        (v) => {
          docDraft.theme.headingStyle = v as HeadingStyle;
          updateSample();
        },
      );
      addSelectRow(
        t("docTheme.highlight"),
        [
          { value: "github", label: "GitHub" },
          { value: "atom-one-dark", label: "Atom One Dark" },
          { value: "vs", label: "VS" },
        ],
        docDraft.theme.highlightTheme,
        (v) => {
          docDraft.theme.highlightTheme = v as HighlightTheme;
          updateSample();
        },
      );
      addCheckRow(t("docTheme.deco.autoToc"), docDraft.decorations.autoToc, (v) => {
        docDraft.decorations.autoToc = v;
        updateSample();
      });
      addCheckRow(
        t("docTheme.deco.headingNumbers"),
        docDraft.decorations.headingNumbers,
        (v) => {
          docDraft.decorations.headingNumbers = v;
          updateSample();
        },
      );
      addCheckRow(t("docTheme.deco.callouts"), docDraft.decorations.callouts, (v) => {
        docDraft.decorations.callouts = v;
        updateSample();
      });
      addCheckRow(
        t("docTheme.deco.stripedTables"),
        docDraft.decorations.stripedTables,
        (v) => {
          docDraft.decorations.stripedTables = v;
          updateSample();
        },
      );

      const sampleWrap = document.createElement("div");
      sampleWrap.className = "doc-sample-preview";
      const sampleHost = document.createElement("div");
      sampleWrap.appendChild(sampleHost);
      c.appendChild(sampleWrap);

      // 非同期レンダリングの追い越し防止用シーケンス
      let sampleSeq = 0;
      function updateSample(): void {
        const seq = ++sampleSeq;
        const s = validateDocSettings(docDraft);
        ensureDocumentStyles();
        setHljsThemeStyle(s.theme.highlightTheme);
        void renderDocumentBody(t("docTheme.sampleMd"), s)
          .then((body) => {
            if (seq !== sampleSeq) return;
            sampleHost.className = ["document", ...docModifierClasses(s)].join(" ");
            sampleHost.setAttribute("style", docThemeCssVars(s.theme));
            sampleHost.replaceChildren(...Array.from(body.childNodes));
          })
          .catch((e) => console.warn("doc sample render failed:", e));
      }
      updateSample();

      return c;
    }

    function buildLanguagePanel(): HTMLElement {
      const c = document.createElement("div");

      const row = document.createElement("label");
      row.className = "settings-row";
      const span = document.createElement("span");
      span.textContent = t("settings.language.select");
      row.appendChild(span);
      const select = document.createElement("select");
      select.className = "settings-input";
      // "system" は実OS表示言語に追従（ja で始まれば日本語、それ以外は英語）
      const langOptions: { value: LangSetting; label: string }[] = [
        { value: "system", label: t("settings.language.system") },
        { value: "ja", label: "日本語" },
        { value: "en", label: "English" },
      ];
      for (const opt of langOptions) {
        const o = document.createElement("option");
        o.value = opt.value;
        o.textContent = opt.label;
        if (opt.value === draft.lang) o.selected = true;
        select.appendChild(o);
      }
      select.addEventListener("change", () => {
        draft.lang = select.value as LangSetting;
      });
      row.appendChild(select);
      c.appendChild(row);

      const note = document.createElement("div");
      note.className = "settings-note";
      note.textContent = t("settings.language.note");
      c.appendChild(note);

      return c;
    }

    renderActive();

    // ── ボタン群 ───────────────────────────────────────
    const btnRow = document.createElement("div");
    btnRow.className = "modal-buttons";

    const resetBtn = document.createElement("button");
    resetBtn.className = "modal-btn";
    resetBtn.textContent = t("settings.button.reset");
    resetBtn.addEventListener("click", () => {
      draft.fontFamily = FONT_PRESETS[0].value;
      draft.codeFontFamily = FONT_PRESETS[0].value;
      draft.codeFontColor = "";
      draft.fontSize = 15;
      draft.showRecent = true;
      draft.lang = "system";
      draft.theme = "system";
      const docDefaults = structuredClone(DEFAULT_DOC_SETTINGS);
      docDraft.theme = docDefaults.theme;
      docDraft.decorations = docDefaults.decorations;
      renderActive();
    });

    const previewBtn = document.createElement("button");
    previewBtn.className = "modal-btn";
    previewBtn.textContent = t("settings.button.preview");

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "modal-btn";
    cancelBtn.textContent = t("settings.button.cancel");

    const okBtn = document.createElement("button");
    okBtn.className = "modal-btn modal-btn-primary";
    okBtn.textContent = t("settings.button.apply");

    btnRow.appendChild(resetBtn);
    btnRow.appendChild(previewBtn);
    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(okBtn);
    dialog.appendChild(btnRow);

    overlay.appendChild(dialog);
    root.appendChild(overlay);

    /**
     * 言語が切り替わった時に、構築済みのテキスト要素を最新の翻訳に差し替える。
     * パネル内のラベル（フォント名、テーマ選択肢、ノート文等）は renderActive で
     * 再構築する。draftが真値なので入力中の値は失われない。
     */
    const refreshLabels = () => {
      title.textContent = t("settings.title");
      for (const [k, btn] of navButtons) {
        const sec = sections.find((s) => s.key === k);
        if (sec) btn.textContent = t(sec.labelKey);
      }
      resetBtn.textContent = t("settings.button.reset");
      previewBtn.textContent = t("settings.button.preview");
      cancelBtn.textContent = t("settings.button.cancel");
      okBtn.textContent = t("settings.button.apply");
      renderActive();
    };
    const unsubLang = onLangChange(refreshLabels);

    /**
     * draft / before の値を実際の settings ストアに流し込む。
     * Preview と Apply、および Cancel 時の rollback で共用する。
     */
    const applyToLive = (s: typeof draft) => {
      settings.setFontFamily(s.fontFamily);
      settings.setCodeFontFamily(s.codeFontFamily);
      settings.setCodeFontColor(s.codeFontColor);
      settings.setFontSize(s.fontSize);
      settings.setShowRecent(s.showRecent);
      settings.setLang(s.lang);
      settings.setTheme(s.theme);
    };

    /** Preview を1回でも押されたか。Cancel 時に before へ戻すかの判定に使う。 */
    let previewed = false;

    let resolved = false;
    const close = (committed: boolean) => {
      if (resolved) return;
      resolved = true;
      // Apply 経由でなく、かつ Preview でライブが書き換わっていれば before に戻す。
      if (!committed && previewed) {
        applyToLive({
          fontFamily: before.fontFamily,
          codeFontFamily: before.codeFontFamily,
          codeFontColor: before.codeFontColor,
          fontSize: before.fontSize,
          showRecent: before.showRecent,
          lang: before.lang,
          theme: before.theme,
        });
        // プレビューで反映した文書テーマ（Mermaid配色等）も元に戻す（保存しない）
        docTheme.previewLive(beforeDoc);
      }
      document.removeEventListener("keydown", onKey, true);
      unsubLang();
      overlay.remove();
      resolve();
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close(false);
      } else if (e.key === "Enter") {
        const tag = (document.activeElement as HTMLElement | null)?.tagName;
        if (tag === "INPUT" || tag === "SELECT") return;
        e.preventDefault();
        e.stopPropagation();
        apply();
      }
    };

    const apply = () => {
      applyToLive(draft);
      // 文書テーマはアプリUIに影響しないため、Applyでのみ永続化する
      void docTheme
        .save(validateDocSettings(docDraft))
        .catch((e) => console.error("docTheme.save failed:", e));
      close(true);
    };

    const preview = () => {
      applyToLive(draft);
      // 文書テーマ（Mermaid配色等）も保存せずライブ反映する（プレビューボタンの本来の役割）
      docTheme.previewLive(docDraft);
      previewed = true;
    };

    previewBtn.addEventListener("click", preview);
    cancelBtn.addEventListener("click", () => close(false));
    okBtn.addEventListener("click", apply);

    document.addEventListener("keydown", onKey, true);
    okBtn.focus();
  });
}
