# Xenoglossia.ai — 開発者仕様書

最終更新: 2026-06-16

---

## 1. アーキテクチャ概要

### ファイル構成

```
xenoglossia.ai/
├── index.html          # 全画面のHTML。1ファイルにすべての画面を収録
├── js/
│   ├── app.js          # メインロジック（状態管理・画面遷移・練習フロー）
│   ├── speech.js       # TTS/STT ラッパー（Web Speech API）
│   ├── score.js        # スコア計算・ハイライト・フィードバック
│   ├── chunker.js      # テキスト→チャンク分割
│   ├── parser.js       # テキスト抽出・言語判定・ファイル読み込み
│   ├── storage.js      # localStorage ラッパー
│   ├── ai.js           # Claude API 呼び出し（翻訳・シーン生成）
│   ├── translate.js    # 無料翻訳 API（MyMemory）
│   ├── phonics.js      # 英語発音ガイド（リンキング・フラップT等）
│   ├── japanese-phonics.js  # 日本語発音ヒント
│   ├── romaji.js       # 日本語→ローマ字変換
│   └── voice-recorder.js   # マイク録音（再生用）
├── css/
│   └── style.css       # 全スタイル
└── docs/
    ├── feature-backlog.md  # 機能バックログ（MVP・Phase2・Phase3）
    └── spec.md             # 本ファイル
```

### 画面（screen）一覧

| screen ID | 説明 |
|-----------|------|
| `screen-home` | ホーム（テキスト入力・AI会話設定へのナビ） |
| `screen-list` | チャンク一覧（パラグラフ折りたたみ・進捗バー） |
| `screen-practice` | チャンク個別練習（TTS・バックチェイニング・シャドーイング） |
| `screen-run` | 通し練習（パラグラフ or 全文） |
| `screen-scene` | AI会話シーン生成 |
| `screen-roleplay` | ロールプレイ（AIシーンの台本で会話練習） |
| `screen-history` | 学習履歴・統計グラフ |

画面切替は `showScreen(name)` が担う。切替時に必ず `stopAllAudio()` が呼ばれる。

---

## 2. 状態管理（App オブジェクト）

```javascript
const App = {
  lang: 'en',           // 練習言語 'en' | 'ja'
  langChoice: 'auto',   // ホームのセレクタ値 'auto' | 'en' | 'ja'
  source: 'text',       // 'text' | 'scene'
  paragraphs: [],       // [{chunks:string[], translation:string|null, chunkTranslations:string[]}]
  flow: [],             // [{type:'chunk',p,c} | {type:'para',p} | {type:'full'}]
  flowIndex: 0,
  scores: {},           // stepKey → score(0〜100の整数)
  reviewMode: false,
  review: { steps:[], idx:0 },
  fileText: null,
  fileName: null,
  scene: null,          // AIシーンオブジェクト
  sceneOpts: { lang:'en', level:'intermediate', topic:'' },
  tag: ''               // 現在選択中のジャンルタグ
};
```

### stepKey 形式

| タイプ | キー |
|--------|------|
| チャンク(p=0,c=2) | `c:0:2` |
| パラグラフ通し(p=1) | `p:1` |
| 全文通し | `full` |

---

## 3. localStorage 仕様

| キー | 用途 | 形式 | 上限 |
|------|------|------|------|
| `sc_apikey` | Claude APIキー | 文字列 | — |
| `sc_session` | 練習セッション復元用 | JSONオブジェクト | 1件（上書き） |
| `sc_guide` | 発音ガイドON/OFF | `'on'` \| `'off'` | — |
| `sc_history` | 学習履歴 | JSON配列 | 最大90件（超えたら古いものから削除） |

### sc_session 構造

```json
{
  "v": 1,
  "lang": "en",
  "source": "text",
  "paragraphs": [...],
  "scores": { "c:0:0": 85, "p:0": 72 },
  "scene": null,
  "tag": "ビジネス",
  "ts": 1718500000000
}
```

### sc_history エントリ構造

```json
{
  "ts": 1718500000000,
  "lang": "en",
  "tag": "ビジネス",
  "totalSteps": 12,
  "doneSteps": 8,
  "avgScore": 74,
  "source": "text"
}
```

### 重要: 履歴の保存タイミング

**`_maybeSaveHistory()` は `goHome()` の中でのみ呼ばれる。**

- チャンクを1つ以上採点してからホームに戻ると保存される
- 練習中に📊ボタンを押しても履歴は保存されない（`showHistory()` は `showScreen('history')` を呼ぶだけ）
- ホームに戻る前に履歴を見ても「今のセッション」は反映されない
- `doneSteps === 0` のセッションは保存スキップ

---

## 4. 音声システム

### TTS（テキスト読み上げ）

- `Speech.speak(text, lang, rate, onEnd)` — 読み上げ開始
- `Speech.stop()` — 停止
- 速度: 通常 `1.0`、ゆっくり `0.65`
- ブラウザの `SpeechSynthesis` を使用。音声選択はブラウザ依存

### STT（音声認識）

- `Speech.createRecognizer({lang, continuous, onInterim, onFinal, onError, onEnd})` で生成
- **`continuous: false`**: 無音を検知すると自動停止 → `onFinal(transcript)` で結果取得
- **`continuous: true`**: 手動で `.stop()` or `.abort()` するまで継続 → `onEnd(transcript)` で累積結果取得
- Chrome / Edge のみ対応（Firefox・Safari非対応）
- 認識言語: `'en-US'`（英語）/ `'ja-JP'`（日本語）

