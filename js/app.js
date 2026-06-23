// アプリ本体: 状態管理・画面遷移・練習フロー（チャンク→パラグラフ→全文）・ロールプレイ

// ===== State =====
const App = {
  lang: 'en',               // 練習言語 'en' | 'ja'
  langChoice: 'auto',       // ホームでの選択 'auto' | 'en' | 'ja'
  source: 'text',           // 'text' | 'scene'
  paragraphs: [],           // [{chunks:[], translation:string|null, chunkTranslations:[]}]
  flow: [],                 // [{type:'chunk',p,c} | {type:'para',p} | {type:'full'}]
  flowIndex: 0,
  scores: {},               // stepKey -> score
  reviewMode: false,
  review: { steps: [], idx: 0 },
  fileText: null,
  fileName: null,
  scene: null,              // {title, scene, turns:[{speaker,text,translation}], lang, level, topic}
  sceneOpts: { lang: 'en', level: 'intermediate', topic: '' },
  tag: '',
  sessionCreatedTs: null,   // セッション開始日時（復習判定に使用）
  topicId: null             // 練習中のトピックID（null = 自由テキスト）
};

let chunkRecognizer = null;
let runRecognizer = null;
let renderToken = 0;

// ===== Helpers =====
function $(id) { return document.getElementById(id); }

function stepKey(step) {
  if (step.type === 'chunk') return `c:${step.p}:${step.c}`;
  if (step.type === 'para') return `p:${step.p}`;
  return 'full';
}

function currentStep() {
  return App.reviewMode ? App.review.steps[App.review.idx] : App.flow[App.flowIndex];
}

function joiner() { return App.lang === 'ja' ? '' : ' '; }

function paraText(p) { return App.paragraphs[p].chunks.join(joiner()); }

function fullText() { return App.paragraphs.map((_, i) => paraText(i)).join(joiner()); }

function showLoading(text) {
  $('loading-text').textContent = text;
  $('loading-overlay').classList.add('visible');
}
function hideLoading() { $('loading-overlay').classList.remove('visible'); }

function showError(id, msg) {
  const el = $(id);
  el.textContent = msg;
  el.classList.add('visible');
}
function clearError(id) { $(id).classList.remove('visible'); }

function _setSpeakBtns(screenId, playing) {
  const screen = $(screenId);
  if (!screen) return;
  screen.querySelectorAll('.btn-play, .btn-slow').forEach(btn => {
    const icon = btn.querySelector('.action-icon');
    const lbl  = btn.querySelector('span:last-child');
    if (playing) {
      icon.textContent = '⏸'; lbl.textContent = u('一時停止', 'Pause');
      btn.classList.add('speaking');
    } else {
      icon.textContent = btn.classList.contains('btn-play') ? '▶' : '🐢';
      lbl.textContent  = btn.classList.contains('btn-play') ? u('再生', 'Play') : u('ゆっくり', 'Slow');
      btn.classList.remove('speaking');
    }
  });
  if (screenId === 'screen-practice') setPracticeState(playing ? 'speaking' : 'idle');
}

function setPracticeState(state) {
  const bar = $('practice-state-bar');
  if (!bar) return;
  if (state === 'speaking') {
    bar.style.display = 'flex';
    bar.className = 'practice-state-bar psb-speaking';
    $('psb-text').textContent = u('AIが発音中...', 'AI is speaking...');
  } else if (state === 'recording') {
    bar.style.display = 'flex';
    bar.className = 'practice-state-bar psb-recording';
    $('psb-text').textContent = u('🎤 あなたの番です　話してください', '🎤 Your turn — speak now');
  } else {
    bar.style.display = 'none';
    bar.className = 'practice-state-bar';
  }
}

// ===== Practice Mode (header selector) =====
let _practiceMode = 'chunk';

function setPracticeMode(mode) {
  if (_practiceMode === mode) return;
  stopAllAudio();
  _practiceMode = mode;

  document.querySelectorAll('.pm-btn').forEach(b => b.classList.remove('active'));
  const btn = $('pm-' + mode);
  if (btn) btn.classList.add('active');

  const sp = $('screen-practice');
  if (sp) sp.dataset.mode = mode;

  const modeLabels = {
    chunk: ['チャンク練習', 'tag-chunk'],
    '3step': ['3ステップ練習', 'tag-chunk'],
    backchain: ['バックチェイニング練習', 'tag-para'],
    shadow: ['シャドーイング練習', 'tag-full']
  };
  const [label, cls] = modeLabels[mode] || modeLabels.chunk;
  const tag = $('practice-tag');
  if (tag) { tag.textContent = label; tag.className = 'step-tag ' + cls; }

  if (mode === 'backchain') startBackchain();
  else if (mode === 'shadow') startShadowing();
  else if (mode === '3step') playCycle();
}

function stopAllAudio() {
  Speech.stop();
  _speakScreen = null;
  _setSpeakBtns('screen-practice', false);
  _setSpeakBtns('screen-run', false);
  if (chunkRecognizer) { chunkRecognizer.abort(); setRecordUI(false); }
  if (runRecognizer) { runRecognizer.abort(); setRunRecordUI(false); }
  VoiceRecorder.stop();
  rpStopAll();
  _cycleActive = false;
  const cb = $('cycle-btn');
  if (cb) { cb.classList.remove('cycling'); $('cycle-label').textContent = u('3ステップ練習（聞く → ゆっくり → 録音）', '3-Step Drill (listen → slow → speak)'); $('cycle-icon').textContent = '🔄'; }
  _bcActive = false;
  if (_bcRecognizer) { _bcRecognizer.abort(); _bcRecognizer = null; }
  const bcPanel = $('bc-panel');
  if (bcPanel) bcPanel.style.display = 'none';
  const bcBtn = $('bc-btn');
  if (bcBtn) { bcBtn.classList.remove('active'); $('bc-btn-label').textContent = u('バックチェイニング練習（末尾から積み上げ）', 'Back-chaining Drill'); $('bc-icon').textContent = '⬅'; }
  const sp = $('screen-practice');
  if (sp) sp.classList.remove('bc-focus');
  const ri = $('rec-indicator');
  if (ri) ri.classList.remove('visible');
  _shadowActive = false;
  if (_shadowRecognizer) { _shadowRecognizer.abort(); _shadowRecognizer = null; }
  const shBtn = $('shadow-btn');
  if (shBtn) { shBtn.classList.remove('active'); $('shadow-label').textContent = u('シャドーイング練習（AIと同時に発音）', 'Shadowing Drill'); }
  clearTimeout(_silenceTimer);
  hideSilenceHint();
  setPracticeState('idle');
}

// ===== UI language helpers =====
// App.lang==='ja' = English speaker studying Japanese → show English UI
// App.lang==='en' = Japanese speaker studying English → show Japanese UI
function u(ja, en) { return App.lang === 'ja' ? en : ja; }

function refreshLangUI() {
  if (App.lang !== 'ja') return;
  // Practice screen
  const pBack = $('practice-back-btn');
  if (pBack) pBack.textContent = '← Back';
  const cH3 = $('completion-h3');
  if (cH3) cH3.textContent = 'All practice complete!';
  const cP = $('completion-p');
  if (cP) cP.textContent = 'Great work! Review difficult chunks from the list.';
  const playLbl = $('play-label');
  if (playLbl) playLbl.textContent = 'Play';
  const slowLbl = $('slow-label');
  if (slowLbl) slowLbl.textContent = 'Slow';
  const myLbl = $('myvoice-label');
  if (myLbl) myLbl.textContent = 'My Voice';
  const recLbl = $('record-label');
  if (recLbl) recLbl.textContent = 'Record';
  const resLbl = $('result-label-text');
  if (resLbl) resLbl.textContent = 'Your speech (recognized)';
  const prevBtn = $('prev-btn');
  if (prevBtn) prevBtn.textContent = '← Prev';
  // Run screen
  const rBack = $('run-back-btn');
  if (rBack) rBack.textContent = '← Back';
  const runPlayLbl = $('run-play-label');
  if (runPlayLbl) runPlayLbl.textContent = 'Play';
  const runSlowLbl = $('run-slow-label');
  if (runSlowLbl) runSlowLbl.textContent = 'Slow';
  const runRec = $('run-record-label');
  if (runRec) runRec.textContent = 'Record';
  const runIntLbl = $('run-interim-label');
  if (runIntLbl) runIntLbl.textContent = 'Recognizing…';
  const runResLbl = $('run-result-label-text');
  if (runResLbl) runResLbl.textContent = 'Result';
  const runGreen = $('run-legend-green');
  if (runGreen) runGreen.textContent = 'Green';
  const runGreenTxt = $('run-legend-green-text');
  if (runGreenTxt) runGreenTxt.textContent = ' Correct';
  const runRed = $('run-legend-red');
  if (runRed) runRed.textContent = 'Red';
  const runRedTxt = $('run-legend-red-text');
  if (runRedTxt) runRedTxt.textContent = ' Not recognized';
  const runPrev = $('run-prev-btn');
  if (runPrev) runPrev.textContent = '← Prev';
  // List screen
  const sfBtn = $('start-flow-btn');
  if (sfBtn) sfBtn.textContent = 'Practice in order →';
  const rvBtn = $('review-btn');
  if (rvBtn) rvBtn.textContent = '🔁 Review weak chunks';
  const fmBtn = $('full-mode-btn');
  if (fmBtn) fmBtn.textContent = 'Practice full text →';
}

// ===== Screen =====
function showScreen(name) {
  stopAllAudio();
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $('screen-' + name).classList.add('active');
  if (name === 'list') updateListUI();
  // Practice mode bar: show only on practice screen
  const pmBar = $('practice-mode-bar');
  if (pmBar) pmBar.style.display = name === 'practice' ? 'flex' : 'none';
  // Reset practice mode when entering practice screen
  if (name === 'practice') {
    _practiceMode = 'chunk';
    const sp = $('screen-practice');
    if (sp) sp.dataset.mode = 'chunk';
    document.querySelectorAll('.pm-btn').forEach(b => b.classList.remove('active'));
    const pm = $('pm-chunk');
    if (pm) pm.classList.add('active');
  }
}

function goHome() {
  _maybeUpdateTopicProgress();
  _maybeSaveHistory();
  stopAllAudio();
  updateResumeBanner();
  updateAiHint();
  _updateTagChips();
  showScreen('home');
}

// ===== Settings =====
function openSettings() {
  const key = Store.getApiKey();
  $('api-key-input').value = key;
  const st = $('key-status');
  st.textContent = key ? '✓ 設定済み' : '未設定';
  st.className = 'key-status ' + (key ? 'ok' : 'none');
  $('settings-modal').classList.add('visible');
}
function closeSettings() { $('settings-modal').classList.remove('visible'); }
function saveSettings() {
  Store.setApiKey($('api-key-input').value);
  closeSettings();
  updateAiHint();
}
function updateAiHint() {
  $('ai-key-hint').innerHTML = AI.hasKey()
    ? '<span style="color:#15803D;font-weight:600;">（APIキー設定済み ✓）</span>'
    : '<span style="color:#B91C1C;">※ 右上の⚙設定でClaude APIキーの入力が必要です。</span>';
}

// ===== Session Persistence =====
function saveSession() {
  const scoreVals = Object.values(App.scores).filter(n => typeof n === 'number');
  let nextReview = null;
  if (scoreVals.length) {
    const avg = scoreVals.reduce((a, b) => a + b, 0) / scoreVals.length;
    const days = avg >= 80 ? 3 : avg >= 60 ? 1 : 0;
    nextReview = Date.now() + days * 86400000;
  }
  Store.saveSession({
    v: 1,
    lang: App.lang,
    source: App.source,
    paragraphs: App.paragraphs,
    scores: App.scores,
    scene: App.scene,
    tag: App.tag || '',
    created_ts: App.sessionCreatedTs || Date.now(),
    nextReview,
    ts: Date.now()
  });
}

