// テキストを練習しやすい「チャンク（意味のかたまり）」に分割する
const Chunker = {

  split(text, lang) {
    return lang === 'ja' ? this.splitJa(text) : this.splitEn(text);
  },

  // ---- 英語: 文末で区切り、長文はカンマ等で再分割 ----
  // 略語（Dr. Mr. etc.）の後ろは文末として扱わない
  ABBREVS: new Set(['Dr','Mr','Mrs','Ms','Prof','Rev','Sen','Rep','Lt','Sgt','Col','Maj','Gen','Cpt','Pres','Gov','St','Jr','Sr','Inc','Ltd','Corp','Co','No','Vol','vs','etc','eg','ie','pp','fig','approx','dept','est','esp','fwd','op','ed']),

  splitEn(text) {
    text = text.trim().replace(/\s+/g, ' ');
    const result = [];

    const sentences = [];
    let buf = '';
    for (let i = 0; i < text.length; i++) {
      buf += text[i];
      if (['.', '!', '?'].includes(text[i])) {
        const rest = text.slice(i + 1).trimStart();
        if (rest.length === 0 || /^[A-Z"'(]/.test(rest)) {
          // 直前の単語が略語 or 単独の大文字イニシャル（A. B. など）なら文末ではない
          const lastWord = buf.slice(0, -1).trimEnd().split(/\s+/).pop() || '';
          if (this.ABBREVS.has(lastWord) || /^[A-Z]$/.test(lastWord)) continue;
          sentences.push(buf.trim());
          buf = '';
          while (i + 1 < text.length && text[i + 1] === ' ') i++;
        }
      }
    }
    if (buf.trim()) sentences.push(buf.trim());

    for (const sentence of sentences) {
      if (!sentence) continue;
      const wordCount = sentence.split(/\s+/).filter(Boolean).length;
      if (wordCount <= 10) {
        result.push(sentence);
      } else {
        const parts = sentence.split(/(?<=[,;:])\s+/);
        let buffer = '';
        for (const part of parts) {
          if (!buffer) {
            buffer = part;
          } else {
            const combined = buffer + ' ' + part;
            if (combined.split(/\s+/).length <= 12) {
              buffer = combined;
            } else {
              if (buffer.trim()) result.push(buffer.trim());
              buffer = part;
            }
          }
        }
        if (buffer.trim()) result.push(buffer.trim());
      }
    }
    return result.filter(c => c.trim().length > 2);
  },

  // ---- 日本語: 「。！？」で文分割し、25文字超は「、」で再分割 ----
  splitJa(text) {
    text = text.trim().replace(/[\r\n]+/g, '').replace(/\s+/g, '');
    const sentences = text.split(/(?<=[。！？!?])/).map(s => s.trim()).filter(Boolean);
    const result = [];

    for (const sentence of sentences) {
      if (sentence.length <= 25) {
        result.push(sentence);
        continue;
      }
      const parts = sentence.split(/(?<=[、])/).filter(Boolean);
      let buffer = '';
      for (const part of parts) {
        if (!buffer) {
          buffer = part;
        } else if ((buffer + part).length <= 28) {
          buffer += part;
        } else {
          result.push(buffer);
          buffer = part;
        }
      }
      if (buffer) result.push(buffer);
    }

    // 短すぎる断片（6文字未満）は前のチャンクへ結合
    const merged = [];
    for (const c of result) {
      if (merged.length && c.length < 6) merged[merged.length - 1] += c;
      else merged.push(c);
    }
    return merged.filter(c => c.length > 1);
  }
};
