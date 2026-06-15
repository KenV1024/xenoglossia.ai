// 採点・ハイライト（英語=単語一致 / 日本語=文字バイグラムDice係数）
const Score = {

  // ---- 英語 ----
  normEnWords(s) {
    return s.toLowerCase().replace(/[.,!?;:'"()\-]/g, '').split(/\s+/).filter(Boolean);
  },

  scoreEn(original, recognized) {
    const orig = this.normEnWords(original);
    const rec = this.normEnWords(recognized);
    if (!orig.length) return 0;
    let hits = 0;
    const used = new Set();
    for (const w of rec) {
      const i = orig.findIndex((o, idx) => o === w && !used.has(idx));
      if (i !== -1) { hits++; used.add(i); }
    }
    return Math.min(100, Math.round((hits / orig.length) * 100));
  },

  // ---- 日本語 ----
  // NFKC正規化 + 句読点・空白除去 + カタカナ→ひらがな
  // （音声認識は表記ゆれするため、音の近さで比較する）
  normJa(s) {
    return s.normalize('NFKC')
      .replace(/[、。．，！？!?・「」『』（）()\[\]\s〜ー―…:;"']/g, '')
      .replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60))
      .toLowerCase();
  },

  bigrams(s) {
    const set = [];
    for (let i = 0; i < s.length - 1; i++) set.push(s.slice(i, i + 2));
    return set;
  },

  scoreJa(original, recognized) {
    const a = this.normJa(original);
    const b = this.normJa(recognized);
    if (!a.length) return 0;
    if (a.length === 1) return b.includes(a) ? 100 : 0;
    const ga = this.bigrams(a);
    const gb = this.bigrams(b);
    if (!gb.length) return 0;
    const pool = new Map();
    for (const g of gb) pool.set(g, (pool.get(g) || 0) + 1);
    let hits = 0;
    for (const g of ga) {
      const n = pool.get(g) || 0;
      if (n > 0) { hits++; pool.set(g, n - 1); }
    }
    // 原文側のバイグラム再現率（言い切れた割合）
    return Math.min(100, Math.round((hits / ga.length) * 100));
  },

  calc(original, recognized, lang) {
    return lang === 'ja' ? this.scoreJa(original, recognized) : this.scoreEn(original, recognized);
  },

  // ---- ハイライト ----
  highlightEn(original, recognized) {
    const normWord = w => w.toLowerCase().replace(/[.,!?;:'"()\-]/g, '');
    const tokens = original.split(/(\s+)/);
    const recNorm = this.normEnWords(recognized);
    const used = new Set();
    return tokens.map(tok => {
      if (/^\s+$/.test(tok)) return tok;
      const norm = normWord(tok);
      if (!norm) return escHtml(tok);
      const idx = recNorm.findIndex((w, i) => w === norm && !used.has(i));
      if (idx !== -1) { used.add(idx); return `<span class="word-hit">${escHtml(tok)}</span>`; }
      return `<span class="word-miss">${escHtml(tok)}</span>`;
    }).join('');
  },

  // 日本語は読点・句点で区切った文節単位でヒット判定する
  highlightJa(original, recognized) {
    const recNorm = this.normJa(recognized);
    const recGrams = new Set(this.bigrams(recNorm));
    const segments = original.split(/(?<=[、。！？!?．，])/);
    return segments.map(seg => {
      if (!seg.trim()) return escHtml(seg);
      const norm = this.normJa(seg);
      if (!norm) return escHtml(seg);
      let ok;
      if (norm.length === 1) {
        ok = recNorm.includes(norm);
      } else {
        const grams = this.bigrams(norm);
        const hit = grams.filter(g => recGrams.has(g)).length;
        ok = hit / grams.length >= 0.55;
      }
      return `<span class="${ok ? 'word-hit' : 'word-miss'}">${escHtml(seg)}</span>`;
    }).join('');
  },

  highlight(original, recognized, lang) {
    return lang === 'ja' ? this.highlightJa(original, recognized) : this.highlightEn(original, recognized);
  },

  // スコア帯ごとの色とコメント (lang='ja' → English UI for English speakers studying Japanese)
  feedback(score, lang = 'en') {
    const en = lang === 'ja';
    if (score >= 80) return { color: '#10B981', comment: en ? 'Excellent! Almost perfect!' : '素晴らしい！ほぼ完璧です' };
    if (score >= 60) return { color: '#F59E0B', comment: en ? 'Almost there! Keep practicing!' : 'もう少し！くり返し練習しましょう' };
    if (score >= 40) return { color: '#EA580C', comment: en ? 'Listen to Slow mode and try again' : 'ゆっくり再生を聞いてからもう一度' };
    return { color: '#E11D48', comment: en ? 'Listen closely and mimic the audio' : '再生を聞いてから真似して話してみてください' };
  }
};

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
