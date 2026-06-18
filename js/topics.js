// 30コアトピック: 自己紹介練習モジュール

const TOPICS = [
  { id:  1, title: '名前・出身地',         desc: '自分の名前と出身地を紹介する',
    preset: "Hi, my name is [Your Name]. I'm from [Your City], Japan. Nice to meet you." },
  { id:  2, title: '現在住んでいる場所',   desc: '今どこに住んでいるかを伝える',
    preset: "I currently live in [City]. I've been here for about [X] years. I really enjoy living here." },
  { id:  3, title: '職業・仕事',           desc: '何の仕事をしているかを紹介する',
    preset: "I work as a [Job Title]. I've been in this field for about [X] years. My company is based in [City]." },
  { id:  4, title: '仕事のやりがい',       desc: '仕事で好きな部分ややりがいを伝える',
    preset: "At work, I mainly [describe main duties]. What I enjoy most is [reason]. It's a very rewarding job." },
  { id:  5, title: '家族構成',             desc: '家族について紹介する',
    preset: "I'm [married/single]. I have [X] children. I live with my family in [City]. Family is very important to me." },
  { id:  6, title: '趣味・好きなこと',     desc: '趣味や好きなことを伝える',
    preset: "In my free time, I enjoy [hobby]. I've been doing it for about [X] years. It helps me relax and recharge." },
  { id:  7, title: 'スポーツ・運動',       desc: '運動習慣やスポーツについて話す',
    preset: "I try to stay active by [sport/activity]. I do it about [X] times a week. It's great for both body and mind." },
  { id:  8, title: '音楽の好み',           desc: '好きな音楽ジャンルやアーティストを話す',
    preset: "I love listening to [genre] music. Some of my favorite artists are [name]. Music always helps me get through the day." },
  { id:  9, title: '映画・ドラマ',         desc: '好きな映画やドラマについて話す',
    preset: "I'm a big fan of [genre] films and series. I recently watched [title] and loved it. I like stories that [reason]." },
  { id: 10, title: '読書',                 desc: '読書習慣や好きな本を紹介する',
    preset: "I enjoy reading in my spare time. I mostly read [genre] books. Right now I'm reading [title]." },
  { id: 11, title: '好きな食べ物',         desc: '好きな料理や食べ物を伝える',
    preset: "My favorite food is [food]. I also love [cuisine type] cuisine. I enjoy trying new restaurants whenever I can." },
  { id: 12, title: '料理',                 desc: '料理の腕前や得意料理について話す',
    preset: "I enjoy cooking at home. My favorite dish to make is [dish]. I learned how to make it from [my mother/online/a class]." },
  { id: 13, title: '旅行の経験',           desc: 'これまでに行った場所を紹介する',
    preset: "I love traveling whenever I can. I've visited [places]. My most memorable trip was to [place] — it was amazing." },
  { id: 14, title: '行きたい場所',         desc: '将来行ってみたい場所を話す',
    preset: "One place I've always wanted to visit is [place]. I've heard so much about [reason]. I'm saving up to go someday." },
  { id: 15, title: '週末の過ごし方',       desc: '週末に何をするかを伝える',
    preset: "On weekends, I usually [activity]. I also enjoy [activity] with my [family/friends]. Weekends are my time to recharge." },
  { id: 16, title: '日常のルーティン',     desc: '毎日のルーティンを紹介する',
    preset: "I usually wake up at [time] and start my day with [morning habit]. I commute by [transport]. I'm a [morning/night] person." },
  { id: 17, title: '健康・ウェルネス',     desc: '健康への意識や運動について話す',
    preset: "Staying healthy is important to me. I try to [activity] regularly and watch what I eat. It makes a big difference in how I feel." },
  { id: 18, title: 'ペット',               desc: 'ペットについて話す（いない場合は欲しいペット）',
    preset: "I have a [pet type] named [name]. I've had [him/her] for [X] years. [He/She] is a big part of my daily life." },
  { id: 19, title: '友人・人間関係',       desc: '友達や人間関係について話す',
    preset: "I have a small but close group of friends. We met through [school/work/hobby]. We love [activity] together." },
  { id: 20, title: '英語を学んでいる理由', desc: 'なぜ英語を学んでいるかを話す',
    preset: "I'm studying English because [reason]. My goal is to [goal]. Right now I practice by [method] every day." },
  { id: 21, title: '日本・日本文化',       desc: '外国人に日本のことを紹介する',
    preset: "Japan is a really unique country. I love that we have [aspect of Japanese culture]. If you ever visit, I'd recommend [recommendation]." },
  { id: 22, title: '最近ハマっていること', desc: '最近夢中になっていることを話す',
    preset: "Lately I've been really into [activity]. I got into it about [X] months ago. I spend quite a bit of time on it now." },
  { id: 23, title: '得意なこと・特技',     desc: '自分の強みや得意なことを伝える',
    preset: "One thing I'm pretty good at is [skill]. People often ask me for help with [related thing]. I enjoy being able to help." },
  { id: 24, title: '苦手なこと',           desc: '苦手なことを正直に話す',
    preset: "I have to admit I'm not great at [thing]. I'm working on improving it, though. I think it's important to know your weaknesses." },
  { id: 25, title: '子供の頃',             desc: '昔の自分や子供の頃を話す',
    preset: "When I was a kid, I loved [activity/interest]. I grew up in [place]. Looking back, those were really happy days." },
  { id: 26, title: '将来の目標',           desc: '将来やりたいことや夢を伝える',
    preset: "One of my goals is to [goal]. I'm working toward it step by step. I believe consistent effort makes it possible." },
  { id: 27, title: '大切にしている価値観', desc: '人生で大切にしていることを話す',
    preset: "Something I really value in life is [value]. I try to [how you apply it] every day. It guides a lot of my decisions." },
  { id: 28, title: '思い出の場所',         desc: '好きな場所や思い出の場所を紹介する',
    preset: "One of my favorite places is [place]. It holds a lot of special memories for me. I try to go back whenever I can." },
  { id: 29, title: '感謝していること',     desc: '人生で感謝していることを話す',
    preset: "I'm really grateful for [thing/person]. [He/She/It] has made a big difference in my life. I try not to take it for granted." },
  { id: 30, title: '自分を一言で表すと',   desc: '自分の性格やキャラクターを締めくくる',
    preset: "If I had to describe myself in one word, it would be [word]. I think that really says a lot about who I am as a person." }
];

