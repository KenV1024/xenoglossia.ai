// 発音テクニックのルールエンジン（英語専用・オフライン動作）
// リンキング / t・d脱落 / フラップT / 同音融合 / hの弱化 / 定番短縮 / 文強勢 を
// スペリングから推定して可視化する。
const Phonics = {

  // ---- 語彙リスト ----
  // 弱く読む機能語（文強勢を置かない語）
  FUNCTION_WORDS: new Set([
    'a', 'an', 'the',
    'in', 'on', 'at', 'to', 'for', 'of', 'from', 'with', 'by', 'as', 'than', 'per', 'via',
    'i', 'you', 'he', 'she', 'it', 'we', 'they',
    'me', 'him', 'her', 'us', 'them',
    'my', 'your', 'his', 'its', 'our', 'their', 'mine', 'yours',
    'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'do', 'does', 'did', 'have', 'has', 'had',
    'will', 'would', 'can', 'could', 'shall', 'should', 'may', 'might', 'must',
    'and', 'or', 'but', 'so', 'if', 'that', 'because', 'when', 'while',
    'there', 'some', 'any'
  ]),

  // 否定・否定短縮形は機能語でも強く読む
  STRESSED_EXCEPTIONS: new Set([
    'not', 'no', 'never', 'none',
    "don't", "doesn't", "didn't", "isn't", "aren't", "wasn't", "weren't",
    "can't", "couldn't", "won't", "wouldn't", "shouldn't", "mustn't", "haven't", "hasn't", "hadn't"
  ]),

  // 語末が e でも母音音で終わる語
  VOWEL_FINAL_E: new Set(['the', 'be', 'he', 'she', 'we', 'me', 'maybe', 'recipe', 'coffee']),

  // 語末の文字は子音だが実際は母音音で終わる語（黙字）
  VOWEL_FINAL_SILENT: new Set(['though', 'through', 'thorough', 'dough', 'plough']),

  // 語頭 h が黙字（母音始まり扱い）
  SILENT_H: new Set(['hour', 'hours', 'honest', 'honestly', 'honor', 'honour', 'heir', 'heirs']),

  // 語頭が母音字でも子音音 /j/ /w/ で始まる語のプレフィックス
  CONSONANT_INITIAL_RE: /^(uni|use|usu|util|euro|ewe|one$|once$|ubiq)/,

  // 文中で h が弱化しやすい語
  H_WEAK_WORDS: new Set(['he', 'him', 'his', 'her', 'hers', 'have', 'has', 'had']),

  // 定番の短縮（2語）
  REDUCTIONS: {
    'want to': 'wanna', 'going to': 'gonna', 'got to': 'gotta',
    'have to': 'hafta', 'has to': 'hasta', 'kind of': 'kinda',
    'sort of': 'sorta', 'out of': 'outta', 'let me': 'lemme',
    'give me': 'gimme', "don't know": 'dunno'
  },

  VOWELS: 'aeiou',

  // ---- トークナイズ: 単語 + 前後の記号に分解 ----
  tokenize(text) {
    const tokens = [];
    const re = /\S+/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const raw = m[0];
      const wm = raw.match(/^([^A-Za-z']*)([A-Za-z][A-Za-z']*)?(.*)$/);
      tokens.push({
        raw,
        pre: wm[1] || '',
        word: wm[2] || '',
        post: wm[3] || '',
        w: (wm[2] || '').toLowerCase()
      });
    }
    return tokens;
  },

  // ---- 音の推定 ----
  // 語末が子音「音」か（スペリングからの推定）
  endsConsonantSound(w) {
    if (!w) return false;
    if (this.VOWEL_FINAL_E.has(w)) return false;
    if (this.VOWEL_FINAL_SILENT.has(w)) return false;
    const last = w[w.length - 1];
    if (last === 'y' || last === 'w') return false;          // day, now → 母音/滑音
    if (this.VOWELS.includes(last) && last !== 'e') return false; // sofa, go, menu
    if (last === 'e') {
      const prev = w[w.length - 2] || '';
      return !this.VOWELS.includes(prev);                    // make→/k/、see/blue→母音
    }
    return /[a-z]/.test(last);
  },

  // 語頭が母音「音」か
  startsVowelSound(w) {
    if (!w) return false;
    if (this.SILENT_H.has(w)) return true;                   // hour, honest
    const first = w[0];
    if (!this.VOWELS.includes(first)) return false;
    if (this.CONSONANT_INITIAL_RE.test(w)) return false;     // use, one, Europe
    return true;
  },

  isConsonantLetter(ch) {
    return /[a-z]/.test(ch) && !this.VOWELS.includes(ch);
  },

  // ---- 文強勢 ----
  isWeakWord(w) {
    if (this.STRESSED_EXCEPTIONS.has(w)) return false;
    if (w.endsWith("n't")) return false;
    return this.FUNCTION_WORDS.has(w);
  },

  // ---- メイン解析 ----
  // 戻り値: { tokens, links:[{i,type}], tips:[string] }
  //   tokens[i].stress / .weak / .dropFinal / .flapFinal / .weakH が描画用フラグ
  annotate(text) {
    const tokens = this.tokenize(text);
    const links = [];
    const tipCands = []; // {pri, text}

    for (const t of tokens) {
      if (!t.w) continue;
      t.weak = this.isWeakWord(t.w);
      t.stress = !t.weak;
    }

    for (let i = 0; i < tokens.length - 1; i++) {
      const a = tokens[i], b = tokens[i + 1];
      if (!a.w || !b.w) continue;
      if (/[,.!?;:、。]/.test(a.post)) continue; // 句読点をまたぐ連結はしない

      const pair = a.w + ' ' + b.w;

      // 1) 定番短縮（最優先・他の判定をスキップ）
      if (this.REDUCTIONS[pair]) {
        links.push({ i, type: 'link' });
        tipCands.push({ pri: 1, text: `「${a.w} ${b.w}」→ ネイティブは「${this.REDUCTIONS[pair]}」のように短く発音します` });
        continue;
      }

      const aEndsC = this.endsConsonantSound(a.w);
      const bStartsV = this.startsVowelSound(b.w);
      const aLast = a.w[a.w.length - 1];
      const bFirst = b.w[0];

      // 2) hの弱化: 文中の he/him/his/her/have など
      if (this.H_WEAK_WORDS.has(b.w) && aEndsC) {
        b.weakH = true;
        links.push({ i, type: 'link' });
        tipCands.push({ pri: 5, text: `「${b.w}」の h はほぼ聞こえなくなり、前の語とつながります（${a.w}‿${b.w.slice(1)}）` });
        continue;
      }

      // 3) フラップT: 母音(+r)+t で終わり、次が母音始まり → ラ行の音
      if (/[aeiour]t$/.test(a.w) && bStartsV) {
        a.flapFinal = true;
        links.push({ i, type: 'flap' });
        tipCands.push({ pri: 4, text: `「${a.w} ${b.w}」の t は日本語のラ行に近い軽い音になります（アメリカ英語）` });
        continue;
      }

      // 4) 同音融合: 語末と次語頭が同じ子音 → 1回だけ発音
      if (aEndsC && this.isConsonantLetter(bFirst) && aLast === bFirst) {
        a.dropFinal = true;
        links.push({ i, type: 'link' });
        tipCands.push({ pri: 3, text: `「${a.w} ${b.w}」は同じ音が続くので、${aLast} を1回だけ発音します` });
        continue;
      }

      // 5) t/d の脱落: 子音+t/d で終わり、次が子音始まり
      if (/[a-z][td]$/.test(a.w) && this.isConsonantLetter(a.w[a.w.length - 2]) &&
          !bStartsV && this.isConsonantLetter(bFirst)) {
        a.dropFinal = true;
        tipCands.push({ pri: 3, text: `「${a.w}(${aLast}) ${b.w}」の ${aLast} は飲み込むように消えます` });
        continue;
      }

      // 6) リンキング: 子音 → 母音
      if (aEndsC && bStartsV) {
        links.push({ i, type: 'link' });
        tipCands.push({ pri: 2, text: `「${a.w}‿${b.w}」子音+母音がつながり、1語のように発音します` });
      }
    }

    // 弱形のまとめ（優先度は最低・枠が余ったときだけ表示される）
    const weakList = tokens.filter(t => t.weak && t.w).map(t => t.w);
    if (weakList.length) {
      tipCands.push({ pri: 9, text: `グレーの語（${[...new Set(weakList)].slice(0, 4).join('・')}）は弱く短く。●の語を強く読むと英語のリズムが出ます` });
    }

    tipCands.sort((x, y) => x.pri - y.pri);
    const tips = [...new Set(tipCands.map(t => t.text))].slice(0, 4);

    return { tokens, links, tips };
  },

  // ---- HTML描画 ----
  // 戻り値: { html, tips }
  renderHTML(text) {
    const { tokens, links, tips } = this.annotate(text);
    const linkAt = {};
    for (const l of links) linkAt[l.i] = l.type;

    const parts = tokens.map((t, i) => {
      if (!t.word) return escHtml(t.raw) + (i < tokens.length - 1 ? ' ' : '');

      let inner = '';
      const chars = t.word.split('');
      chars.forEach((ch, ci) => {
        const isLastLetter = ci === chars.length - 1;
        if (ci === 0 && t.weakH) {
          inner += `<span class="ph-drop">${escHtml(ch)}</span>`;
        } else if (isLastLetter && t.dropFinal) {
          inner += `<span class="ph-drop">${escHtml(ch)}</span>`;
        } else if (isLastLetter && t.flapFinal) {
          inner += `<span class="ph-flap">${escHtml(ch)}</span>`;
        } else {
          inner += escHtml(ch);
        }
      });

      const cls = ['ph-word'];
      if (t.stress) cls.push('ph-stress');
      if (t.weak) cls.push('ph-weak');
      let html = escHtml(t.pre) + `<span class="${cls.join(' ')}">${inner}</span>` + escHtml(t.post);

      // 語間: リンキングなら弧、なければ通常スペース
      if (i < tokens.length - 1) {
        const lt = linkAt[i];
        html += lt
          ? `<span class="ph-link${lt === 'flap' ? ' ph-link-flap' : ''}"></span>`
          : ' ';
      }
      return html;
    });

    return { html: parts.join(''), tips };
  }
};