function updateResumeBanner() {
  const s = Store.loadSession();
  const banner = $('resume-banner');
  if (s && s.paragraphs && s.paragraphs.length) {
    const done = Object.keys(s.scores || {}).length;
    const label = s.source === 'scene' && s.scene
      ? `AI会話「${s.scene.title}」`
      : `テキスト練習（${s.paragraphs.length}パラグラフ）`;
    $('resume-info').textContent = `前回: ${label} ・ ${done}ステップ練習済み`;
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }
}

function resumeSession() {
  const s = Store.loadSession();
  if (!s) return;
  App.lang = s.lang;
  refreshLangUI();
  App.source = s.source;
  App.paragraphs = s.paragraphs;
  App.scores = s.scores || {};
  App.scene = s.scene || null;
  App.tag = s.tag || '';
  App.sessionCreatedTs = s.created_ts || s.ts || null;
  if (App.scene && App.scene.lang) App.sceneOpts.lang = App.scene.lang;
  App.reviewMode = false;
  _updateTagChips();
  buildFlow();
  showScreen('list');
}

// ===== Home: text input =====
function loadSample() {
  if (App.langChoice === 'ja') {
    $('input-text').value =
      "はじめまして、田中ゆきと申します。大阪出身です。\n\n" +
      "日本語を学んでいるのですか？すばらしいですね。\n" +
      "毎日少しずつ練習すれば、きっと上手になりますよ。\n\n" +
      "日本語は難しい言語ですが、漫画やアニメで楽しく勉強できます。\n" +
      "コーヒーを飲みながら、一緒に練習しましょう。";
  } else {
    $('input-text').value =
      "Hello, my name is Yuki Tanaka. I am from Osaka, Japan. " +
      "I have been learning English for two years, but I still struggle with speaking. " +
      "My goal is to have a natural conversation with native speakers.\n\n" +
      "I practice every day by listening to podcasts and watching movies in English. " +
      "I believe that with consistent practice, anyone can improve their English skills.";
  }
  App.fileText = null;
  App.fileName = null;
  $('dz-file').textContent = '';
}

function setLang(choice) {
  App.langChoice = choice;
  document.querySelectorAll('#lang-seg .seg-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.lang === choice));
}

function setTag(tag) {
  App.tag = tag;
  _updateTagChips();
}

function _updateTagChips() {
  document.querySelectorAll('#tag-chips .tag-chip').forEach(b =>
    b.classList.toggle('active', b.dataset.tag === App.tag));
}

function setupDropzone() {
  const dz = $('dropzone');
  const input = $('file-input');
  dz.onclick = () => input.click();
  dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('dragover'); };
  dz.ondragleave = () => dz.classList.remove('dragover');
  dz.ondrop = (e) => {
    e.preventDefault();
    dz.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  };
  input.onchange = () => { if (input.files.length) handleFile(input.files[0]); };
}

async function handleFile(file) {
  clearError('home-error');
  showLoading('ファイルを読み込み中...');
  try {
    App.fileText = await Parser.readFile(file);
    App.fileName = file.name;
    $('dz-file').textContent = '✓ ' + file.name;
    $('input-text').value = '';
  } catch (e) {
    showError('home-error', e.message || 'ファイルを読み込めませんでした。');
    App.fileText = null;
    App.fileName = null;
    $('dz-file').textContent = '';
  } finally {
    hideLoading();
  }
}

// ===== Start text practice =====
function startTextPractice() {
  clearError('home-error');
  const raw = App.fileText || $('input-text').value.trim();
  if (!raw) {
    showError('home-error', 'ファイルを読み込むか、テキストを貼り付けてください。');
    return;
  }

  const ex = Parser.extract(raw);

  // 言語決定（自動: 英語優先）
  let lang = App.langChoice;
  if (lang === 'auto') lang = ex.en.length ? 'en' : (ex.ja.length ? 'ja' : 'en');

  let targets = ex[lang];
  let translations = null;
  if (ex.paired) {
    translations = lang === 'en' ? ex.ja : ex.en; // 対訳ペア: 反対言語をそのまま訳に使う
  }

  // 抽出できない短いテキストは全体を1パラグラフとして扱う
  if (!targets.length) {
    if (Parser.lineLang(raw.replace(/\s+/g, ' ')) === lang || App.langChoice !== 'auto') {
      targets = [raw.replace(/\r?\n+/g, lang === 'ja' ? '' : ' ').trim()];
    } else {
      showError('home-error',
        lang === 'ja' ? '日本語の文章を見つけられませんでした。言語設定を確認してください。'
                      : '英語の文章を見つけられませんでした。言語設定を確認してください。');
      return;
    }
  }

  App.lang = lang;
  refreshLangUI();
  App.source = 'text';
  App.paragraphs = targets.map((t, i) => ({
    chunks: Chunker.split(t, lang),
    translation: translations ? (translations[i] || null) : null,
    chunkTranslations: []
  })).filter(p => p.chunks.length);

  if (!App.paragraphs.length) {
    showError('home-error', '練習できる文章を抽出できませんでした。');
    return;
  }

  App.scores = {};
  App.reviewMode = false;
  App.sessionCreatedTs = Date.now();
  buildFlow();
  saveSession();
  showScreen('list');
}

// トピック練習用: テキストを直接渡して練習開始
function startTextPracticeWithText(text, topicId) {
  App.topicId  = topicId;
  App.tag      = '';
  const lang   = 'en';
  App.lang     = lang;
  App.source   = 'text';
  refreshLangUI();
  const ex      = Parser.extract(text);
  const targets = ex.en.length ? ex.en : [text.trim()];
  App.paragraphs = targets.map(t => ({
    chunks: Chunker.split(t, lang),
    translation: null,
    chunkTranslations: []
  })).filter(p => p.chunks.length);
  App.scores           = {};
  App.reviewMode       = false;
  App.sessionCreatedTs = Date.now();
  buildFlow();
  saveSession();
  showScreen('list');
}

// ===== Flow =====
function buildFlow() {
  const flow = [];
  App.paragraphs.forEach((para, p) => {
    para.chunks.forEach((_, c) => flow.push({ type: 'chunk', p, c }));
    if (para.chunks.length > 1) flow.push({ type: 'para', p });
  });
  const totalChunks = App.paragraphs.reduce((a, p) => a + p.chunks.length, 0);
  if (App.paragraphs.length > 1 && totalChunks > 1) flow.push({ type: 'full' });
  App.flow = flow;
  App.flowIndex = 0;
}

function startFlowFromBeginning() {
  App.reviewMode = false;
  App.flowIndex = 0;
  renderCurrentStep();
}

function goToStep(target) {
  App.reviewMode = false;
  const idx = App.flow.findIndex(s =>
    s.type === target.type && s.p === target.p && s.c === target.c);
  if (idx === -1) {
    // 全文ステップがない（1パラグラフのみ）場合はパラグラフ通しへ
    if (target.type === 'full') {
      const pi = App.flow.findIndex(s => s.type === 'para');
      if (pi !== -1) { App.flowIndex = pi; renderCurrentStep(); return; }
      App.flowIndex = 0; renderCurrentStep(); return;
    }
    return;
  }
  App.flowIndex = idx;
  renderCurrentStep();
}

function renderCurrentStep() {
  const step = currentStep();
  if (!step) { showScreen('list'); return; }
  if (step.type === 'chunk') {
    renderPractice();
    showScreen('practice');
  } else {
    renderRun();
    showScreen('run');
  }
}

function navigate(dir) {
  stopAllAudio();
  if (App.reviewMode) {
    const next = App.review.idx + dir;
    if (next < 0) return;
    if (next >= App.review.steps.length) {
      App.reviewMode = false;
      showScreen('list');
      return;
    }
    App.review.idx = next;
    renderCurrentStep();
    return;
  }
  const next = App.flowIndex + dir;
  if (next < 0 || next >= App.flow.length) return;
  App.flowIndex = next;
  renderCurrentStep();
}

// ===== Review mode =====
function weakSteps() {
  return App.flow.filter(s =>
    s.type === 'chunk' && App.scores[stepKey(s)] !== undefined && App.scores[stepKey(s)] < 60);
}

function startReviewMode() {
  const steps = weakSteps();
  if (!steps.length) return;
  App.reviewMode = true;
  App.review = { steps, idx: 0 };
  renderCurrentStep();
}

// ===== 翌日復習判定 =====
function _isReviewDay() {
  // スコアベースのnextReviewを優先チェック
  const s = Store.loadSession();
  if (s && s.nextReview && s.nextReview <= Date.now() && Object.values(App.scores).some(v => v !== undefined)) return true;
  // フォールバック: 日付ベース
  if (!App.sessionCreatedTs) return false;
  const createdDate = new Date(App.sessionCreatedTs).toDateString();
  const today = new Date().toDateString();
  return createdDate !== today && Object.values(App.scores).some(v => v !== undefined);
}

function _getReviewParaIndices() {
  return App.paragraphs.reduce((acc, para, p) => {
    const chunkScores = para.chunks.map((_, c) => App.scores[`c:${p}:${c}`]).filter(s => s !== undefined);
    const paraScore = App.scores[`p:${p}`];
    const allScores = [...chunkScores, ...(paraScore !== undefined ? [paraScore] : [])];
    if (allScores.length && Math.min(...allScores) < 70) acc.push(p);
    return acc;
  }, []);
}

