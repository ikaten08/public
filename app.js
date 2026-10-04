/**
 * 音声入力SOAPノート - メインスクリプト
 */

// ==========================================================================
// キーワード定義（要件 + 医療現場で頻出の関連キーワード）
// ==========================================================================
const SOAP_KEYWORDS = {
  S: [
    '痛い', '痛む', '痛み', 'つらい', 'しびれる', '痺れる', 'だるい', '倦怠感',
    '動かしにくい', '不安', '眠れない', '不眠', '訴え', 'おっしゃる', '言っている',
    '違和感', '苦しい', '息苦しい', '気分', 'こわばる', '疲れる', '冷える'
  ],
  O: [
    'ROM', 'MMT', '度', 'cm', 'kg', 'mmHg', '秒', '歩行', '握力', 'バイタル',
    '腫脹', '熱感', '発赤', '血圧', '脈拍', '体温', 'SpO2', '浮腫', '徒手筋力',
    '可動域', '検査', '測定', '所見', '筋緊張', '知覚', '反射', '自立度', 'FIM'
  ],
  A: [
    '考えられる', '原因', '問題', '改善', '低下', '制限', 'リスク', '評価',
    '考察', '推測', '要因', '疑い', '兆候', '悪化', '停滞', '向上', '影響',
    '可能性', '課題', '予後', '不十分'
  ],
  P: [
    'プログラム', '目標', '実施', '継続', '指導', '週', '回', 'セット',
    '退院', '自主トレ', '処方', '介入', '予定', '計画', '次回', '方針',
    '提案', '訓練', 'アプローチ', 'モニタリング', '見守り'
  ]
};

// サンプルデータ
const SAMPLE_TEXT = `右肩を動かすとズキズキ痛いと訴えがある。夜間痛もあり眠れないとのこと。
肩関節外転ROMは80度、屈曲は90度、MMTは3レベル、右手の握力は16kg。
腱板損傷による関節可動域制限と筋力低下が大きな原因と考えられる。
週2回の理学療法プログラムを実施し、自主トレ指導を継続する。`;

// ==========================================================================
// アプリケーション状態
// ==========================================================================
const state = {
  isRecording: false,
  recognition: null,
  finalTranscript: '',
  sentences: [] // { id, text, category: 'S'|'O'|'A'|'P'|'U', matches: { S:[], O:[], A:[], P:[] } }
};

// ==========================================================================
// DOM要素
// ==========================================================================
const elements = {
  btnStartRecord: document.getElementById('btnStartRecord'),
  btnStopRecord: document.getElementById('btnStopRecord'),
  btnConvertSoap: document.getElementById('btnConvertSoap'),
  btnClear: document.getElementById('btnClear'),
  btnSample: document.getElementById('btnSample'),
  btnCopyAll: document.getElementById('btnCopyAll'),
  rawTextarea: document.getElementById('rawTextarea'),
  interimResult: document.getElementById('interimResult'),
  visualizerContainer: document.getElementById('visualizerContainer'),
  recordingStatusBadge: document.getElementById('recordingStatusBadge'),
  charCounter: document.getElementById('charCounter'),
  unsupportedAlert: document.getElementById('unsupportedAlert'),
  toastNotification: document.getElementById('toastNotification'),
  listS: document.getElementById('listS'),
  listO: document.getElementById('listO'),
  listA: document.getElementById('listA'),
  listP: document.getElementById('listP'),
  listU: document.getElementById('listU')
};