// ===== 日本語発音ガイド =====
// 英語圏の学習者向けに日本語発音の特徴を可視化する
const JapanesePhonics = {

  analyze(text) {
    const tips = [];

    // っ（促音）
    if (/っ/.test(text)) {
      tips.push({ pri: 1, text: '"っ" = double consonant: briefly stop/hold before the next sound (e.g. きって → kit-te)' });
    }

    // ー（長音符）
    if (/ー/.test(text)) {
      tips.push({ pri: 2, text: '"ー" = long vowel: hold the previous vowel sound twice as long (e.g. コーヒー → kō-hī)' });
    }

    // おう / おお → ō
    if (/おう|おお/.test(text)) {
      tips.push({ pri: 2, text: '"おう" / "おお" = long "ō" — hold the "o" sound (e.g. 東京 → Tōkyō)' });
    }

    // うう / ゆう → ū
    if (/うう|ゆう/.test(text)) {
      tips.push({ pri: 2, text: '"ゆう" / "うう" = long "ū" — hold the "u" sound (e.g. 勉強 → benkyō)' });
    }

    // ん：前後によって変化
    if (/ん/.test(text)) {
      if (/ん[ばびぶべぼぱぴぷぺぽまみむめも]/.test(text)) {
        tips.push({ pri: 3, text: '"ん" before b/p/m sounds becomes "m" (e.g. あんまり → ammari)' });
      } else if (/ん[なにぬねのあいうえお]/.test(text)) {
        tips.push({ pri: 3, text: '"ん" before a vowel or na-row: use an apostrophe to separate (e.g. ほんや → hon\'ya)' });
      } else {
        tips.push({ pri: 4, text: '"ん" = "n", but shifts to "m" before b/p/m and "ng" before g/k' });
      }
    }

    // モーラリズム（常に表示）
    tips.push({ pri: 9, text: 'Japanese has equal-length mora (sound units) — keep a flat, even rhythm, unlike English stress patterns' });

    tips.sort((a, b) => a.pri - b.pri);
    return [...new Set(tips.map(t => t.text))].slice(0, 3);
  }
};