// ===== Storage =====
const TopicStore = {
  KEY_CUSTOM:   'sc_topic_custom',
  KEY_PROGRESS: 'sc_topic_progress',

  getCustom(id) {
    try { return (JSON.parse(localStorage.getItem(this.KEY_CUSTOM) || '{}'))[id] || null; }
    catch { return null; }
  },
  setCustom(id, text) {
    try {
      const d = JSON.parse(localStorage.getItem(this.KEY_CUSTOM) || '{}');
      d[id] = text;
      localStorage.setItem(this.KEY_CUSTOM, JSON.stringify(d));
    } catch(e) {}
  },
  getAllCustom() {
    try { return JSON.parse(localStorage.getItem(this.KEY_CUSTOM) || '{}'); } catch { return {}; }
  },
  getProgress(id) {
    try { return (JSON.parse(localStorage.getItem(this.KEY_PROGRESS) || '{}'))[id] || null; }
    catch { return null; }
  },
  setProgress(id, score) {
    try {
      const d = JSON.parse(localStorage.getItem(this.KEY_PROGRESS) || '{}');
      const prev = d[id];
      const best = prev ? Math.max(prev.score || 0, score) : score;
      const days = score >= 80 ? 3 : score >= 60 ? 1 : 0;
      d[id] = { done: true, score: best, ts: Date.now(), nextReview: Date.now() + days * 86400000 };
      localStorage.setItem(this.KEY_PROGRESS, JSON.stringify(d));
    } catch(e) {}
  },
  getAllProgress() {
    try { return JSON.parse(localStorage.getItem(this.KEY_PROGRESS) || '{}'); } catch { return {}; }
  }
};

// ===== UI State =====
let _topicDetailId = null;

// ===== Screen: Topics List =====
function showTopics() {
  renderTopicList();
  showScreen('topics');
}

