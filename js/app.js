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
  sceneOpts: { lang: 'en', level: 'intermediate', topic: '' }
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
}

function goHome() {
  stopAllAudio();
  updateResumeBanner();
  updateAiHint();
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
  Store.saveSession({
    v: 1,
    lang: App.lang,
    source: App.source,
    paragraphs: App.paragraphs,
    scores: App.scores,
    scene: App.scene,
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
  if (App.scene && App.scene.lang) App.sceneOpts.lang = App.scene.lang;
  App.reviewMode = false;
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

// ===== List UI =====
function updateListUI() {
  $('list-title').textContent = App.source === 'scene' && App.scene
    ? '🤖 ' + App.scene.title : u('練習メニュー', 'Practice Menu');

  const total = App.flow.length;
  const done = App.flow.filter(s => App.scores[stepKey(s)] !== undefined).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  $('list-progress-text').textContent = u(`練習済み: ${done} / ${total}`, `Completed: ${done} / ${total}`);
  $('list-progress-pct').textContent = pct + '%';
  $('list-progress-fill').style.width = pct + '%';

  $('review-btn').style.display = weakSteps().length ? 'block' : 'none';

  const wrap = $('para-list');
  wrap.innerHTML = '';

  App.paragraphs.forEach((para, p) => {
    const block = document.createElement('div');
    block.className = 'para-block' + (App.paragraphs.length <= 3 ? ' open' : '');

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

    const head = document.createElement('div');
    head.className = 'para-head';
    head.innerHTML = `
      <span class="para-toggle">▶</span>
      <span class="para-title">${label}</span>
      <span class="para-meta">${doneCount}/${para.chunks.length}</span>
      ${badge}`;
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
  $('result-text').textContent = '';
  $('score-bar').style.width = '0%';
  $('score-number').textContent = '—';
  $('score-comment').textContent = '';
  $('myvoice-btn').disabled = !VoiceRecorder.hasRecording();

  const prev = App.scores[stepKey(step)];
  if (prev !== undefined) {
    $('result-text').textContent = u('（前回の結果）', '(Previous best)');
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

function toggleRecord() {
  if (chunkRecognizer && chunkRecognizer.active) {
    chunkRecognizer.stop();
    VoiceRecorder.stop();
    setRecordUI(false);
    return;
  }
  startChunkRecording();
}

function startChunkRecording() {
  if (!Speech.supported()) {
    alert('音声認識はChrome / Edgeでご利用ください。');
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
      $('result-text').textContent = '"' + t + '"';
      $('result-area').classList.add('visible');
    },
    onFinal: (transcript) => {
      VoiceRecorder.stop();
      const score = Score.calc(target, transcript, App.lang);
      $('result-text').textContent = '"' + transcript + '"';
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
      VoiceRecorder.stop();
      setRecordUI(false);
      if (err === 'no-speech') {
        $('result-text').textContent = u('音声が検出されませんでした。もう一度お試しください。', 'No speech detected. Please try again.');
        $('result-area').classList.add('visible');
      } else if (err === 'not-allowed') {
        alert('マイクへのアクセスが拒否されています。ブラウザのマイク許可を確認してください。');
      }
    },
    onEnd: () => { setRecordUI(false); }
  });
  chunkRecognizer.start();
  setRecordUI(true);
}

function setRecordUI(recording) {
  $('record-btn').classList.toggle('recording', recording);
  $('record-label').textContent = recording ? u('停止', 'Stop') : u('録音', 'Record');
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
    runRecognizer.stop();
    return;
  }
  startRunRecording();
}

function startRunRecording() {
  if (!Speech.supported()) {
    alert('音声認識はChrome / Edgeでご利用ください。');
    return;
  }
  Speech.stop();
  $('run-interim').textContent = '';
  $('run-interim-box').classList.add('visible');
  $('run-result-area').classList.remove('visible');

  runRecognizer = Speech.createRecognizer({
    lang: App.lang,
    continuous: true,
    onInterim: (t) => { $('run-interim').textContent = t; },
    onError: (err) => {
      if (err === 'not-allowed') {
        alert('マイクへのアクセスが拒否されています。');
        setRunRecordUI(false);
      }
    },
    onEnd: (transcript) => {
      setRunRecordUI(false);
      $('run-interim-box').classList.remove('visible');
      if (transcript) finalizeRunScore(transcript);
    }
  });
  runRecognizer.start();
  setRunRecordUI(true);
}

function setRunRecordUI(rec) {
  $('run-record-btn').classList.toggle('recording', rec);
  $('run-record-label').textContent = rec ? u('停止する（採点します）', 'Stop (scoring…)') : u('録音する', 'Record');
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
  if (!Speech.supported()) { alert('音声認識はChrome / Edgeでご利用ください。'); return; }
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
        alert('マイクへのアクセスが拒否されています。');
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
}

init();

// デバッグ・テスト用にグローバル公開（constはwindowに自動で付かないため）
window.App = App;
window.Store = Store;
window.AI = AI;
window.FreeTranslate = FreeTranslate;
window.Phonics = Phonics;