// ===== List UI =====
function updateListUI() {
  // トピック練習中はリスト画面の「戻る」をトピック一覧へ変更
  const lbb = $('list-back-btn');
  if (lbb) {
    if (App.topicId) {
      lbb.textContent = '← トピックに戻る';
      lbb.onclick = () => {
        const tid = App.topicId;
        _maybeUpdateTopicProgress();   // スコアがあれば保存・topicId をクリア
        showTopicDetail(tid);          // 詳細ビューを再表示
        showScreen('topics');
      };
    } else {
      lbb.textContent = '← ホーム';
      lbb.onclick = goHome;
    }
  }

  $('list-title').textContent = App.source === 'scene' && App.scene
    ? '🤖 ' + App.scene.title : u('練習メニュー', 'Practice Menu');

  const total = App.flow.length;
  const done = App.flow.filter(s => App.scores[stepKey(s)] !== undefined).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  $('list-progress-text').textContent = u(`練習済み: ${done} / ${total}`, `Completed: ${done} / ${total}`);
  $('list-progress-pct').textContent = pct + '%';
  $('list-progress-fill').style.width = pct + '%';

  $('review-btn').style.display = weakSteps().length ? 'block' : 'none';

  // 翌日復習バナー・パラグラフ優先ソート
  const isReviewDay = _isReviewDay();
  const reviewParaSet = isReviewDay ? new Set(_getReviewParaIndices()) : new Set();
  const banner = $('review-day-banner');
  if (isReviewDay && reviewParaSet.size > 0) {
    $('review-day-title').textContent = `📅 前回の復習パラグラフ: ${reviewParaSet.size}件`;
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }

  // 復習対象を先頭に、それ以外を後ろに並べる
  const paraOrder = [...Array(App.paragraphs.length).keys()].sort((a, b) => {
    const aRev = reviewParaSet.has(a) ? 0 : 1;
    const bRev = reviewParaSet.has(b) ? 0 : 1;
    return aRev - bRev;
  });

  const wrap = $('para-list');
  wrap.innerHTML = '';

  paraOrder.forEach(p => {
    const para = App.paragraphs[p];
    const needsReview = reviewParaSet.has(p);
    const block = document.createElement('div');
    block.className = 'para-block' + (App.paragraphs.length <= 3 ? ' open' : '') + (needsReview ? ' needs-review' : '');

    const paraScore = App.scores[`p:${p}`];
    const chunkScores = para.chunks.map((_, c) => App.scores[`c:${p}:${c}`]);
    const doneCount = chunkScores.filter(s => s !== undefined).length;

    let badge = '';
    if (paraScore !== undefined) {
      const cls = paraScore >= 80 ? 'badge-great' : paraScore >= 50 ? 'badge-ok' : 'badge-low';
      badge = `<span class="chunk-score-badge ${cls}">通し ${paraScore}%</span>`;
    }

    const label = App.source === 'scene'
      ? `${App.scene.turns[p] ? App.scene.turns[p].speaker + ': ' : ''}${escHtml(paraText(p).slice(0, 30))}…`
      : `パラグラフ ${p + 1}`;

    const reviewBadge = needsReview ? '<span class="review-badge">要復習</span>' : '';
    const head = document.createElement('div');
    head.className = 'para-head';
    head.innerHTML = `
      <span class="para-toggle">▶</span>
      <span class="para-title">${label}</span>
      <span class="para-meta">${doneCount}/${para.chunks.length}</span>
      ${reviewBadge}${badge}`;
    head.onclick = () => block.classList.toggle('open');

    const body = document.createElement('div');
    body.className = 'para-body';

    const grid = document.createElement('div');
    grid.className = 'chunks-grid';
    para.chunks.forEach((chunk, c) => {
      const score = App.scores[`c:${p}:${c}`];
      const isDone = score !== undefined;
      let chunkBadge = '';
      if (isDone) {
        const cls = score >= 80 ? 'badge-great' : score >= 50 ? 'badge-ok' : 'badge-low';
        chunkBadge = `<div class="chunk-score-badge ${cls}">${score}%</div>`;
      }
      const card = document.createElement('div');
      card.className = 'chunk-card' + (isDone ? ' done' : '');
      card.onclick = () => goToStep({ type: 'chunk', p, c });
      card.innerHTML = `
        <div class="chunk-num">${isDone ? '✓' : c + 1}</div>
        <div class="chunk-preview">
          <div class="chunk-preview-en">${escHtml(chunk.slice(0, 72))}${chunk.length > 72 ? '…' : ''}</div>
        </div>
        ${chunkBadge}`;
      grid.appendChild(card);
    });
    body.appendChild(grid);

    if (para.chunks.length > 1) {
      const runBtn = document.createElement('button');
      runBtn.className = 'para-run-btn';
      runBtn.textContent = u('▶ このパラグラフを通して練習する', '▶ Practice this paragraph');
      runBtn.onclick = () => goToStep({ type: 'para', p });
      body.appendChild(runBtn);
    }

    block.appendChild(head);
    block.appendChild(body);
    wrap.appendChild(block);
  });
}

// ===== Chunk Practice =====
async function renderPractice() {
  const step = currentStep();
  const token = ++renderToken;
  const chunk = App.paragraphs[step.p].chunks[step.c];

  if (App.reviewMode) {
    $('chunk-counter').textContent = u(
      `復習 ${App.review.idx + 1} / ${App.review.steps.length}`,
      `Review ${App.review.idx + 1} / ${App.review.steps.length}`
    );
  } else {
    $('chunk-counter').textContent = u(
      `パラグラフ ${step.p + 1} ・ チャンク ${step.c + 1} / ${App.paragraphs[step.p].chunks.length}`,
      `Para ${step.p + 1} · Chunk ${step.c + 1} / ${App.paragraphs[step.p].chunks.length}`
    );
  }

  renderPhonicsGuide(chunk);
  $('word-count').textContent = App.lang === 'ja'
    ? chunk.length + u(' 文字', ' chars')
    : chunk.split(/\s+/).filter(Boolean).length + u(' 語', ' words');

  // 結果リセット / 前回スコア表示
  $('result-area').classList.remove('visible');
  $('result-text').innerHTML = '';
  $('chunk-result-legend').style.display = 'none';
  $('score-bar').style.width = '0%';
  $('score-number').textContent = '—';
  $('score-comment').textContent = '';
  $('myvoice-btn').disabled = !VoiceRecorder.hasRecording();

  const prev = App.scores[stepKey(step)];
  if (prev !== undefined) {
    $('result-text').textContent = u('（前回の結果）', '(Previous best)');
    $('chunk-result-legend').style.display = 'none';
    $('result-area').classList.add('visible');
    showChunkScore(prev);
  }

  updatePracticeProgress();
  const navAtStart = App.reviewMode ? App.review.idx === 0 : App.flowIndex === 0;
  const navAtEnd = App.reviewMode
    ? App.review.idx === App.review.steps.length - 1
    : App.flowIndex === App.flow.length - 1;
  $('prev-btn').disabled = navAtStart;
  $('next-btn').disabled = navAtEnd && !App.reviewMode;
  $('next-btn').textContent = App.reviewMode && navAtEnd ? u('復習を終える ✓', 'Finish Review ✓') : u('次へ →', 'Next →');

  // 次のステップが通し練習なら表示を変える
  const nextStep = App.reviewMode ? null : App.flow[App.flowIndex + 1];
  if (nextStep && nextStep.type === 'para') $('next-btn').textContent = u('次へ（パラグラフ通し）→', 'Next (Para run) →');
  if (nextStep && nextStep.type === 'full') $('next-btn').textContent = u('次へ（全文通し）→', 'Next (Full run) →');
  $('next-btn').classList.toggle('next-special', !!(nextStep && nextStep.type !== 'chunk'));

  updateCompletionBanner();

  // 翻訳（非同期・画面が切り替わっていたら破棄）
  $('practice-trans-label').textContent = App.lang === 'ja' ? u('英訳', 'English') : u('日本語訳', 'Japanese');
  $('practice-translation').innerHTML = `<span class="loading-text">${u('翻訳中...', 'Translating...')}</span>`;
  const trans = await getChunkTranslation(step.p, step.c);
  if (token !== renderToken) return;
  $('practice-translation').textContent = trans.text;
  $('practice-trans-label').textContent = trans.label;
}

// ===== 発音ガイド =====
function renderPhonicsGuide(chunk) {
  const target = $('practice-target');
  const guideOn = Store.getGuideOn();
  const isEn = App.lang === 'en';
  const isJa = App.lang === 'ja';

  // 英語・日本語ともにトグルを表示（ラベルは言語で切替）
  $('guide-toggle-row').style.display = 'flex';
  $('guide-toggle-label').textContent = isJa ? '🔤 ローマ字 / 発音ガイド' : '🔤 発音ガイド';
  const tg = $('guide-toggle');
  tg.textContent = guideOn ? 'ON' : 'OFF';
  tg.classList.toggle('off', !guideOn);

  // テキスト表示をリセット
  target.textContent = chunk;
  target.classList.remove('ph-mode');
  $('ph-legend').style.display = 'none';
  $('ph-tips').innerHTML = '';
  $('romaji-row').style.display = 'none';

  if (isEn && guideOn) {
    // 英語: リンキング / t脱落 / フラップT などを可視化
    const { html, tips } = Phonics.renderHTML(chunk);
    target.innerHTML = html;
    target.classList.add('ph-mode');
    $('ph-legend').style.display = 'flex';
    $('ph-tips').innerHTML = tips.length
      ? '<div class="ph-tips-title">💡 発音のコツ</div>' +
        tips.map(t => `<div class="ph-tip">${escHtml(t)}</div>`).join('')
      : '';
  } else if (isJa && guideOn) {
    // 日本語: ローマ字 + 発音ヒント
    _showRomaji(chunk);
    const jatips = JapanesePhonics.analyze(chunk);
    if (jatips.length) {
      $('ph-tips').innerHTML = '<div class="ph-tips-title">💡 Pronunciation Tips</div>' +
        jatips.map(t => `<div class="ph-tip">${escHtml(t)}</div>`).join('');
    }
  }
}

// ローマ字を表示（カナは即時変換、漢字はAI変換）
async function _showRomaji(chunk) {
  const romajiRow = $('romaji-row');
  const romajiEl  = $('romaji-text');
  romajiRow.style.display = 'block';

  if (Romaji.hasKanji(chunk) && typeof AI !== 'undefined' && AI.hasKey()) {
    // 漢字あり + APIキーあり: 中途半端な変換を出さずAI待ち
    romajiEl.innerHTML = '<span class="romaji-loading">Converting to romaji…</span>';
    const aiResult = await Romaji.convertWithAI(chunk);
    if ($('romaji-row').style.display !== 'none') {
      romajiEl.textContent = aiResult || Romaji.convert(chunk);
    }
  } else if (Romaji.hasKanji(chunk)) {
    // 漢字あり + APIキーなし: カナ変換 + 注記
    const quick = Romaji.convert(chunk);
    romajiEl.innerHTML = escHtml(quick) +
      '<span class="romaji-loading"> (add Claude API key for kanji → romaji)</span>';
  } else {
    // カナのみ: 即座に変換
    romajiEl.textContent = Romaji.convert(chunk);
  }
}

function toggleGuide() {
  Store.setGuideOn(!Store.getGuideOn());
  const step = currentStep();
  if (step && step.type === 'chunk') {
    renderPhonicsGuide(App.paragraphs[step.p].chunks[step.c]);
  }
}

const inflightParaTranslations = new Set();

async function getChunkTranslation(p, c) {
  const para = App.paragraphs[p];
  const label = App.lang === 'ja' ? u('英訳', 'English') : u('日本語訳', 'Japanese');

  // チャンクが1つだけの段落は段落対訳がそのままチャンク訳
  if (para.chunks.length === 1 && para.translation) {
    return { text: para.translation, label };
  }

  if (para.chunkTranslations[c]) return { text: para.chunkTranslations[c], label };

  // APIキーがあればパラグラフ単位で一括翻訳してキャッシュ
  if (AI.hasKey() && !inflightParaTranslations.has(p)) {
    inflightParaTranslations.add(p);
    try {
      const results = await AI.translateBatch(para.chunks, App.lang);
      para.chunkTranslations = results;
      saveSession();
      return { text: results[c], label };
    } catch {
      // 失敗時は無料翻訳へフォールバック
    } finally {
      inflightParaTranslations.delete(p);
    }
  }

  const t = await FreeTranslate.translate(para.chunks[c], App.lang);
  if (t && !t.startsWith('（')) {
    para.chunkTranslations[c] = t;
    saveSession();
    return { text: t, label };
  }

  // 最終フォールバック: 段落の対訳ペア（品質は高いが範囲が広い）
  if (para.translation) return { text: para.translation, label: label + '（段落全体）' };
  return { text: t, label };
}

function updatePracticeProgress() {
  const total = App.flow.length;
  const done = App.flow.filter(s => App.scores[stepKey(s)] !== undefined).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  $('practice-progress-fill').style.width = pct + '%';
  $('practice-progress-pct').textContent = pct + '%';
}

function updateCompletionBanner() {
  const allDone = App.flow.length > 0 &&
    App.flow.every(s => App.scores[stepKey(s)] !== undefined);
  $('completion-banner').classList.toggle('visible', allDone && !App.reviewMode);
}

let _speakScreen = null; // 現在再生中の screen id ('screen-practice'|'screen-run'|null)