function renderTopicList() {
  const progress = TopicStore.getAllProgress();
  const custom = TopicStore.getAllCustom();
  const now = Date.now();
  let doneCount = 0;
  let dueCount = 0;

  const itemsHtml = TOPICS.map(t => {
    const p = progress[t.id];
    const isDue = p && p.nextReview && p.nextReview <= now;
    const hasCustom = !!custom[t.id];
    let badgeHtml, cls = '';
    if (isDue) {
      badgeHtml = '<span class="tl-badge tl-due">📅 復習</span>';
      cls = p.score >= 70 ? 'done' : 'practicing';
      dueCount++;
      if (p.score >= 70) doneCount++;
    } else if (p && p.score >= 70) {
      badgeHtml = '<span class="tl-badge tl-done">✅ 習得</span>';
      cls = 'done';
      doneCount++;
    } else if (p) {
      badgeHtml = `<span class="tl-badge tl-practicing">${p.score}%</span>`;
      cls = 'practicing';
    } else {
      badgeHtml = '<span class="tl-badge tl-unstarted">未着手</span>';
    }
    const customMark = hasCustom ? ' <span class="ti-custom">✏</span>' : '';
    return `
      <div class="topic-item ${cls}" onclick="showTopicDetail(${t.id})">
        <div class="ti-num">${t.id}</div>
        <div class="ti-body">
          <div class="ti-title">${t.title}${customMark}</div>
          <div class="ti-desc">${t.desc}</div>
        </div>
        <div class="ti-badge">${badgeHtml}</div>
      </div>`;
  }).join('');

  const dueBanner = dueCount > 0
    ? `<div class="srs-due-banner">
        <span class="srs-due-icon">📅</span>
        <div class="srs-due-body">
          <div class="srs-due-title">今日の復習: ${dueCount}トピック</div>
          <div class="srs-due-sub">前回のスコアに基づく復習タイミングです</div>
        </div>
       </div>`
    : '';
  $('topic-list').innerHTML = dueBanner + itemsHtml;

  const pct = Math.round((doneCount / 30) * 100);
  $('topic-progress-text').textContent = `習得済み: ${doneCount} / 30`;
  $('topic-progress-pct').textContent = pct + '%';
  $('topic-progress-fill').style.width = pct + '%';

  $('topic-list-view').style.display = 'block';
  $('topic-detail-view').style.display = 'none';
}

// ===== Screen: Topic Detail =====
function showTopicDetail(id) {
  _topicDetailId = id;
  const t = TOPICS.find(x => x.id === id);
  const custom = TopicStore.getCustom(id);
  const prog   = TopicStore.getProgress(id);
  const text   = custom || t.preset;

  $('td-num').textContent   = `トピック ${id} / 30`;
  $('td-title').textContent = t.title;
  $('td-desc').textContent  = t.desc;
  $('td-text').textContent  = text;

  const savedBadge = $('td-saved-badge');
  savedBadge.style.display = custom ? 'block' : 'none';

  const scoreEl = $('td-score');
  if (prog) {
    scoreEl.textContent = `最高スコア: ${prog.score}%`;
    scoreEl.style.display = 'block';
  } else {
    scoreEl.style.display = 'none';
  }

  $('td-edit-wrap').style.display  = 'none';
  $('td-text-wrap').style.display  = 'block';

  $('topic-list-view').style.display   = 'none';
  $('topic-detail-view').style.display = 'block';
}

function topicBackToList() {
  $('topic-list-view').style.display   = 'block';
  $('topic-detail-view').style.display = 'none';
}

function topicStartEdit() {
  const t = TOPICS.find(x => x.id === _topicDetailId);
  $('td-textarea').value = TopicStore.getCustom(_topicDetailId) || t.preset;
  $('td-text-wrap').style.display = 'none';
  $('td-edit-wrap').style.display = 'block';
}

function topicCancelEdit() {
  $('td-edit-wrap').style.display = 'none';
  $('td-text-wrap').style.display = 'block';
}

function topicSave() {
  const text = $('td-textarea').value.trim();
  if (!text) return;
  TopicStore.setCustom(_topicDetailId, text);
  $('td-text').textContent = text;
  $('td-saved-badge').style.display = 'block';
  topicCancelEdit();
}

function topicResetPreset() {
  const t = TOPICS.find(x => x.id === _topicDetailId);
  $('td-textarea').value = t.preset;
}

// ===== Practice Bridge =====
function startTopicPractice() {
  const t    = TOPICS.find(x => x.id === _topicDetailId);
  const text = TopicStore.getCustom(_topicDetailId) || t.preset;
  startTextPracticeWithText(text, _topicDetailId);
}

// 練習終了時にトピック進捗を保存（app.js の goHome から呼ばれる）
function _maybeUpdateTopicProgress() {
  if (!App.topicId) return;
  const scores = Object.values(App.scores).filter(s => s !== undefined);
  if (!scores.length) { App.topicId = null; return; }
  const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  TopicStore.setProgress(App.topicId, avg);
  App.topicId = null;
}
