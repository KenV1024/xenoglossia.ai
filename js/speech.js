// TTS（読み上げ）と STT（音声認識）の言語共通ラッパー + 自分の声の録音再生
const Speech = {
  voices: [],

  init() {
    const load = () => { this.voices = speechSynthesis.getVoices(); };
    speechSynthesis.onvoiceschanged = load;
    load();
  },

  bcp47(lang) { return lang === 'ja' ? 'ja-JP' : 'en-US'; },

  getBestVoice(lang) {
    if (!this.voices.length) this.voices = speechSynthesis.getVoices();
    const full = this.bcp47(lang);
    if (lang === 'en') {
      return this.voices.find(v => v.lang === full && /female|samantha|zira|aria|jenny/i.test(v.name))
          || this.voices.find(v => v.lang === full)
          || this.voices.find(v => v.lang.startsWith('en'))
          || null;
    }
    return this.voices.find(v => v.lang === full && /nanami|haruka|female/i.test(v.name))
        || this.voices.find(v => v.lang === full)
        || this.voices.find(v => v.lang.startsWith('ja'))
        || null;
  },

  speak(text, lang, rate, onend) {
    speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = this.bcp47(lang);
    utt.rate = rate;
    utt.pitch = 1;
    const voice = this.getBestVoice(lang);
    if (voice) utt.voice = voice;
    if (onend) {
      let done = false;
      const fire = () => { if (!done) { done = true; onend(); } };
      utt.onend = fire;
      utt.onerror = fire;
    }
    speechSynthesis.speak(utt);
    return utt;
  },

  stop() { speechSynthesis.cancel(); },

  supported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  },

  // SpeechRecognition の薄いラッパー。continuous=true時はChromeの自動停止を再起動で吸収する
  createRecognizer({ lang, continuous, onInterim, onFinal, onError, onEnd }) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;

    const rec = new SR();
    rec.lang = this.bcp47(lang);
    rec.continuous = !!continuous;
    rec.interimResults = true;

    const state = { active: false, transcript: '' };

    rec.onresult = (e) => {
      let t = '';
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript + ' ';
      state.transcript = t.trim();
      const isFinal = e.results[e.results.length - 1].isFinal;
      if (onInterim) onInterim(state.transcript);
      if (!continuous && isFinal && onFinal) onFinal(state.transcript);
    };

    rec.onerror = (e) => {
      if (e.error === 'aborted') return;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        state.active = false; // 許可拒否時は onend でループ再起動しない
      }
      if (onError) onError(e.error);
    };

    rec.onend = () => {
      if (continuous && state.active) {
        try { rec.start(); return; } catch {}
      }
      state.active = false;
      if (onEnd) onEnd(state.transcript);
    };

    return {
      start() {
        state.transcript = '';
        state.active = true;
        rec.start();
      },
      stop() {
        state.active = false;
        try { rec.stop(); } catch {}
      },
      abort() {
        state.active = false;
        try { rec.abort(); } catch {}
      },
      get transcript() { return state.transcript; },
      get active() { return state.active; }
    };
  }
};

// 自分の声を録って聞き返すためのレコーダー（音声認識と並行動作）
const VoiceRecorder = {
  mediaRecorder: null,
  chunks: [],
  lastBlobUrl: null,
  audio: null,

  async start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.chunks = [];
      this.mediaRecorder = new MediaRecorder(stream);
      this.mediaRecorder.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
      this.mediaRecorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        if (this.lastBlobUrl) URL.revokeObjectURL(this.lastBlobUrl);
        this.lastBlobUrl = this.chunks.length
          ? URL.createObjectURL(new Blob(this.chunks, { type: this.mediaRecorder.mimeType }))
          : null;
        document.dispatchEvent(new CustomEvent('voicerecorded'));
      };
      this.mediaRecorder.start();
      return true;
    } catch {
      return false; // マイク不可でも音声認識側だけで練習は続行できる
    }
  },

  stop() {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') this.mediaRecorder.stop();
  },

  hasRecording() { return !!this.lastBlobUrl; },

  play() {
    if (!this.lastBlobUrl) return;
    if (this.audio) this.audio.pause();
    this.audio = new Audio(this.lastBlobUrl);
    this.audio.play();
  },

  clear() {
    if (this.lastBlobUrl) { URL.revokeObjectURL(this.lastBlobUrl); this.lastBlobUrl = null; }
  }
};