function playNormal() {
  const s = _speakScreen;
  if (s) { _speakScreen = null; Speech.stop(); _setSpeakBtns(s, false); return; }
  const step = currentStep();
  _speakScreen = 'screen-practice';
  _setSpeakBtns('screen-practice', true);
  Speech.speak(App.paragraphs[step.p].chunks[step.c], App.lang, 1.0,
    () => { _speakScreen = null; _setSpeakBtns('screen-practice', false); });
}
function playSlow() {
  const s = _speakScreen;
  if (s) { _speakScreen = null; Speech.stop(); _setSpeakBtns(s, false); return; }
  const step = currentStep();
  _speakScreen = 'screen-practice';
  _setSpeakBtns('screen-practice', true);
  Speech.speak(App.paragraphs[step.p].chunks[step.c], App.lang, 0.65,
    () => { _speakScreen = null; _setSpeakBtns('screen-practice', false); });
}
function playMyVoice() { VoiceRecorder.play(); }

// ===== 3ステップ練習サイクル（Pimsleur: 通常→ゆっくり→録音）=====
let _cycleActive = false;

// ===== シャドーイング練習 =====
let _shadowActive = false;
let _shadowRecognizer = null;

function startShadowing() {
  if (_shadowActive) { stopShadowing(); return; }
  if (!localStorage.getItem('sc_shadow_warned')) {
    $('shadow-modal').classList.add('visible');
    return;
  }
  _doStartShadowing();
}

function shadowModalConfirm() {
  localStorage.setItem('sc_shadow_warned', '1');
  $('shadow-modal').classList.remove('visible');
  _doStartShadowing();
}

function closeShadowModal() {
  $('shadow-modal').classList.remove('visible');
}

function showMicBlockedModal() {
  $('mic-blocked-modal').classList.add('visible');
}
function closeMicBlockedModal() {
  $('mic-blocked-modal').classList.remove('visible');
}

function closeWelcomeModal() {
  localStorage.setItem('sc_onboarded', '1');
  $('welcome-modal').classList.remove('visible');
}

function _maybeShowWelcome() {
  if (!localStorage.getItem('sc_onboarded')) {
    // チュートリアルが新実装のため、旧welcome-modalは非表示
    setTimeout(() => Tut.start(), 300);
  }
}

// ===== チュートリアルエンジン =====
const TUT_STEPS = [
  // 0: ウェルカム
  { text: 'ゼノグノーシア.ai へようこそ！\n英語スピーキングを段階的に練習できるアプリです。\n基本の使い方を一緒に確認しましょう。', action: 'next', nextLabel: 'はじめる →' },
  // 1: 今すぐ始めるボタン
  { targetSel: '.home-card-hero .btn-hero-start', text: '「自己紹介の練習」から始めましょう。\n「今すぐ始める」ボタンを押してください。', action: 'click', screen: 'home' },
  // 2: 最初のトピック（名前・出身地）
  { targetSel: '#topic-list .topic-item', text: 'トピックの一覧が表示されました。\nまず「名前・出身地」を押してみましょう。', action: 'click', screen: 'topics' },
  // 3: テキスト編集説明
  { targetSel: '#td-textarea', text: '[ ] の部分を自分の情報に書き換えられます。\n[Your Name] を自分の名前、[Your City] を出身地に変えてみましょう。\n書き換えたら「次へ」を押してください。', action: 'next', allowInteract: true, screen: 'topics' },
  // 4: 保存ボタン
  { targetSel: '#topic-save-btn', text: '書き換えたら「保存する」を押してください。\n次回からも保存した文章で練習できます。', action: 'click', screen: 'topics' },
  // 5: 練習するボタン
  { targetSel: '#topic-practice-btn', text: '「このトピックを練習する」を押して、練習画面へ進みましょう。', action: 'click', screen: 'topics' },
  // 6: 使い方ヒント（リスト画面）
  { text: '使い方のヒント\n\n✓ チャンク練習 → パラグラフ通し → 全文通し、の順に階段式で練習できます\n✓ まず「ゆっくり再生」で音を確認し、真似して話しましょう\n✓ 録音すると採点され、自分の声の聞き返しもできます\n✓ ゴールは30分のネイティブ会話！', action: 'next', screen: 'list' },
  // 7: チャンクカード①
  { targetSel: '.chunk-card:first-child', text: '① のカードが「チャンク練習」です。\n文を小さなかたまりに分けて練習します。', action: 'next', screen: 'list' },
  // 8: パラグラフ通しボタン
  { targetSel: '.para-run-btn', text: 'このボタンでパラグラフ全体をまとめて練習できます。', action: 'next', screen: 'list' },
  // 9: 全文通しボタン
  { targetSel: '#full-mode-btn', text: '全文を通して練習するボタンもあります。\nまずはチャンク①から始めましょう。', action: 'next', screen: 'list' },
  // 10: チャンク①を押す
  { targetSel: '.chunk-card:first-child', text: '①のチャンクを押して練習を始めましょう！', action: 'click', screen: 'list' },
  // 11: 再生ボタン
  { targetSel: '.btn-play', text: '「再生」を押してAIの発音を聞いてみましょう。', action: 'click', screen: 'practice' },
  // 12: ゆっくりボタン
  { targetSel: '.btn-slow', text: '「ゆっくり」を押すとゆっくり聞けます。\nしっかり音を確認しましょう。', action: 'click', screen: 'practice' },
  // 13: 録音ボタン（テキストも見えるように chunk-display まで含めてハイライト）
  { targetSel: '.btn-record', topBoundSel: '.chunk-display', text: 'テキストを見ながら「録音」を押してマイクに向かって話してみましょう。\nブラウザからマイク許可を求められたら「許可」してください。\n話し終わったら「次へ」を押してください。', action: 'next', allowInteract: true, screen: 'practice' },
  // 14: 発音結果（result-areaは録音後に表示されるため、ターゲット指定なし）
  { text: '発音が認識されるとスコアが表示されます。\n緑=正しく発音できた部分、赤=認識されなかった部分です。\n何度でも練習してスコアを上げましょう！', action: 'next', screen: 'practice' },
  // 15: 自分の声ボタン
  { targetSel: '#myvoice-btn', text: '「自分の声」ボタンで録音を聞き返せます。\n自分の発音を客観的に確認しましょう。', action: 'next', screen: 'practice' },
  // 16: 発音ガイドボタン
  { targetSel: '#guide-toggle', text: '「発音ガイド」をONにすると、強調する音やリンキングのコツが表示されます。', action: 'next', screen: 'practice' },
  // 17: 次へボタン
  { targetSel: '#next-btn', text: '「次へ」で次のチャンクに進みます。\nチャンク→パラグラフ→全文の順に進んでいきます。', action: 'next', screen: 'practice' },
  // 18: ナビ説明
  { targetSel: '#practice-back-btn', text: '「チャンク一覧へ」でチャンク一覧に戻れます。\nヘッダーの「🏠 ホーム」でトップページに戻れます。', action: 'next', screen: 'practice' },
  // 19: 完了
  { text: 'チュートリアル完了です！🎉\nあとは自由に練習してみましょう。\nゴールは30分のネイティブ会話。ゼノグノーシア.aiが一緒に応援します！', action: 'next', nextLabel: '練習を始める！', screen: 'practice' }
];