### シャドーイングモードのフロー（重要）

TTS音声がマイクに拾われて100%になる問題を避けるため、**TTS終了後**にSTTを開始する設計:

```
ボタンクリック
  → TTS再生（聞くフェーズ、青い表示）
  → TTS終了
  → カウントダウン 3→2→1（橙色の大きな数字）
  → STT録音開始（紫色・「話してください」）
  → 無音検知でSTT自動停止
  → 採点・スコア表示
```

`_shadowDoCountdown()` が 800ms間隔でカウントダウンし、0になったら `_startShadowRecording()` を呼ぶ。

### VoiceRecorder

- 採点とは別に「自分の声」を録音・再生するためのモジュール
- `VoiceRecorder.start()` / `.stop()` / `.play()`
- `voicerecorded` カスタムイベントで「マイ声」ボタンを有効化

---

## 5. スコアリングシステム（score.js）

- `Score.calc(target, transcript, lang)` → 0〜100 の整数
- 単語レベルのマッチング（大文字小文字・句読点を正規化してから比較）
- `Score.highlight(target, transcript, lang)` → 単語ごとに正解/不正解をHTMLで色分け
- `Score.feedback(score, lang)` → `{ comment, color }` を返す

| スコア帯 | コメント | 色 |
|---------|---------|-----|
| 85〜100% | 完璧 | 緑 `#10B981` |
| 70〜84% | 良い | 緑系 |
| 50〜69% | まあまあ | 黄 `#F59E0B` |
| 0〜49% | 要練習 | 赤 `#EF4444` |

スコアは「チャンクの自己ベスト」を保存（より高いスコアで上書き）。

---

## 6. チャンク分割（chunker.js）

- 英語: `. ! ?` → 必ず分割。`, ; :` → 前後が7語以上なら分割
- 日本語: `。！？` → 分割
- 目標: 1チャンク = 5〜15語（英語）

---

## 7. バックチェイニング

- チャンク単語を末尾から1語ずつ積み上げるステップを生成
- 例: "I came to Japan" → ["Japan", "to Japan", "came to Japan", "I came to Japan"]
- 日本語: 文字数が多い場合は前半/後半の2分割のみ
- BCフォーカスモード（`.bc-focus` クラス）: TTS再生ボタン・録音ボタン・シャドーイングボタン等を非表示にして集中させる

---

## 8. AI機能（ai.js）

- Claude APIキーが必要（設定モーダルで入力 → `sc_apikey` に保存）
- **翻訳**: `AI.translateBatch(chunks, lang)` → パラグラフ単位で一括翻訳してキャッシュ（`para.chunkTranslations`）
- **シーン生成**: `AI.generateScene({topic, level, lang, prevTurns?})` → 会話台本JSON
- APIキーなし: `FreeTranslate.translate()` (MyMemory API) にフォールバック

---

## 9. 学習履歴グラフ（P2-3）

- 📊ヘッダーボタン → `showHistory()` → `screen-history` 画面へ
- 統計カード: セッション数 / 総チャンク数 / 平均スコア / 連続日数
- バーチャート: SVGで実装（CDN不使用）。直近14日間、1日=1バー
  - バーの高さ: その日のdoneSteps合計（最大値を基準に正規化）
  - バーの色: 緑=平均70%以上、黄=50%以上、赤=50%未満、グレー=未学習
- ログ一覧: 最新20件、新しい順

---

## 10. タグシステム（P2-4）

- ホーム画面にタグチップ（なし / ビジネス / 日常会話 / 旅行 / 学習教材 / ニュース）
- `App.tag` に保存 → セッション・履歴エントリの両方に含まれる
- セッション復元時にタグも復元される

---

## 11. ブラウザ互換性

| 機能 | Chrome | Edge | Firefox | Safari |
|------|--------|------|---------|--------|
| TTS | ✓ | ✓ | ✓ | ✓ |
| STT（録音・採点） | ✓ | ✓ | ✗ | ✗ |
| バックチェイニング | ✓ | ✓ | ✗ | ✗ |
| シャドーイング | ✓ | ✓ | ✗ | ✗ |

STT非対応ブラウザでは録音系ボタンを押すとアラートを表示。

---

## 12. 既知の制限・設計上の注意点

- **シャドーイングのエコー問題**: スピーカーで再生したTTS音声をマイクが拾う。対策としてTTS後にSTT開始（listen→speak フロー）。ヘッドフォン使用でも回避可能。
- **履歴の保存はホーム遷移時のみ**: `goHome()` が唯一のトリガー。ブラウザを閉じても保存済みの過去分は消えない（localStorageは永続）。
- **sessionの上書き**: `saveSession()` は常に1件を上書き。前のセッションのデータは消える（履歴は別キーで保存済み）。
- **翻訳APIの制限**: MyMemory APIは1日5000文字まで無料。超過すると翻訳失敗（エラーはサイレント）。
- **STT言語**: `en-US` のみ対応（英語多言語・方言は非対応）。日本語は `ja-JP`。
- **履歴の90件制限**: 90件を超えると古いエントリから削除。約3ヶ月分（1日1回利用の場合）。
- **localStorageの容量**: ブラウザ全体で5MB程度。翻訳キャッシュが大きくなると `saveSession()` がサイレントに失敗する可能性あり（try-catchで握りつぶし）。