// ==========================================================================
// Web Speech API の初期化
// ==========================================================================
function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    console.warn('SpeechRecognition API はこのブラウザでサポートされていません。');
    if (elements.unsupportedAlert) {
      elements.unsupportedAlert.style.display = 'block';
    }
    elements.btnStartRecord.disabled = true;
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = 'ja-JP';
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    state.isRecording = true;
    updateRecordingUI(true);
  };

  recognition.onresult = (event) => {
    let interimTranscript = '';
    let newlyFinalized = '';

    for (let i = event.resultIndex; i < event.results.length; ++i) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        // 句点がない場合は補完
        let cleanText = transcript.trim();
        if (cleanText && !/[。！？!?]$/.test(cleanText)) {
          cleanText += '。';
        }
        newlyFinalized += cleanText;
      } else {
        interimTranscript += transcript;
      }
    }

    if (newlyFinalized) {
      // テキストエリアに確定結果を追記
      const current = elements.rawTextarea.value;
      const separator = current && !current.endsWith('\n') && !current.endsWith('。') ? '。' : '';
      elements.rawTextarea.value = (current + separator + newlyFinalized).trim();
      updateCharCounter();
    }

    // 暫定結果のプレビュー表示
    if (interimTranscript) {
      elements.interimResult.style.display = 'block';
      elements.interimResult.textContent = '認識中: ' + interimTranscript;
    } else {
      elements.interimResult.style.display = 'none';
      elements.interimResult.textContent = '';
    }
  };

  recognition.onerror = (event) => {
    console.error('Speech recognition error:', event.error);
    if (event.error === 'not-allowed') {
      showToast('⚠️ マイクの使用が許可されていません');
      stopRecording();
    } else if (event.error !== 'no-speech') {
      showToast(`音声認識エラー: ${event.error}`);
    }
  };

  recognition.onend = () => {
    // ユーザーが手動停止する前にブラウザ側で切れた場合は自動再開（録音中フラグが立っている場合）
    if (state.isRecording) {
      try {
        recognition.start();
      } catch (err) {
        stopRecording();
      }
    } else {
      updateRecordingUI(false);
    }
  };

  state.recognition = recognition;
}

// ==========================================================================
// 録音コントロール
// ==========================================================================
function startRecording() {
  if (!state.recognition) {
    showToast('音声認識機能が初期化されていません');
    return;
  }

  try {
    state.isRecording = true;
    state.recognition.start();
    showToast('🎙️ 音声入力を開始しました');
  } catch (error) {
    console.error('Start error:', error);
    // すでに開始されている等の場合
    if (error.name !== 'InvalidStateError') {
      showToast('音声認識の開始に失敗しました');
    }
  }
}

function stopRecording() {
  state.isRecording = false;
  if (state.recognition) {
    try {
      state.recognition.stop();
    } catch (e) {
      console.error(e);
    }
  }
  updateRecordingUI(false);
  elements.interimResult.style.display = 'none';
  elements.interimResult.textContent = '';
  showToast('⏹️ 録音を停止しました');
}

function updateRecordingUI(isRecording) {
  if (isRecording) {
    elements.btnStartRecord.disabled = true;
    elements.btnStartRecord.classList.add('recording');
    elements.btnStopRecord.disabled = false;
    elements.visualizerContainer.style.display = 'flex';
    elements.recordingStatusBadge.textContent = '録音中';
    elements.recordingStatusBadge.className = 'status-badge status-recording';
  } else {
    elements.btnStartRecord.disabled = false;
    elements.btnStartRecord.classList.remove('recording');
    elements.btnStopRecord.disabled = true;
    elements.visualizerContainer.style.display = 'none';
    elements.recordingStatusBadge.textContent = '待機中';
    elements.recordingStatusBadge.className = 'status-badge status-idle';
  }
}

// ==========================================================================
// テキスト分割 & キーワード判定ロジック
// ==========================================================================
/**
 * 入力テキストを「文」単位に分割する
 */
function splitIntoSentences(text) {
  if (!text || !text.trim()) return [];

  // 改行または句点、感嘆符、疑問符で分割
  // 改行で段落に分けた後、さらに句点で分割する
  const rawSentences = text
    .split(/\n+/)
    .flatMap(line => line.split(/(?<=[。！？!?])/g))
    .map(s => s.trim())
    .filter(s => s.length > 0);

  return rawSentences;
}

/**
 * 1つの文に対して各SOAPカテゴリのキーワード一致を判定する
 */