const Tut = {
  idx: 0,
  active: false,
  _prevClickTarget: null,
  _prevHandler: null,
  _currentEl: null,
  _wheelHandler: null,
  _resizeHandler: null,

  start() {
    this.idx = 0;
    this.active = true;
    this._currentEl = null;

    // ホイール・タッチスクロールを完全ブロック（passive:false 必須）
    this._wheelHandler = (e) => { e.preventDefault(); };
    window.addEventListener('wheel',     this._wheelHandler, { passive: false });
    window.addEventListener('touchmove', this._wheelHandler, { passive: false });

    // リサイズ時にスポットライトを再計算
    this._resizeHandler = () => {
      if (this.active && this._currentEl) {
        const step = TUT_STEPS[this.idx];
        this._spotlight(this._currentEl, step.action === 'click', !!step.allowInteract, step.topBoundSel || null);
      }
    };
    window.addEventListener('resize', this._resizeHandler);

    this._render();
  },

  next() {
    this._cleanup();
    this.idx++;
    if (this.idx >= TUT_STEPS.length) { this.finish(); return; }
    this._render();
  },

  skip() { this.finish(); },

  finish() {
    this.active = false;
    localStorage.setItem('sc_onboarded', '1');
    this._cleanup();
    this._hideAllOverlays();
    $('tut-card').style.display = 'none';
    this._unlockScroll();
  },

  _lockScroll() {
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
  },

  _unlockScroll() {
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    if (this._wheelHandler) {
      window.removeEventListener('wheel',     this._wheelHandler);
      window.removeEventListener('touchmove', this._wheelHandler);
      this._wheelHandler = null;
    }
    if (this._resizeHandler) {
      window.removeEventListener('resize', this._resizeHandler);
      this._resizeHandler = null;
    }
  },

  _render() {
    this._currentEl = null;
    const step = TUT_STEPS[this.idx];
    $('tut-step-num').textContent = `ステップ ${this.idx + 1} / ${TUT_STEPS.length}`;
    $('tut-text').textContent = step.text;
    $('tut-card').style.display = 'block';
    const nextBtn = $('tut-next-btn');
    nextBtn.textContent = step.nextLabel || '次へ →';
    nextBtn.style.display = step.action === 'next' ? 'block' : 'none';

    if (step.targetSel) {
      const el = document.querySelector(step.targetSel);
      if (el) {
        this._currentEl = el;
        // overflow を一瞬解除して instant スクロール → RAF後に再ロック
        document.documentElement.style.overflow = '';
        document.body.style.overflow = '';
        el.scrollIntoView({ behavior: 'instant', block: 'center' });
        requestAnimationFrame(() => {
          this._lockScroll();
          this._spotlight(el, step.action === 'click', !!step.allowInteract, step.topBoundSel || null);
        });
        if (step.action === 'click') {
          const handler = () => {
            el.removeEventListener('click', handler, true);
            this._prevClickTarget = null;
            this._prevHandler = null;
            // 次画面への遷移を許可するため unlock（wheel ブロックは維持）
            document.documentElement.style.overflow = '';
            document.body.style.overflow = '';
            setTimeout(() => {
              // 新しいスクリーンでもホイールは引き続きブロック
              if (!this._wheelHandler) {
                this._wheelHandler = (e) => { e.preventDefault(); };
                window.addEventListener('wheel',     this._wheelHandler, { passive: false });
                window.addEventListener('touchmove', this._wheelHandler, { passive: false });
              }
              this.next();
            }, 500);
          };
          el.addEventListener('click', handler, true);
          this._prevClickTarget = el;
          this._prevHandler = handler;
        }
      } else {
        this._setFullScreenMask();
      }
    } else {
      this._setFullScreenMask();
    }
  },

  _setFullScreenMask() {
    this._lockScroll();
    const top = $('tut-mask-top');
    if (top) Object.assign(top.style, { display:'block', top:'0', left:'0', right:'0', bottom:'0', height:'' });
    ['tut-mask-bottom','tut-mask-left','tut-mask-right','tut-highlight-box'].forEach(id => {
      const e = $(id); if (e) e.style.display = 'none';
    });
    const hb = $('tut-hole-blocker');
    if (hb) hb.style.display = 'none';
    const card = $('tut-card');
    if (card) Object.assign(card.style, {
      top: '50%', left: '50%', right: 'auto', bottom: 'auto',
      transform: 'translate(-50%, -50%)', width: 'calc(100% - 32px)'
    });
  },

  _spotlight(el, isClickable, allowInteract = false, topBoundSel = null) {
    const r = el.getBoundingClientRect();
    // 要素が非表示（録音結果エリアなど）の場合はフルスクリーンマスクへ
    if (r.width === 0 && r.height === 0) { this._setFullScreenMask(); return; }
    const p = 8;
    // topBoundSel が指定されていればその要素の上端まで含めてハイライト
    let rawTop = r.top;
    if (topBoundSel) {
      const topEl = document.querySelector(topBoundSel);
      if (topEl) {
        const tr = topEl.getBoundingClientRect();
        rawTop = Math.min(r.top, tr.top);
      }
    }
    const top    = Math.max(0, rawTop - p);
    const bottom = Math.min(window.innerHeight, r.bottom + p);
    const left   = Math.max(0, r.left - p);
    const right  = Math.min(window.innerWidth, r.right + p);

    const st = (id, css) => { const e = $(id); if (e) Object.assign(e.style, css); };
    st('tut-mask-top',    { display:'block', top:'0', left:'0', right:'0', height: top + 'px', bottom:'' });
    st('tut-mask-bottom', { display:'block', top: bottom + 'px', left:'0', right:'0', bottom:'0', height:'' });
    st('tut-mask-left',   { display:'block', top: top+'px', left:'0', right:'', width: left+'px', height: (bottom-top)+'px', bottom:'' });
    st('tut-mask-right',  { display:'block', top: top+'px', left: right+'px', right:'0', width:'', height: (bottom-top)+'px', bottom:'' });
    st('tut-highlight-box', {
      display: 'block',
      top: top + 'px', left: left + 'px',
      width: (right - left) + 'px', height: (bottom - top) + 'px',
      bottom: '', right: ''
    });

    const hb = $('tut-hole-blocker');
    if (hb) {
      if (isClickable || allowInteract) {
        hb.style.display = 'none';
      } else {
        Object.assign(hb.style, {
          display: 'block',
          top: top + 'px', left: left + 'px',
          width: (right - left) + 'px', height: (bottom - top) + 'px',
          bottom: '', right: ''
        });
      }
    }

    // スペース計算でカードをスポットライトと重ならない位置に配置
    const card = $('tut-card');
    if (card) {
      const vh = window.innerHeight;
      const cardH = 210;
      const spaceBelow = vh - bottom;
      const spaceAbove = top;
      if (isClickable) {
        // クリックステップ: カードをターゲット上に絶対に置かない
        // スペースが大きい側に必ず配置（空間不足でも重ならない方を優先）
        if (spaceBelow >= spaceAbove) {
          Object.assign(card.style, {
            top: (bottom + 12) + 'px', bottom: 'auto',
            left: '16px', right: '16px',
            transform: 'none', width: 'auto'
          });
        } else {
          Object.assign(card.style, {
            top: Math.max(56, top - cardH - 12) + 'px', bottom: 'auto',
            left: '16px', right: '16px',
            transform: 'none', width: 'auto'
          });
        }
      } else if (spaceBelow >= cardH + 24) {
        Object.assign(card.style, {
          top: (bottom + 16) + 'px', bottom: 'auto',
          left: '16px', right: '16px',
          transform: 'none', width: 'auto'
        });
      } else if (spaceAbove >= cardH + 24) {
        Object.assign(card.style, {
          top: Math.max(60, top - cardH - 16) + 'px', bottom: 'auto',
          left: '16px', right: '16px',
          transform: 'none', width: 'auto'
        });
      } else {
        Object.assign(card.style, {
          top: '50%', left: '50%', right: 'auto', bottom: 'auto',
          transform: 'translate(-50%, -50%)', width: 'calc(100% - 32px)'
        });
      }
    }
  },

  _hideAllOverlays() {
    ['tut-mask-top','tut-mask-bottom','tut-mask-left','tut-mask-right','tut-highlight-box'].forEach(id => {
      const e = $(id); if (e) e.style.display = 'none';
    });
    const hb = $('tut-hole-blocker');
    if (hb) hb.style.display = 'none';
  },

  _cleanup() {
    if (this._prevClickTarget && this._prevHandler) {
      this._prevClickTarget.removeEventListener('click', this._prevHandler, true);
      this._prevClickTarget = null;
      this._prevHandler = null;
    }
  }
};

function _doStartShadowing() {
  if (!Speech.supported()) {
    alert(u('音声認識はChrome（PC・Android）またはSafari（iPhone）でご利用ください。', 'Speech recognition requires Chrome or Safari.'));
    return;
  }
  $('screen-practice').classList.add('shadowing-active');
  const step = currentStep();
  if (!step || step.type !== 'chunk') return;
  const text = App.paragraphs[step.p].chunks[step.c];

  stopAllAudio();
  _shadowActive = true;

  const btn = $('shadow-btn');
  if (btn) { btn.classList.add('active'); $('shadow-label').textContent = u('⏸ 停止', '⏸ Stop'); }

  $('result-area').classList.remove('visible');
  $('result-text').innerHTML = '';
  $('chunk-result-legend').style.display = 'none';
  $('result-label-text').textContent = u('シャドーイング結果', 'Shadowing Result');

  // TTS再生開始
  Speech.speak(text, App.lang, 1.0, () => {
    // TTS終了後1.5秒待ってSTT停止（後続発話を拾うため）
    if (_shadowActive) setTimeout(() => { if (_shadowActive && _shadowRecognizer) _shadowRecognizer.stop(); }, 1500);
  });

  // 0.5秒後にSTT開始（ユーザーが最初の数語を聞いてから発話するタイミング）
  setTimeout(() => {
    if (!_shadowActive) return;
    _shadowRecognizer = Speech.createRecognizer({
      lang: App.lang,
      continuous: true,
      onInterim: (t) => {
        $('result-text').textContent = '"' + t + '"';
        $('chunk-result-legend').style.display = 'none';
        $('result-area').classList.add('visible');
      },
      onEnd: (transcript) => {
        _shadowActive = false;
        _shadowRecognizer = null;
        const b = $('shadow-btn');
        if (b) { b.classList.remove('active'); $('shadow-label').textContent = u('シャドーイング練習（AIと同時に発音）', 'Shadowing Drill'); }
        $('result-label-text').textContent = u('あなたの発音（認識結果）', 'Your speech (recognized)');
        if (transcript) {
          const score = Score.calc(text, transcript, App.lang);
          $('result-text').innerHTML = Score.highlight(text, transcript, App.lang);
          $('chunk-result-legend').style.display = '';
          $('result-area').classList.add('visible');
          showChunkScore(score);
          const key = stepKey(step);
          if (App.scores[key] === undefined || score > App.scores[key]) {
            App.scores[key] = score;
            saveSession();
            updatePracticeProgress();
            updateCompletionBanner();
          }
        } else {
          $('result-text').textContent = u('音声が認識されませんでした。イヤホンを使用しているか確認してください。', 'No speech detected. Please check your earphones.');
          $('result-area').classList.add('visible');
        }
      },
      onError: (err) => {
        _shadowActive = false;
        _shadowRecognizer = null;
        const b = $('shadow-btn');
        if (b) { b.classList.remove('active'); $('shadow-label').textContent = u('シャドーイング練習（AIと同時に発音）', 'Shadowing Drill'); }
        $('result-label-text').textContent = u('あなたの発音（認識結果）', 'Your speech (recognized)');
        if (err === 'no-speech') {
          $('result-text').textContent = u('音声が検出されませんでした', 'No speech detected');
          $('result-area').classList.add('visible');
        }
      }
    });
    _shadowRecognizer.start();
  }, 500);
}

function stopShadowing() {
  _shadowActive = false;
  Speech.stop();
  if (_shadowRecognizer) { _shadowRecognizer.abort(); _shadowRecognizer = null; }
  const b = $('shadow-btn');
  if (b) { b.classList.remove('active'); $('shadow-label').textContent = u('シャドーイング練習（AIと同時に発音）', 'Shadowing Drill'); }
  $('result-label-text').textContent = u('あなたの発音（認識結果）', 'Your speech (recognized)');
  $('screen-practice').classList.remove('shadowing-active');
}

// ===== バックチェイニング練習（Pimsleur: 末尾から積み上げ）=====
let _bcActive = false;
let _bcSteps = [];
let _bcIdx = 0;
let _bcRecognizer = null;
let _bcAdvanceMode = localStorage.getItem('sc_bc_advance') || 'perfect';

function setBcAdvance(mode) {
  _bcAdvanceMode = mode;
  localStorage.setItem('sc_bc_advance', mode);
}

function playCycle() {
  if (_cycleActive) { stopAllAudio(); return; }
  if (!Speech.supported()) { alert('音声認識はChrome（PC・Android）またはSafari（iPhone）でご利用ください。'); return; }

  _cycleActive = true;
  const btn = $('cycle-btn');
  btn.classList.add('cycling');
  $('cycle-icon').textContent = '⏸';
  $('cycle-label').textContent = u('停止', 'Stop');

  const step = currentStep();
  const text = App.paragraphs[step.p].chunks[step.c];

  const runStep = (stepNum) => {
    if (!_cycleActive) return;
    if (stepNum === 1) {
      $('cycle-label').textContent = u('1/3 通常再生中…', 'Step 1/3: Listening…');
      _speakScreen = 'screen-practice';
      _setSpeakBtns('screen-practice', true);
      Speech.speak(text, App.lang, 1.0, () => { if (_cycleActive) setTimeout(() => runStep(2), 500); else _setSpeakBtns('screen-practice', false); });
    } else if (stepNum === 2) {
      $('cycle-label').textContent = u('2/3 ゆっくり再生中…', 'Step 2/3: Slow…');
      Speech.speak(text, App.lang, 0.65, () => {
        if (!_cycleActive) { _speakScreen = null; _setSpeakBtns('screen-practice', false); return; }
        _speakScreen = null;
        _setSpeakBtns('screen-practice', false);
        setTimeout(() => runStep(3), 600);
      });
    } else {
      _cycleActive = false;
      btn.classList.remove('cycling');
      $('cycle-icon').textContent = '🔄';
      $('cycle-label').textContent = u('3ステップ練習（聞く → ゆっくり → 録音）', '3-Step Drill (listen → slow → speak)');
      startChunkRecording();
    }
  };
  runStep(1);
}

function _bcBuildSteps(text, lang) {
  let tokens;
  if (lang === 'en') {
    tokens = text.split(/\s+/).filter(Boolean);
  } else {
    const chars = [...text];
    if (chars.length <= 4) return [text];
    const mid = Math.ceil(chars.length / 2);
    tokens = [chars.slice(0, mid).join(''), chars.slice(mid).join('')];
  }
  if (tokens.length <= 1) return tokens;
  const sep = lang === 'ja' ? '' : ' ';
  const steps = [];
  for (let i = 1; i <= tokens.length; i++) {
    steps.push(tokens.slice(tokens.length - i).join(sep));
  }
  return steps;
}

function startBackchain() {
  if (_bcActive) { stopBackchain(); return; }
  const step = currentStep();
  const text = App.paragraphs[step.p].chunks[step.c];
  _bcSteps = _bcBuildSteps(text, App.lang);
  if (_bcSteps.length <= 1) {
    alert(u('このチャンクは短すぎてバックチェイニングできません', 'Chunk too short for back-chaining'));
    return;
  }
  stopAllAudio();
  _bcActive = true;
  _bcIdx = 0;
  $('screen-practice').classList.add('bc-focus');
  $('bc-panel').style.display = 'block';
  const advSel = $('bc-advance-sel');
  if (advSel) advSel.value = _bcAdvanceMode;
  bcRenderStep();
  bcPlay();
}

