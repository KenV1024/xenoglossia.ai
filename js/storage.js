// localStorage wrapper: APIキー・セッション（進捗）・設定の永続化
const Store = {
  KEY_API: 'sc_apikey',
  KEY_SESSION: 'sc_session',
  KEY_GUIDE: 'sc_guide',

  // 発音ガイドのON/OFF（デフォルトON）
  getGuideOn() {
    return localStorage.getItem(this.KEY_GUIDE) !== 'off';
  },
  setGuideOn(on) {
    localStorage.setItem(this.KEY_GUIDE, on ? 'on' : 'off');
  },

  getApiKey() {
    return localStorage.getItem(this.KEY_API) || '';
  },
  setApiKey(key) {
    if (key) localStorage.setItem(this.KEY_API, key.trim());
    else localStorage.removeItem(this.KEY_API);
  },

  saveSession(session) {
    try {
      localStorage.setItem(this.KEY_SESSION, JSON.stringify(session));
    } catch (e) {
      // 容量超過時は諦める（練習自体は続行できる）
      console.warn('session save failed', e);
    }
  },
  loadSession() {
    try {
      const raw = localStorage.getItem(this.KEY_SESSION);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  clearSession() {
    localStorage.removeItem(this.KEY_SESSION);
  },

  KEY_HISTORY: 'sc_history',
  saveHistory(entry) {
    const h = this.loadHistory();
    h.push(entry);
    try { localStorage.setItem(this.KEY_HISTORY, JSON.stringify(h.slice(-365))); } catch(e) {}
  },
  loadHistory() {
    try {
      const r = localStorage.getItem(this.KEY_HISTORY);
      return r ? JSON.parse(r) : [];
    } catch { return []; }
  },
  clearHistory() { localStorage.removeItem(this.KEY_HISTORY); }
};