function classifySentence(sentenceText) {
  const matches = {
    S: [],
    O: [],
    A: [],
    P: []
  };

  const scores = { S: 0, O: 0, A: 0, P: 0 };

  for (const [cat, keywords] of Object.entries(SOAP_KEYWORDS)) {
    for (const kw of keywords) {
      // 大文字小文字を区別せず判定（ROM, MMT等）
      const regex = new RegExp(escapeRegExp(kw), 'gi');
      const matchResult = sentenceText.match(regex);
      if (matchResult) {
        matches[cat].push(kw);
        scores[cat] += matchResult.length;
      }
    }
  }

  // スコアが最も高いカテゴリを決定
  let assignedCategory = 'U'; // 未分類 (Unclassified)
  let maxScore = 0;

  for (const [cat, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      assignedCategory = cat;
    }
  }

  // もしスコアが同じ場合、最初に出現したキーワードのカテゴリにする等のフォールバック
  if (maxScore > 0 && assignedCategory === 'U') {
    assignedCategory = 'U';
  }

  return {
    category: assignedCategory,
    matches: matches
  };
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ==========================================================================
// SOAP変換 & UI描画
// ==========================================================================
function convertToSoap() {
  const text = elements.rawTextarea.value.trim();
  if (!text) {
    showToast('テキストが入力されていません');
    return;
  }

  const rawSentences = splitIntoSentences(text);
  if (rawSentences.length === 0) {
    showToast('有効な文が見つかりませんでした');
    return;
  }

  state.sentences = rawSentences.map((s, index) => {
    const analysis = classifySentence(s);
    return {
      id: 'sent_' + Date.now() + '_' + index,
      text: s,
      category: analysis.category,
      matches: analysis.matches
    };
  });

  renderSoapCards();
  showToast('⚡ SOAP形式に変換しました');
}

/**
 * 各SOAPカードの内容をDOMにレンダリング
 */
function renderSoapCards() {
  const lists = {
    S: elements.listS,
    O: elements.listO,
    A: elements.listA,
    P: elements.listP,
    U: elements.listU
  };

  // 一旦クリア
  for (const [cat, container] of Object.entries(lists)) {
    container.innerHTML = '';
  }

  const counts = { S: 0, O: 0, A: 0, P: 0, U: 0 };

  state.sentences.forEach((item) => {
    const cat = item.category || 'U';
    const container = lists[cat] || lists.U;
    counts[cat]++;

    const itemEl = document.createElement('div');
    itemEl.className = 'soap-sentence-item';
    itemEl.dataset.id = item.id;

    // マッチしたキーワードタグのHTML生成
    let tagsHtml = '';
    const currentMatches = item.matches[cat] || [];
    if (currentMatches.length > 0) {
      // 重複除去
      const uniqueKws = Array.from(new Set(currentMatches));
      tagsHtml = `
        <div class="matched-keywords">
          ${uniqueKws.map(kw => `<span class="keyword-tag tag-${cat.toLowerCase()}">#${escapeHtml(kw)}</span>`).join('')}
        </div>
      `;
    }

    itemEl.innerHTML = `
      <div class="sentence-content">
        <div class="sentence-text">${escapeHtml(item.text)}</div>
        ${tagsHtml}
      </div>
      <div class="sentence-actions">
        <select class="category-select" title="カテゴリを変更">
          <option value="S" ${cat === 'S' ? 'selected' : ''}>S (主観)</option>
          <option value="O" ${cat === 'O' ? 'selected' : ''}>O (客観)</option>
          <option value="A" ${cat === 'A' ? 'selected' : ''}>A (評価)</option>
          <option value="P" ${cat === 'P' ? 'selected' : ''}>P (計画)</option>
          <option value="U" ${cat === 'U' ? 'selected' : ''}>未分類</option>
        </select>
        <button class="btn-item-delete" title="この文を削除">✕</button>
      </div>
    `;

    // カテゴリ変更イベント
    const selectEl = itemEl.querySelector('.category-select');
    selectEl.addEventListener('change', (e) => {
      item.category = e.target.value;
      renderSoapCards();
    });

    // 削除イベント
    const deleteBtn = itemEl.querySelector('.btn-item-delete');
    deleteBtn.addEventListener('click', () => {
      state.sentences = state.sentences.filter(s => s.id !== item.id);
      renderSoapCards();
    });

    container.appendChild(itemEl);
  });

  // 空状態の表示
  for (const [cat, container] of Object.entries(lists)) {
    if (counts[cat] === 0) {
      const emptyMsg = cat === 'U' ? '未分類の文はありません' : '該当する文はありません';
      container.innerHTML = `<div class="empty-state">${emptyMsg}</div>`;
    }
  }
}

// ==========================================================================
// コピー機能
// ==========================================================================
function copySoapSection(category) {
  const catNames = {
    s: '【S: 主観的情報】',
    o: '【O: 客観的情報】',
    a: '【A: 評価・分析】',
    p: '【P: 計画・方針】',
    u: '【未分類】'
  };

  const targetCategory = category.toUpperCase();
  const matched = state.sentences.filter(s => s.category === targetCategory);

  if (matched.length === 0) {
    showToast(`${targetCategory} の内容はありません`);
    return;
  }

  const content = `${catNames[category.toLowerCase()]}\n` + matched.map(s => `・${s.text}`).join('\n');
  copyToClipboard(content, `${targetCategory} の内容をコピーしました`);
}

function copyAllSoap() {
  if (state.sentences.length === 0) {
    showToast('コピーするSOAPデータがありません。「SOAP変換」を実行してください');
    return;
  }

  const sections = [
    { key: 'S', title: '【S: 主観的情報】' },
    { key: 'O', title: '【O: 客観的情報】' },
    { key: 'A', title: '【A: 評価・分析】' },
    { key: 'P', title: '【P: 計画・方針】' },
    { key: 'U', title: '【未分類】' }
  ];

  let fullOutput = [];
  const now = new Date();
  const dateStr = `${now.getFullYear()}/${(now.getMonth()+1).toString().padStart(2, '0')}/${now.getDate().toString().padStart(2, '0')} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

  fullOutput.push(`■ 音声入力SOAPノート (${dateStr})`);
  fullOutput.push('----------------------------------------');

  sections.forEach(sec => {
    const items = state.sentences.filter(s => s.category === sec.key);
    if (items.length > 0) {
      fullOutput.push(`\n${sec.title}`);
      items.forEach(item => {
        fullOutput.push(`・${item.text}`);
      });
    }
  });

  const fullText = fullOutput.join('\n');
  copyToClipboard(fullText, '📋 SOAPノート全体をコピーしました');
}

function copyToClipboard(text, successMessage) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showToast(successMessage);
    }).catch(err => {
      console.error(err);
      fallbackCopy(text, successMessage);
    });
  } else {
    fallbackCopy(text, successMessage);
  }
}