function stopBackchain() {
  _bcActive = false;
  if (_bcRecognizer) { _bcRecognizer.abort(); _bcRecognizer = null; }
  Speech.stop();
  $('screen-practice').classList.remove('bc-focus');
  const bcPanel = $('bc-panel');
  if (bcPanel) bcPanel.style.display = 'none';
  const bcBtn = $('bc-btn');
  if (bcBtn) { bcBtn.classList.remove('active'); $('bc-btn-label').textContent = u('バックチェイニング練習（末尾から積み上げ）', 'Back-chaining Drill'); $('bc-icon').textContent = '⬅'; }
}

function bcRenderStep() {
  const phrase = _bcSteps[_bcIdx];
  const total = _bcSteps.length;
  $('bc-step-tag').textContent = u(`ステップ ${_bcIdx + 1}/${total}`, `Step ${_bcIdx + 1}/${total}`);
  $('bc-phrase').textContent = phrase;
  $('bc-result-text').style.display = 'none';
  $('bc-result-text').innerHTML = '';
  $('bc-score-row').style.display = 'none';
  $('bc-rec-indicator').style.display = 'none';
  const cel = $('bc-celebrate');
  if (cel) cel.classList.remove('visible');
  const rec = $('bc-record-btn');
  rec.classList.remove('recording');
  rec.textContent = u('🎤 録音', '🎤 Record');
  $('bc-prev-btn').disabled = _bcIdx === 0;
  $('bc-next-btn').textContent = _bcIdx === total - 1 ? u('完了 ✓', 'Finish ✓') : u('次へ →', 'Next →');
}

function bcPlay() {
  if (!_bcActive) return;
  Speech.stop();
  Speech.speak(_bcSteps[_bcIdx], App.lang, 1.0, () => {
    if (_bcActive && !_bcRecognizer) setTimeout(() => { if (_bcActive) bcRecord(); }, 500);
  });
}

function bcRecord() {
  if (!Speech.supported()) { alert(u('音声認識はChrome（PC・Android）またはSafari（iPhone）でご利用ください。', 'Speech recognition requires Chrome or Safari.')); return; }
  if (!_bcActive) return;
  if (_bcRecognizer) {
    _bcRecognizer.abort(); _bcRecognizer = null;
    $('bc-record-btn').classList.remove('recording');
    $('bc-record-btn').textContent = u('🎤 録音', '🎤 Record');
    $('bc-rec-indicator').style.display = 'none';
    return;
  }
  Speech.stop();
  const phrase = _bcSteps[_bcIdx];
  $('bc-record-btn').classList.add('recording');
  $('bc-record-btn').textContent = u('⏸ 停止', '⏸ Stop');
  $('bc-rec-indicator').style.display = 'flex';
  _bcRecognizer = Speech.createRecognizer({
    lang: App.lang,
    continuous: false,
    onInterim: (t) => {
      $('bc-result-text').textContent = '"' + t + '"';
      $('bc-result-text').style.display = 'block';
    },
    onFinal: (transcript) => {
      _bcRecognizer = null;
      $('bc-rec-indicator').style.display = 'none';
      $('bc-record-btn').classList.remove('recording');
      $('bc-record-btn').textContent = u('🎤 録音', '🎤 Record');
      const score = Score.calc(phrase, transcript, App.lang);
      const fb = Score.feedback(score, App.lang);
      $('bc-result-text').innerHTML = Score.highlight(phrase, transcript, App.lang);
      $('bc-result-text').style.display = 'block';
      $('bc-score-row').style.display = 'flex';
      $('bc-score-bar').style.width = score + '%';
      $('bc-score-bar').style.background = fb.color;
      $('bc-score-number').textContent = score + '%';
      $('bc-score-number').style.color = fb.color;
      // 自動進行
      if (score === 100) {
        bcCelebrate(_bcAdvanceMode !== 'off');
      } else if (_bcAdvanceMode === 'always') {
        setTimeout(() => { if (_bcActive) bcNext(); }, 900);
      }
    },
    onError: (err) => {
      _bcRecognizer = null;
      $('bc-rec-indicator').style.display = 'none';
      $('bc-record-btn').classList.remove('recording');
      $('bc-record-btn').textContent = u('🎤 録音', '🎤 Record');
      if (err === 'no-speech') {
        $('bc-result-text').textContent = u('音声が検出されませんでした', 'No speech detected');
        $('bc-result-text').style.display = 'block';
      }
    },
    onEnd: () => { if (_bcRecognizer) { _bcRecognizer = null; $('bc-rec-indicator').style.display = 'none'; $('bc-record-btn').classList.remove('recording'); } }
  });
  _bcRecognizer.start();
}

function bcCelebrate(autoAdvance) {
  const cel = $('bc-celebrate');
  const sub = $('bc-celebrate-sub');
  if (sub) sub.textContent = autoAdvance
    ? u('次のステップへ移動中...', 'Moving to next step...')
    : u('次へボタンで続けましょう！', 'Press Next to continue!');
  if (cel) cel.classList.add('visible');
  const delay = autoAdvance ? 1500 : 2000;
  setTimeout(() => {
    if (cel) cel.classList.remove('visible');
    if (autoAdvance && _bcActive) bcNext();
  }, delay);
}

function bcNext() {
  if (!_bcActive) return;
  if (_bcRecognizer) { _bcRecognizer.abort(); _bcRecognizer = null; }
  Speech.stop();
  if (_bcIdx >= _bcSteps.length - 1) { stopBackchain(); return; }
  _bcIdx++;
  bcRenderStep();
  bcPlay();
}

function bcPrev() {
  if (!_bcActive || _bcIdx <= 0) return;
  if (_bcRecognizer) { _bcRecognizer.abort(); _bcRecognizer = null; }
  Speech.stop();
  _bcIdx--;
  bcRenderStep();
  bcPlay();
}

let _silenceTimer = null;
let _runSilenceTimer = null;

function showSilenceHint() {
  const sh = $('silence-hint');
  if (sh) sh.style.display = 'block';
}
function hideSilenceHint() {
  const sh = $('silence-hint');
  if (sh) sh.style.display = 'none';
}

function toggleRecord() {
  if (chunkRecognizer && chunkRecognizer.active) {
    clearTimeout(_silenceTimer);
    hideSilenceHint();
    chunkRecognizer.stop();
    VoiceRecorder.stop();
    setRecordUI(false);
    return;
  }
  startChunkRecording();
}

function startChunkRecording() {
  if (!Speech.supported()) {
    alert('音声認識はChrome（PC・Android）またはSafari（iPhone）でご利用ください。');
    return;
  }
  const step = currentStep();
  const target = App.paragraphs[step.p].chunks[step.c];

  Speech.stop();
  _speakScreen = null;
  _setSpeakBtns('screen-practice', false);
  VoiceRecorder.start();

  chunkRecognizer = Speech.createRecognizer({
    lang: App.lang,
    continuous: false,
    onInterim: (t) => {
      if (t) { clearTimeout(_silenceTimer); hideSilenceHint(); }
      $('result-text').textContent = '"' + t + '"';
      $('chunk-result-legend').style.display = 'none';
      $('result-area').classList.add('visible');
    },
    onFinal: (transcript) => {
      clearTimeout(_silenceTimer);
      hideSilenceHint();
      VoiceRecorder.stop();
      const score = Score.calc(target, transcript, App.lang);
      $('result-text').innerHTML = Score.highlight(target, transcript, App.lang);
      $('chunk-result-legend').style.display = '';
      $('result-area').classList.add('visible');
      showChunkScore(score);
      App.scores[stepKey(step)] = score;
      saveSession();
      updatePracticeProgress();
      updateCompletionBanner();
      setRecordUI(false);
      $('myvoice-btn').disabled = !VoiceRecorder.hasRecording();
    },
    onError: (err) => {
      clearTimeout(_silenceTimer);
      hideSilenceHint();
      VoiceRecorder.stop();
      setRecordUI(false);
      if (err === 'no-speech') {
        $('result-text').textContent = u('音声が検出されませんでした。もう一度お試しください。', 'No speech detected. Please try again.');
        $('result-area').classList.add('visible');
        showSilenceHint();
      } else if (err === 'not-allowed') {
        showMicBlockedModal();
      }
    },
    onEnd: () => { clearTimeout(_silenceTimer); setRecordUI(false); }
  });
  chunkRecognizer.start();
  setRecordUI(true);
  _silenceTimer = setTimeout(showSilenceHint, 5000);
}

function setRecordUI(recording) {
  $('record-btn').classList.toggle('recording', recording);
  $('record-label').textContent = recording ? u('停止', 'Stop') : u('録音', 'Record');
  $('rec-indicator').classList.toggle('visible', recording);
  setPracticeState(recording ? 'recording' : 'idle');
  if (!recording) hideSilenceHint();
}

function showChunkScore(score) {
  const fb = Score.feedback(score, App.lang);
  $('score-bar').style.width = score + '%';
  $('score-bar').style.background = fb.color;
  $('score-number').textContent = score + '%';
  $('score-number').style.color = fb.color;
  $('score-comment').textContent = fb.comment;
  $('score-comment').style.color = fb.color;
}

// 自分の声の録音完了時にボタンを有効化
document.addEventListener('voicerecorded', () => {
  $('myvoice-btn').disabled = !VoiceRecorder.hasRecording();
});

// ===== Run-through (paragraph / full) =====
function runStepText() {
  const step = currentStep();
  return step.type === 'full' ? fullText() : paraText(step.p);
}

function renderRun() {
  const step = currentStep();
  const isFull = step.type === 'full';

  $('run-title').textContent = isFull
    ? u('全文通し練習', 'Full Text Practice')
    : u(`パラグラフ ${step.p + 1} 通し練習`, `Paragraph ${step.p + 1} Practice`);
  $('run-tag').textContent = isFull
    ? u('全文通し練習', 'Full Text Practice')
    : u('パラグラフ通し練習', 'Paragraph Practice');
  $('run-tag').className = 'step-tag ' + (isFull ? 'tag-full' : 'tag-para');
  $('run-text').textContent = runStepText();

  $('run-result-area').classList.remove('visible');
  $('run-interim-box').classList.remove('visible');
  $('run-interim').textContent = '';
  setRunRecordUI(false);
  const afterGuide = $('run-after-guide');
  if (afterGuide) afterGuide.style.display = 'none';
  const phHint = $('run-placeholder-hint');
  if (phHint) phHint.style.display = /\[[^\]]*\]/.test(runStepText()) ? 'block' : 'none';

  const prev = App.scores[stepKey(step)];
  const tag = $('run-best-tag');
  if (prev !== undefined) {
    tag.textContent = u('自己ベスト: ', 'Best: ') + prev + '%';
    tag.style.display = 'inline';
  } else {
    tag.style.display = 'none';
  }

  $('run-prev-btn').disabled = App.flowIndex === 0;
  $('run-next-btn').disabled = App.flowIndex === App.flow.length - 1;
  const nextStep = App.flow[App.flowIndex + 1];
  $('run-next-btn').textContent = nextStep
    ? (nextStep.type === 'chunk'
        ? u(`次へ（パラグラフ ${nextStep.p + 1}）→`, `Next (Para ${nextStep.p + 1}) →`)
        : u('次へ（全文通し）→', 'Next (Full) →'))
    : u('次へ →', 'Next →');

  // トピック練習中はバックボタンを「自己紹介一覧に戻る」に変更
  const runBack = $('run-back-btn');
  if (runBack) {
    if (App.topicId) {
      runBack.textContent = u('← 自己紹介一覧に戻る', '← Back to Topics');
      runBack.onclick = backToTopicListFromRun;
    } else {
      runBack.textContent = u('← チャンク一覧へ', '← Chunk List');
      runBack.onclick = () => showScreen('list');
    }
  }
}

