// Claude API 連携: 会話シーン生成・高品質翻訳
// ブラウザから直接 Messages API を呼ぶ（CORS opt-inヘッダ使用）
const AI = {
  MODEL: 'claude-haiku-4-5',
  ENDPOINT: 'https://api.anthropic.com/v1/messages',

  hasKey() { return !!Store.getApiKey(); },

  async call({ system, userText, maxTokens = 4096, schema = null }) {
    const key = Store.getApiKey();
    if (!key) throw new Error('APIキーが設定されていません。右上の⚙設定から入力してください。');

    const body = {
      model: this.MODEL,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: userText }]
    };
    if (system) body.system = system;
    if (schema) body.output_config = { format: { type: 'json_schema', schema } };

    let res;
    try {
      res = await fetch(this.ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify(body)
      });
    } catch {
      throw new Error('ネットワークエラー: APIに接続できませんでした。');
    }

    if (!res.ok) {
      let msg = `APIエラー (${res.status})`;
      try {
        const err = await res.json();
        if (res.status === 401) msg = 'APIキーが無効です。設定を確認してください。';
        else if (res.status === 429) msg = 'リクエストが多すぎます。少し待ってから再試行してください。';
        else if (res.status === 529) msg = 'APIが混雑しています。少し待ってから再試行してください。';
        else if (err.error?.message) msg += ': ' + err.error.message;
      } catch {}
      throw new Error(msg);
    }

    const data = await res.json();
    if (data.stop_reason === 'refusal') {
      throw new Error('このトピックでは生成できませんでした。別のトピックをお試しください。');
    }
    const text = data.content?.find(b => b.type === 'text')?.text;
    if (!text) throw new Error('AIから有効な応答が得られませんでした。');
    return text;
  },

  // ---- 会話シーン生成 ----
  SCENE_SCHEMA: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      scene: { type: 'string' },
      turns: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            speaker: { type: 'string', enum: ['A', 'B'] },
            text: { type: 'string' },
            translation: { type: 'string' }
          },
          required: ['speaker', 'text', 'translation'],
          additionalProperties: false
        }
      }
    },
    required: ['title', 'scene', 'turns'],
    additionalProperties: false
  },

  async generateScene({ topic, level, lang, prevTurns = null }) {
    const target = lang === 'ja' ? '日本語' : '英語';
    const transLang = lang === 'ja' ? '英語' : '日本語';
    const levelGuide = {
      beginner: '初級者向け。短く簡単な文（1文10語以内目安）、基本語彙のみ。',
      intermediate: '中級者向け。日常で使う自然な表現、1文15語程度まで。',
      advanced: '上級者向け。ネイティブが実際に使う口語表現・慣用句を含める。'
    }[level] || '';

    let userText;
    if (prevTurns) {
      const history = prevTurns.map(t => `${t.speaker}: ${t.text}`).join('\n');
      userText = `以下の${target}会話の自然な続きを8往復程度生成してください。\n\nトピック: ${topic}\n\nこれまでの会話:\n${history}`;
    } else {
      userText = `トピック「${topic}」について、話者AとBによる自然な${target}の会話シーンを8〜12往復生成してください。`;
    }

    const system = `あなたは語学学習教材の作成者です。第二言語学習者が対人会話の練習をするための、自然でリアルな${target}会話を作ります。
- ${levelGuide}
- 教科書的でなく、ネイティブが実際の会話で使う自然な表現にする
- あいづち・聞き返し・言いよどみなど実会話らしさを適度に入れる
- text は${target}、translation はその${transLang}訳
- title はシーンの短いタイトル、scene は状況説明（${transLang}で1〜2文）`;

    const raw = await this.call({
      system,
      userText,
      maxTokens: 8000,
      schema: this.SCENE_SCHEMA
    });
    const scene = JSON.parse(raw);
    if (!Array.isArray(scene.turns) || !scene.turns.length) {
      throw new Error('会話の生成に失敗しました。もう一度お試しください。');
    }
    return scene;
  },

  // ---- チャンク一括翻訳（APIキーがある場合の高品質翻訳）----
  async translateBatch(texts, sourceLang) {
    const dir = sourceLang === 'ja' ? '日本語から英語' : '英語から日本語';
    const schema = {
      type: 'object',
      properties: {
        translations: { type: 'array', items: { type: 'string' } }
      },
      required: ['translations'],
      additionalProperties: false
    };
    const userText = `以下の各テキストを${dir}に翻訳し、同じ順序・同じ件数で返してください。\n\n` +
      texts.map((t, i) => `${i + 1}. ${t}`).join('\n');

    const raw = await this.call({
      system: '語学学習アプリの翻訳エンジンとして、自然で正確な翻訳のみを返します。',
      userText,
      maxTokens: 8000,
      schema
    });
    const data = JSON.parse(raw);
    if (!Array.isArray(data.translations) || data.translations.length !== texts.length) {
      throw new Error('translation count mismatch');
    }
    return data.translations;
  }
};

// MyMemory無料翻訳（APIキー未設定時のフォールバック）
const FreeTranslate = {
  cache: {},
  async translate(text, sourceLang) {
    const key = sourceLang + '|' + text;
    if (this.cache[key]) return this.cache[key];
    const pair = sourceLang === 'ja' ? 'ja|en' : 'en|ja';
    try {
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${pair}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      const data = await res.json();
      const t = data.responseData?.translatedText;
      if (!t || t === text) throw new Error('no translation');
      this.cache[key] = t;
      return t;
    } catch {
      return '（翻訳を取得できませんでした）';
    }
  }
};