function fallbackCopy(text, successMessage) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    showToast(successMessage);
  } catch (err) {
    showToast('コピーに失敗しました');
  }
  document.body.removeChild(ta);
}

// ==========================================================================
// ユーティリティ
// ==========================================================================
let toastTimer = null;
function showToast(message) {
  if (toastTimer) clearTimeout(toastTimer);
  elements.toastNotification.textContent = message;
  elements.toastNotification.classList.add('show');
  toastTimer = setTimeout(() => {
    elements.toastNotification.classList.remove('show');
  }, 2500);
}

function updateCharCounter() {
  const length = elements.rawTextarea.value.length;
  elements.charCounter.textContent = `${length} 文字`;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ==========================================================================
// イベントリスナー登録
// ==========================================================================
function setupEventListeners() {
  // 録音開始・停止
  elements.btnStartRecord.addEventListener('click', () => {
    startRecording();
  });

  elements.btnStopRecord.addEventListener('click', () => {
    stopRecording();
  });

  // SOAP変換
  elements.btnConvertSoap.addEventListener('click', () => {
    if (state.isRecording) {
      stopRecording();
    }
    convertToSoap();
  });

  // サンプル読込
  elements.btnSample.addEventListener('click', () => {
    elements.rawTextarea.value = SAMPLE_TEXT;
    updateCharCounter();
    showToast('📝 サンプルテキストを読み込みました');
    convertToSoap();
  });

  // クリア
  elements.btnClear.addEventListener('click', () => {
    if (state.isRecording) {
      stopRecording();
    }
    elements.rawTextarea.value = '';
    state.sentences = [];
    updateCharCounter();
    renderSoapCards();
    showToast('🗑️ テキストをクリアしました');
  });

  // 文字数カウント
  elements.rawTextarea.addEventListener('input', () => {
    updateCharCounter();
  });

  // 全体コピー
  elements.btnCopyAll.addEventListener('click', () => {
    copyAllSoap();
  });

  // 各カードコピー
  document.querySelectorAll('.btn-copy-card').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const target = e.currentTarget.dataset.target;
      copySoapSection(target);
    });
  });
}

// ==========================================================================
// 初期化
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
  initSpeechRecognition();
  setupEventListeners();
  updateCharCounter();
  renderSoapCards();
});