function playRunNormal() {
  const s = _speakScreen;
  if (s) { _speakScreen = null; Speech.stop(); _setSpeakBtns(s, false); return; }
  _speakScreen = 'screen-run';
  _setSpeakBtns('screen-run', true);
  Speech.speak(runStepText(), App.lang, 1.0,
    () => { _speakScreen = null; _setSpeakBtns('screen-run', false); });
}
function playRunSlow() {
  const s = _speakScreen;
  if (s) { _speakScreen = null; Speech.stop(); _setSpeakBtns(s, false); return; }
  _speakScreen = 'screen-run';
  _setSpeakBtns('screen-run', true);
  Speech.speak(runStepText(), App.lang, 0.65,
    () => { _speakScreen = null; _setSpeakBtns('screen-run', false); });
}

function toggleRunRecord() {
  if (runRecognizer && runRecognizer.active) {
    clearTimeout(_runSilenceTimer);
    runRecognizer.stop();
    return;
  }
  startRunRecording();
}

function startRunRecording() {
  if (!Speech.supported()) {
    alert('音声認識はChrome（PC・Android）またはSafari（iPhone）でご利用ください。');
    return;
  }
  Speech.stop();
  $('run-interim').textContent = '';
  $('run-interim-box').classList.add('visible');
  $('run-result-area').classList.remove('visible');

  const SILENCE_MS = 5000;
  const resetSilenceTimer = () => {
    clearTimeout(_runSilenceTimer);
    _runSilenceTimer = setTimeout(() => {
      if (runRecognizer && runRecognizer.active) runRecognizer.stop();
    }, SILENCE_MS);
  };

  runRecognizer = Speech.createRecognizer({
    lang: App.lang,
    continuous: true,
    onInterim: (t) => {
      $('run-interim').textContent = t;
      if (t) resetSilenceTimer();
    },
    onError: (err) => {
      clearTimeout(_runSilenceTimer);
      if (err === 'not-allowed') {
        showMicBlockedModal();
        setRunRecordUI(false);
      }
    },
    onEnd: (transcript) => {
      clearTimeout(_runSilenceTimer);
      setRunRecordUI(false);
      $('run-interim-box').classList.remove('visible');
      if (transcript) finalizeRunScore(transcript);
    }
  });
  runRecognizer.start();
  setRunRecordUI(true);
  resetSilenceTimer();
}

function setRunRecordUI(rec) {
  $('run-record-btn').classList.toggle('recording', rec);
  $('run-record-label').textContent = rec ? u('⏹ 採点する', '⏹ Stop & Score') : u('録音する', 'Record');
  const hint = $('run-record-hint');
  if (hint) hint.style.display = rec ? 'none' : 'block';
}

function finalizeRunScore(transcript) {
  const step = currentStep();
  const text = runStepText();
  const score = Score.calc(text, transcript, App.lang);

  const prev = App.scores[stepKey(step)];
  if (prev === undefined || score > prev) {
    App.scores[stepKey(step)] = score;
    saveSession();
  }
  const best = App.scores[stepKey(step)];
  $('run-best-tag').textContent = u('自己ベスト: ', 'Best: ') + best + '%';
  $('run-best-tag').style.display = 'inline';

  $('run-highlighted').innerHTML = Score.highlight(text, transcript, App.lang);
  $('run-result-area').classList.add('visible');

  const fb = Score.feedback(score, App.lang);
  $('run-score-bar').style.width = score + '%';
  $('run-score-bar').style.background = fb.color;
  $('run-score-number').textContent = score + '%';
  $('run-score-number').style.color = fb.color;
  $('run-score-comment').textContent = fb.comment;
  $('run-score-comment').style.color = fb.color;

  // 全文通し完了後: 導線を表示
  if (step.type === 'full') {
    const guide = $('run-after-guide');
    if (guide) guide.style.display = 'block';
    const topicBtn = $('run-topic-list-btn');
    if (topicBtn) topicBtn.style.display = App.topicId ? 'block' : 'none';
  }
}

function backToTopicListFromRun() {
  _maybeUpdateTopicProgress();
  showTopics();
}

// ===== AI Scene =====
const TOPIC_PRESETS = [
  { icon: '🙋', label: '自己紹介' },
  { icon: '🍽️', label: 'レストラン' },
  { icon: '✈️', label: '旅行' },
  { icon: '🛍️', label: '買い物' },
  { icon: '💼', label: '仕事の雑談' },
  { icon: '📞', label: '電話対応' },
  { icon: '🏥', label: '病院' },
  { icon: '🗺️', label: '道案内' },
  { icon: '🎨', label: '趣味の話' }
];

