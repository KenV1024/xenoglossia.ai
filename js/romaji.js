// ひらがな / カタカナ → ローマ字変換（修正ヘボン式）
// 漢字が含まれる場合は Claude API で補完する
const Romaji = {

  // 拗音（2文字）を先に定義してから1文字を定義する
  MAP: {
    // 拗音
    'きゃ':'kya','きゅ':'kyu','きょ':'kyo',
    'しゃ':'sha','しゅ':'shu','しょ':'sho',
    'ちゃ':'cha','ちゅ':'chu','ちょ':'cho',
    'にゃ':'nya','にゅ':'nyu','にょ':'nyo',
    'ひゃ':'hya','ひゅ':'hyu','ひょ':'hyo',
    'みゃ':'mya','みゅ':'myu','みょ':'myo',
    'りゃ':'rya','りゅ':'ryu','りょ':'ryo',
    'ぎゃ':'gya','ぎゅ':'gyu','ぎょ':'gyo',
    'じゃ':'ja', 'じゅ':'ju', 'じょ':'jo',
    'ぢゃ':'ja', 'ぢゅ':'ju', 'ぢょ':'jo',
    'びゃ':'bya','びゅ':'byu','びょ':'byo',
    'ぴゃ':'pya','ぴゅ':'pyu','ぴょ':'pyo',
    // 五十音
    'あ':'a', 'い':'i', 'う':'u', 'え':'e', 'お':'o',
    'か':'ka','き':'ki','く':'ku','け':'ke','こ':'ko',
    'さ':'sa','し':'shi','す':'su','せ':'se','そ':'so',
    'た':'ta','ち':'chi','つ':'tsu','て':'te','と':'to',
    'な':'na','に':'ni','ぬ':'nu','ね':'ne','の':'no',
    'は':'ha','ひ':'hi','ふ':'fu','へ':'he','ほ':'ho',
    'ま':'ma','み':'mi','む':'mu','め':'me','も':'mo',
    'や':'ya','ゆ':'yu','よ':'yo',
    'ら':'ra','り':'ri','る':'ru','れ':'re','ろ':'ro',
    'わ':'wa','ゐ':'i', 'ゑ':'e', 'を':'o', 'ん':'n',
    // 濁音
    'が':'ga','ぎ':'gi','ぐ':'gu','げ':'ge','ご':'go',
    'ざ':'za','じ':'ji','ず':'zu','ぜ':'ze','ぞ':'zo',
    'だ':'da','ぢ':'ji','づ':'zu','で':'de','ど':'do',
    'ば':'ba','び':'bi','ぶ':'bu','べ':'be','ぼ':'bo',
    // 半濁音
    'ぱ':'pa','ぴ':'pi','ぷ':'pu','ぺ':'pe','ぽ':'po',
    // 小文字（単体）
    'ぁ':'a','ぃ':'i','ぅ':'u','ぇ':'e','ぉ':'o',
    // 外来語音（ファ行・ティ行・ヴ行など）
    'ふぁ':'fa','ふぃ':'fi','ふぇ':'fe','ふぉ':'fo','ふゅ':'fyu',
    'てぃ':'ti','とぅ':'tu','でぃ':'di','どぅ':'du',
    'つぁ':'tsa','つぃ':'tsi','つぇ':'tse','つぉ':'tso',
    'うぃ':'wi','うぇ':'we','うぉ':'wo',
    'ゔぁ':'va','ゔぃ':'vi','ゔ':'vu','ゔぇ':'ve','ゔぉ':'vo',
    'っ':'_tsu_', // 特殊処理
  },

  // カタカナ → ひらがなに正規化
  kataToHira(str) {
    return str.replace(/[ァ-ヶ]/g, ch =>
      String.fromCharCode(ch.charCodeAt(0) - 0x60));
  },

  // ひらがな + ASCII テキストをローマ字に変換
  convert(text) {
    const hira = this.kataToHira(text);
    let result = '';
    let i = 0;

    while (i < hira.length) {
      const ch = hira[i];

      // っ: 次の子音を重ねる
      if (ch === 'っ') {
        const nextTwo = hira.slice(i + 1, i + 3);
        const nextOne = hira[i + 1] || '';
        const nextRomaji = this.MAP[nextTwo] || this.MAP[nextOne] || '';
        // 次のローマ字の最初の子音を追加（chi→c, shi→s 等）
        result += nextRomaji ? nextRomaji[0] : '';
        i++;
        continue;
      }

      // ー（長音符）: 直前の母音を繰り返す
      if (ch === 'ー') {
        const lastVowel = [...result].reverse().find(c => 'aeiou'.includes(c));
        result += lastVowel || '-';
        i++;
        continue;
      }

      // 拗音 (2文字) を先に試みる
      if (i + 1 < hira.length) {
        const two = hira.slice(i, i + 2);
        if (this.MAP[two]) {
          result += this.MAP[two];
          i += 2;
          continue;
        }
      }

      // 1文字変換
      const mapped = this.MAP[ch];
      if (mapped && mapped !== '_tsu_') {
        result += mapped;
      } else if (/[\s　]/.test(ch)) {
        result += ' ';
      } else if (/[、。、。]/.test(ch)) {
        result += ch === '、' ? ', ' : '. ';
      } else if (/[一-鿿㐀-䶿]/.test(ch)) {
        // 漢字はそのまま（後でAI変換）
        result += ch;
      } else {
        result += ch;
      }
      i++;
    }

    return result.replace(/\s+/g, ' ').trim();
  },

  hasKanji(text) {
    return /[一-鿿㐀-䶿]/.test(text);
  },

  hasKana(text) {
    return /[ぁ-ゖァ-ヶ]/.test(text);
  },

  // Claude API でローマ字変換（漢字を含む場合）
  async convertWithAI(text) {
    if (typeof AI === 'undefined' || !AI.hasKey()) return null;
    try {
      const result = await AI.call({
        system: 'Convert Japanese text to Hepburn romaji. Output ONLY the romaji on a single line, nothing else. Keep spaces between words natural for English readers.',
        userText: text,
        maxTokens: 300
      });
      return result.trim();
    } catch {
      return null;
    }
  }
};
