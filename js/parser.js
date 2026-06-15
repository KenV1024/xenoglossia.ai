// ファイル読込（txt/docx/pdf）と、日英混在テキストからの言語抽出・対訳ペア検出
const Parser = {

  // ---- ファイル読込 ----
  async readFile(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.text')) {
      return this.readTxt(file);
    }
    if (name.endsWith('.docx')) {
      return this.readDocx(file);
    }
    if (name.endsWith('.pdf')) {
      return this.readPdf(file);
    }
    if (name.endsWith('.doc')) {
      throw new Error('旧形式の .doc は読み込めません。Wordで .docx として保存し直してください。');
    }
    throw new Error('対応形式は txt / docx / PDF です。');
  },

  // UTF-8で読めなければ Shift-JIS にフォールバック（日本語Windowsのメモ帳・Excel出力対策）
  async readTxt(file) {
    const buf = await file.arrayBuffer();
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch {
      try {
        return new TextDecoder('shift_jis').decode(buf);
      } catch {
        return new TextDecoder('utf-8').decode(buf); // 最終手段（化けは許容）
      }
    }
  },

  async readDocx(file) {
    const buf = await file.arrayBuffer();
    const result = await window.mammoth.extractRawText({ arrayBuffer: buf });
    return result.value || '';
  },

  async readPdf(file) {
    const lib = window.pdfjsLib;
    lib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
    const buf = await file.arrayBuffer();
    const pdf = await lib.getDocument({ data: buf }).promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      // 行のY座標が変わったら改行扱いにする
      let lastY = null;
      let line = [];
      const lines = [];
      for (const item of content.items) {
        const y = item.transform ? item.transform[5] : null;
        if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) {
          lines.push(line.join(''));
          line = [];
        }
        line.push(item.str);
        if (y !== null) lastY = y;
      }
      if (line.length) lines.push(line.join(''));
      pages.push(lines.join('\n'));
    }
    return pages.join('\n\n');
  },

  // ---- 言語判定 ----
  lineLang(line) {
    const ja = (line.match(/[぀-ヿㇰ-ㇿ一-鿿々〆〤]/g) || []).length;
    const en = (line.match(/[A-Za-z]/g) || []).length;
    if (ja >= 1 && ja * 4 >= en) return 'ja';   // 日本語文中の英単語・数字は許容
    if (en >= 2) return 'en';
    return 'other';                               // 数字だけの行など → 直前の言語に追従
  },

  // ---- 抽出のメイン ----
  // 戻り値: { ja: [para...], en: [para...], paired: bool }
  extract(rawText) {
    const lines = rawText.replace(/\r\n?/g, '\n').split('\n').map(l => l.trim());

    // 1) 行ごとに言語を割り当て（otherは直前の言語を継承）
    const tagged = [];
    let prevLang = null;
    for (const line of lines) {
      if (!line) { tagged.push({ line: '', lang: 'blank' }); continue; }
      let lang = this.lineLang(line);
      if (lang === 'other') lang = prevLang || 'other';
      tagged.push({ line, lang });
      if (lang === 'ja' || lang === 'en') prevLang = lang;
    }

    // 2) 同一言語の連続行を「ブロック」にまとめる（空行・言語切替で区切る）
    const blocks = [];
    let cur = null;
    for (const t of tagged) {
      if (t.lang === 'blank') { if (cur) { blocks.push(cur); cur = null; } continue; }
      if (cur && cur.lang === t.lang) {
        cur.lines.push(t.line);
      } else {
        if (cur) blocks.push(cur);
        cur = { lang: t.lang, lines: [t.line] };
      }
    }
    if (cur) blocks.push(cur);

    // 3) ブロック内をパラグラフに分割
    const ja = [];
    const en = [];
    for (const block of blocks) {
      if (block.lang !== 'ja' && block.lang !== 'en') continue;
      const paras = this.splitBlockIntoParagraphs(block);
      for (const p of paras) {
        if (!this.isSentenceContent(p, block.lang)) continue; // 単語リスト・見出しを除外
        (block.lang === 'ja' ? ja : en).push(p);
      }
    }

    let paired = ja.length > 0 && ja.length === en.length;

    // 段落数が合わない場合、文字量の比率で多い側を併合して対訳ペアを復元する
    // （折返し幅と文末がたまたま一致した行での誤分割を吸収する）
    if (!paired && ja.length && en.length) {
      const fixed = this.reconcile(ja, en);
      if (fixed) {
        return { ja: fixed.ja, en: fixed.en, paired: true };
      }
    }
    return { ja, en, paired };
  },

  reconcile(ja, en) {
    let big, small, bigLang;
    if (ja.length > en.length) { big = ja; small = en; bigLang = 'ja'; }
    else if (en.length > ja.length) { big = en; small = ja; bigLang = 'en'; }
    else return null;
    if (small.length < 1 || big.length > small.length + 5) return null;

    // 少ない側の累積文字比率を目標に、多い側の併合位置を選ぶ
    const totalS = small.reduce((s, p) => s + p.length, 0);
    let cum = 0;
    const targets = small.slice(0, -1).map(p => (cum += p.length) / totalS);

    const totalB = big.reduce((s, p) => s + p.length, 0);
    const cumB = [];
    let c = 0;
    for (const p of big) { c += p.length; cumB.push(c / totalB); }

    const breaks = [];
    let start = 0;
    for (let t = 0; t < targets.length; t++) {
      const remaining = targets.length - t - 1;
      let best = -1, bestDiff = Infinity;
      for (let i = start; i < big.length - 1 - remaining; i++) {
        const d = Math.abs(cumB[i] - targets[t]);
        if (d < bestDiff) { bestDiff = d; best = i; }
      }
      if (best === -1) return null;
      breaks.push(best);
      start = best + 1;
    }

    const join = bigLang === 'ja' ? '' : ' ';
    const merged = [];
    let from = 0;
    for (const b of breaks) {
      merged.push(big.slice(from, b + 1).join(join));
      from = b + 1;
    }
    merged.push(big.slice(from).join(join));

    return bigLang === 'ja' ? { ja: merged, en: small } : { ja: small, en: merged };
  },

  // パラグラフ境界の推定:
  // - 行の大半が文末記号で終わる → 1行=1パラグラフのテキスト（折返しなし）
  // - それ以外 → 固定幅で折り返されたテキスト。「文末記号で終わり、かつ
  //   折返し幅（=ブロック内の最長行）より短い」行をパラグラフ末尾とみなす
  splitBlockIntoParagraphs(block) {
    const lines = block.lines;
    const isJa = block.lang === 'ja';
    const joiner = isJa ? '' : ' ';
    const endRe = isJa ? /[。．！？!?」』]$/ : /[.!?"”')]$/;

    const endCount = lines.filter(l => endRe.test(l)).length;
    const perLineMode = lines.length > 0 && endCount / lines.length > 0.6;

    const maxLen = Math.max(...lines.map(l => l.length), 0);

    const paras = [];
    let buf = [];
    lines.forEach((line, i) => {
      buf.push(line);
      const isLast = i === lines.length - 1;
      const endsSentence = endRe.test(line);
      const isBreak = perLineMode
        ? endsSentence
        : (endsSentence && line.length < maxLen);
      if (isLast || isBreak) {
        const text = buf.join(joiner).trim();
        if (text) paras.push(text);
        buf = [];
      }
    });
    return paras;
  },

  // 「文章」かどうか: 文末記号を含み、文あたりの長さが十分あること
  // （単語帳・見出し・箇条書きの単語リストを練習対象から外す）
  isSentenceContent(text, lang) {
    if (lang === 'ja') {
      if (!/[。！？!?]/.test(text)) return false;
      const sentences = text.split(/[。！？!?]/).filter(s => s.trim());
      if (!sentences.length) return false;
      const avg = sentences.reduce((a, s) => a + s.length, 0) / sentences.length;
      return avg >= 10;
    }
    if (!/[.!?]/.test(text)) return false;
    const sentences = text.split(/[.!?]/).filter(s => s.trim());
    if (!sentences.length) return false;
    const avgWords = sentences.reduce((a, s) => a + s.trim().split(/\s+/).length, 0) / sentences.length;
    return avgWords >= 4;
  }
};