function setupTopicGrid() {
  const grid = $('topic-grid');
  TOPIC_PRESETS.forEach(t => {
    const btn = document.createElement('button');
    btn.className = 'topic-btn';
    btn.innerHTML = `<span class="topic-icon">${t.icon}</span><span>${t.label}</span>`;
    btn.onclick = () => {
      document.querySelectorAll('.topic-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      App.sceneOpts.topic = t.label;
      $('topic-input').value = '';
    };
    grid.appendChild(btn);
  });
}

function setSceneOpt(key, val) {
  App.sceneOpts[key] = val;
  const segId = key === 'lang' ? 'scene-lang-seg' : 'scene-level-seg';
  document.querySelectorAll(`#${segId} .seg-btn`).forEach(b =>
    b.classList.toggle('active', b.dataset.val === val));
}

function goToSceneSetup() {
  showScreen('scene');
  if (App.scene) renderScenePreview();
}

async function generateScene() {
  clearError('scene-error');
  const topic = $('topic-input').value.trim() || App.sceneOpts.topic;
  if (!topic) { showError('scene-error', 'トピックを選ぶか入力してください。'); return; }
  if (!AI.hasKey()) {
    showError('scene-error', 'AI生成にはClaude APIキーが必要です。右上の⚙設定から入力してください。');
    return;
  }

  showLoading('AIが会話を生成中...（10秒ほどかかります）');
  $('generate-btn').disabled = true;
  try {
    const scene = await AI.generateScene({
      topic,
      level: App.sceneOpts.level,
      lang: App.sceneOpts.lang
    });
    scene.lang = App.sceneOpts.lang;
    scene.level = App.sceneOpts.level;
    scene.topic = topic;
    App.scene = scene;
    renderScenePreview();
  } catch (e) {
    showError('scene-error', e.message);
  } finally {
    hideLoading();
    $('generate-btn').disabled = false;
  }
}

async function extendScene() {
  if (!App.scene) return;
  showLoading('続きを生成中...');
  try {
    const more = await AI.generateScene({
      topic: App.scene.topic,
      level: App.scene.level,
      lang: App.scene.lang,
      prevTurns: App.scene.turns
    });
    App.scene.turns = App.scene.turns.concat(more.turns);
    renderScenePreview();
  } catch (e) {
    showError('scene-error', e.message);
  } finally {
    hideLoading();
  }
}

function renderScenePreview() {
  const s = App.scene;
  $('scene-preview').style.display = 'block';
  $('scene-title').textContent = '💬 ' + s.title;
  $('scene-desc').textContent = s.scene + `（${s.turns.length}セリフ）`;
  const list = $('turn-list');
  list.innerHTML = '';
  s.turns.forEach(turn => {
    const div = document.createElement('div');
    div.className = 'turn-bubble ' + (turn.speaker === 'A' ? 'turn-a' : 'turn-b');
    div.innerHTML = `
      <div class="turn-speaker">${turn.speaker}</div>
      <div>${escHtml(turn.text)}</div>
      <div class="turn-ja">${escHtml(turn.translation)}</div>`;
    list.appendChild(div);
  });
}

// 会話シーン → チャンク練習（各セリフ=パラグラフ扱い）
function sceneToChunkPractice() {
  const s = App.scene;
  App.lang = s.lang;
  refreshLangUI();
  App.source = 'scene';
  App.paragraphs = s.turns.map(t => ({
    chunks: Chunker.split(t.text, s.lang),
    translation: t.translation,
    chunkTranslations: []
  })).filter(p => p.chunks.length);
  App.scores = {};
  App.reviewMode = false;
  App.sessionCreatedTs = Date.now();
  buildFlow();
  saveSession();
  showScreen('list');
}

// ===== Roleplay =====
const rp = {
  role: 'A',
  hide: false,
  idx: 0,
  scores: {},
  transcripts: {},
  recognizer: null,
  playing: false
};

function setRpRole(role) {
  rp.role = role;
  document.querySelectorAll('#rp-role-seg .seg-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.val === role));
}

function goToRoleplaySetup() {
  showScreen('roleplay');
  $('rp-setup').style.display = 'block';
  $('rp-stage-wrap').style.display = 'none';
  $('rp-summary').style.display = 'none';
  $('rp-counter').textContent = App.scene ? App.scene.title : '';
}

function exitRoleplay() {
  rpStopAll();
  showScreen('scene');
}

function rpStopAll() {
  rp.playing = false;
  Speech.stop();
  if (rp.recognizer) { rp.recognizer.abort(); rp.recognizer = null; }
}

function startRoleplay() {
  rpStopAll();
  rp.hide = $('rp-hide-text').checked;
  rp.idx = 0;
  rp.scores = {};
  rp.transcripts = {};
  $('rp-setup').style.display = 'none';
  $('rp-summary').style.display = 'none';
  $('rp-stage-wrap').style.display = 'block';
  rpStep();
}

function rpCurrentTurn() { return App.scene.turns[rp.idx]; }
function rpIsMyTurn() { return rpCurrentTurn().speaker === rp.role; }

function rpStep() {
  rpStopAll();
  const turns = App.scene.turns;
  if (rp.idx >= turns.length) { rpShowSummary(); return; }

  const turn = turns[rp.idx];
  const mine = turn.speaker === rp.role;

  $('rp-progress').textContent = `セリフ ${rp.idx + 1} / ${turns.length}`;
  $('rp-result').classList.remove('visible');
  $('rp-hint-btn').style.display = 'none';
  $('rp-retry-btn').style.display = mine ? 'block' : 'none';
  $('rp-next-btn').textContent = '次へ →';

  const status = $('rp-status');
  const line = $('rp-line');
  const trans = $('rp-translation');

  if (!mine) {
    status.textContent = '🔊 相手（' + turn.speaker + '）';
    status.className = 'rp-status partner';
    if (rp.hide) {
      line.textContent = '相手が話しています…（音声を聞き取ってください）';
      line.className = 'rp-line hidden-line';
      trans.textContent = '';
      $('rp-hint-btn').style.display = 'block';
    } else {
      line.textContent = turn.text;
      line.className = 'rp-line';
      trans.textContent = turn.translation;
    }
    // 相手のセリフを読み上げ → 終わったら自動で次（あなたの番）へ
    rp.playing = true;
    const myIdx = rp.idx;
    Speech.speak(turn.text, App.scene.lang, 1.0, () => {
      if (!rp.playing) return; // 手動で停止・操作済みなら自動進行しない
      rp.playing = false;
      setTimeout(() => { if (rp.idx === myIdx) rpNext(); }, 700);
    });
  } else {
    status.textContent = '🎤 あなた（' + turn.speaker + '）の番';
    status.className = 'rp-status you';
    if (rp.hide) {
      line.textContent = 'セリフを思い出して話してください';
      line.className = 'rp-line hidden-line';
      trans.textContent = turn.translation; // 訳はヒントとして表示
      $('rp-hint-btn').style.display = 'block';
    } else {
      line.textContent = turn.text;
      line.className = 'rp-line';
      trans.textContent = turn.translation;
    }
    setTimeout(() => rpStartRecording(), 400);
  }
}

function rpStartRecording() {
  if (!Speech.supported()) { alert('音声認識はChrome（PC・Android）またはSafari（iPhone）でご利用ください。'); return; }
  if (rp.idx >= App.scene.turns.length || !rpIsMyTurn()) return;
  const turn = rpCurrentTurn();

  rp.recognizer = Speech.createRecognizer({
    lang: App.scene.lang,
    continuous: false,
    onInterim: (t) => {
      $('rp-result-text').textContent = '"' + t + '"';
      $('rp-result').classList.add('visible');
    },
    onFinal: (transcript) => {
      const score = Score.calc(turn.text, transcript, App.scene.lang);
      rp.scores[rp.idx] = score;
      rp.transcripts[rp.idx] = transcript;
      const fb = Score.feedback(score, App.lang);
      $('rp-result-text').textContent = '"' + transcript + '"';
      $('rp-score-bar').style.width = score + '%';
      $('rp-score-bar').style.background = fb.color;
      $('rp-score-number').textContent = score + '%';
      $('rp-score-number').style.color = fb.color;
      $('rp-result').classList.add('visible');
    },
    onError: (err) => {
      if (err === 'no-speech') {
        $('rp-result-text').textContent = '音声が検出されませんでした。「🎤 やり直す」を押してください。';
        $('rp-result').classList.add('visible');
      } else if (err === 'not-allowed') {
        showMicBlockedModal();
      }
    }
  });
  rp.recognizer.start();
}

function rpReplayPartner() {
  // 直近の相手セリフを再生（現在が相手の番ならそれを、自分の番なら一つ前の相手セリフ）
  rpStopAll();
  for (let i = rp.idx; i >= 0; i--) {
    const t = App.scene.turns[i];
    if (t.speaker !== rp.role) {
      Speech.speak(t.text, App.scene.lang, 1.0);
      return;
    }
  }
}

function rpRetry() {
  rpStopAll();
  $('rp-result').classList.remove('visible');
  rpStartRecording();
}

function rpNext() {
  rpStopAll();
  rp.idx++;
  rpStep();
}

function rpShowHint() {
  const turn = rpCurrentTurn();
  $('rp-line').textContent = turn.text;
  $('rp-line').className = 'rp-line';
  $('rp-translation').textContent = turn.translation;
  $('rp-hint-btn').style.display = 'none';
}

function rpSwapRole() {
  setRpRole(rp.role === 'A' ? 'B' : 'A');
  startRoleplay();
}

function rpShowSummary() {
  rpStopAll();
  $('rp-stage-wrap').style.display = 'none';
  $('rp-summary').style.display = 'block';

  const myTurns = App.scene.turns
    .map((t, i) => ({ t, i }))
    .filter(x => x.t.speaker === rp.role);
  const scored = myTurns.filter(x => rp.scores[x.i] !== undefined);
  const avg = scored.length
    ? Math.round(scored.reduce((a, x) => a + rp.scores[x.i], 0) / scored.length)
    : 0;
  $('rp-summary-avg').textContent =
    `あなた（${rp.role}役）の平均スコア: ${avg}%（${scored.length}/${myTurns.length}セリフ）`;

  const list = $('rp-summary-list');
  list.innerHTML = '';
  myTurns.forEach(x => {
    const score = rp.scores[x.i];
    let badge = '<span class="chunk-score-badge badge-low">未録音</span>';
    if (score !== undefined) {
      const cls = score >= 80 ? 'badge-great' : score >= 50 ? 'badge-ok' : 'badge-low';
      badge = `<span class="chunk-score-badge ${cls}">${score}%</span>`;
    }
    const item = document.createElement('div');
    item.className = 'rp-summary-item';
    item.innerHTML = `<span class="rp-sum-text">${escHtml(x.t.text.slice(0, 50))}${x.t.text.length > 50 ? '…' : ''}</span>${badge}`;
    list.appendChild(item);
  });
}

// ===== 学習履歴 =====
function _maybeSaveHistory() {
  const done = App.flow.filter(s => App.scores[stepKey(s)] !== undefined).length;
  if (!done) return;
  const scoreVals = Object.values(App.scores).filter(n => typeof n === 'number');
  const avgScore = scoreVals.length ? Math.round(scoreVals.reduce((a, b) => a + b, 0) / scoreVals.length) : 0;
  Store.saveHistory({
    ts: Date.now(),
    lang: App.lang,
    tag: App.tag || '',
    totalSteps: App.flow.length,
    doneSteps: done,
    avgScore,
    source: App.source
  });
}

function showHistory() {
  const hist = Store.loadHistory();
  if (!hist.length) {
    $('history-empty').style.display = 'block';
    $('history-chart-wrap').style.display = 'none';
  } else {
    $('history-empty').style.display = 'none';
    $('history-chart-wrap').style.display = 'block';
    _renderHistoryStats(hist);
    _renderHistoryStorageInfo(hist);
    _renderHistoryChart(hist);
    _renderHistoryLog(hist);
  }
  showScreen('history');
}

function _renderHistoryStorageInfo(hist) {
  const used = hist.length;
  const max = 365;
  const pct = Math.round((used / max) * 100);
  const el = $('history-storage-info');
  if (!el) return;
  el.innerHTML = `
    <div class="storage-info-row">
      <span class="storage-info-label">📦 履歴: <strong>${used} / ${max}件</strong>（残り${max - used}件）</span>
      <span class="storage-info-note">このブラウザのみに保存されます。ブラウザデータを削除すると履歴も消えます。</span>
    </div>
    <div class="storage-bar-wrap"><div class="storage-bar-fill" style="width:${pct}%"></div></div>
  `;
}

function _calcStreak(hist) {
  if (!hist.length) return 0;
  const toKey = ts => { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
  const days = new Set(hist.map(e => toKey(e.ts)));
  let streak = 0;
  const d = new Date();
  while (days.has(toKey(d.getTime()))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

function _renderHistoryStats(hist) {
  const chunks = hist.reduce((a, e) => a + (e.doneSteps || 0), 0);
  const scored = hist.filter(e => e.avgScore > 0);
  const avgScore = scored.length ? Math.round(scored.reduce((a, e) => a + e.avgScore, 0) / scored.length) : 0;
  $('history-stats').innerHTML = `
    <div class="stat-item"><div class="stat-num">${hist.length}</div><div class="stat-lbl">セッション数</div></div>
    <div class="stat-item"><div class="stat-num">${chunks}</div><div class="stat-lbl">総チャンク</div></div>
    <div class="stat-item"><div class="stat-num">${avgScore}%</div><div class="stat-lbl">平均スコア</div></div>
    <div class="stat-item"><div class="stat-num">${_calcStreak(hist)}日</div><div class="stat-lbl">連続日数</div></div>
  `;
}

function _renderHistoryChart(hist) {
  const toKey = ts => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  };
  const DAYS = 30;
  const days = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    days.push({ key: toKey(d.getTime()), label: `${d.getMonth()+1}/${d.getDate()}`, entries: [] });
  }
  hist.forEach(e => {
    const day = days.find(x => x.key === toKey(e.ts));
    if (day) day.entries.push(e);
  });

  const maxChunks = Math.max(1, ...days.map(d => d.entries.reduce((a, e) => a + e.doneSteps, 0)));
  const barW = 16, gap = 2, padL = 4, H = 120;
  const svgW = padL * 2 + DAYS * (barW + gap) - gap;

  let svgBars = '';
  days.forEach((day, i) => {
    const chunks = day.entries.reduce((a, e) => a + e.doneSteps, 0);
    const scored = day.entries.filter(e => e.avgScore > 0);
    const avg = scored.length ? Math.round(scored.reduce((a,e) => a + e.avgScore, 0) / scored.length) : 0;
    const bh = chunks ? Math.max(6, Math.round((chunks / maxChunks) * (H - 20))) : 0;
    const x = padL + i * (barW + gap);
    const color = chunks === 0 ? '#E2E8F0' : avg >= 70 ? '#10B981' : avg >= 50 ? '#F59E0B' : '#EF4444';
    svgBars += `<rect x="${x}" y="${H - bh}" width="${barW}" height="${bh}" rx="3" fill="${color}"/>`;
    if (chunks > 0) svgBars += `<text x="${x + barW/2}" y="${H - bh - 4}" text-anchor="middle" font-size="8" fill="#64748B">${chunks}</text>`;
  });
  const svgEl = $('history-chart');
  svgEl.setAttribute('viewBox', `0 0 ${svgW} 120`);
  svgEl.innerHTML = svgBars;
  // 日付ラベルは5日おきに表示（30日分は全表示すると詰まる）
  $('history-chart-dates').innerHTML = days.map((d, i) =>
    `<span class="date-cell${i === DAYS - 1 ? ' today' : ''}" style="width:${(100/DAYS).toFixed(2)}%">${(i % 5 === 0 || i === DAYS - 1) ? d.label : ''}</span>`
  ).join('');
}

function _renderHistoryLog(hist) {
  const recent = [...hist].reverse().slice(0, 20);
  $('history-log').innerHTML = recent.map(e => {
    const d = new Date(e.ts);
    const date = `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    const tag = e.tag ? `<span class="log-tag">${escHtml(e.tag)}</span>` : '';
    const pct = e.totalSteps ? Math.round((e.doneSteps / e.totalSteps) * 100) : 0;
    const sc = e.avgScore >= 70 ? '#10B981' : e.avgScore >= 50 ? '#F59E0B' : '#EF4444';
    return `<div class="log-item">
      <div class="log-meta"><span class="log-date">${escHtml(date)}</span>${tag}<span class="log-lang">${e.lang === 'en' ? '🇺🇸' : '🇯🇵'}</span></div>
      <div class="log-detail">${e.doneSteps}/${e.totalSteps}チャンク（${pct}%完了）${e.avgScore ? `<span style="color:${sc};font-weight:700;"> 平均${e.avgScore}%</span>` : ''}</div>
    </div>`;
  }).join('');
}


// ===== テキスト練習カード展開 =====
function expandTextPractice() {
  $('text-practice-expanded').style.display = 'block';
  $('text-expand-btn').style.display = 'none';
}

// ===== ブラウザバック検知 =====
function setupBrowserBackGuard() {
  history.pushState({ xeno: true }, '');
  window.addEventListener('popstate', () => {
    if (confirm('アプリから別のページに移動しますか？\n（OKで移動、キャンセルでアプリに留まります）')) {
      history.back();
    } else {
      history.pushState({ xeno: true }, '');
    }
  });
}

// ===== Init =====
function init() {
  Speech.init();
  setupDropzone();
  setupTopicGrid();
  updateResumeBanner();
  updateAiHint();

  // モーダル外クリックで閉じる
  $('settings-modal').addEventListener('click', (e) => {
    if (e.target === $('settings-modal')) closeSettings();
  });

  _maybeShowWelcome();
  setupBrowserBackGuard();
}

init();

// デバッグ・テスト用にグローバル公開（constはwindowに自動で付かないため）
window.App = App;
window.Store = Store;
window.AI = AI;
window.FreeTranslate = FreeTranslate;
window.Phonics = Phonics;
