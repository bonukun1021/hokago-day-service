firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtDate = (iso) => {
  const d = new Date(iso + 'T00:00:00');
  return `${d.getMonth() + 1}月${d.getDate()}日(${'日月火水木金土'[d.getDay()]})`;
};
const nowHM = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const escapeHtml = (s) => (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const LABELS = {
  toilet: { pee: '🚽 排尿', poop: '💩 排便' },
  condition: { good: '😊 調子：良好', normal: '🙂 調子：普通', bad: '😟 調子：不調' },
  lunch: { full: '🍚 昼食：完食', half: '🍚 昼食：半分', little: '🍚 昼食：少し', none: '🍚 昼食：ほぼ食べず' },
};

let staffName = localStorage.getItem('staffName') || '';
let children = [];
let selectedChildId = localStorage.getItem('selectedChildId') || '';
let selectedDate = todayISO();
let logs = [];
let authReady = false;
let unsubChildren = null;
let unsubLogs = null;

function main() {
  const el = document.getElementById('mainArea');
  if (!authReady) { el.innerHTML = '<div class="status">読み込み中...</div>'; return; }
  if (children.length === 0) {
    el.innerHTML = `
      <div class="card">
        <h2 class="section-title">利用児童の登録</h2>
        <p style="font-size:13.5px;color:var(--ink-soft);margin-top:0;">まだ児童が登録されていません。最初の児童を追加してください。</p>
        <div class="memo-row"><input id="firstChildInput" placeholder="お子さんの名前"><button id="firstChildBtn">追加</button></div>
      </div>`;
    document.getElementById('firstChildBtn').onclick = async () => {
      const v = document.getElementById('firstChildInput').value.trim();
      if (!v) return;
      await addChild(v);
    };
    return;
  }
  if (!selectedChildId || !children.find(c => c.id === selectedChildId)) {
    selectedChildId = children[0].id;
    localStorage.setItem('selectedChildId', selectedChildId);
  }

  el.innerHTML = `
    <div class="child-row" id="childRow"></div>
    <div class="date-nav">
      <button id="prevDay">◀</button>
      <span class="date-label">${fmtDate(selectedDate)}</span>
      ${selectedDate !== todayISO() ? '<span class="today-btn" id="todayBtn">今日へ</span>' : ''}
      <button id="nextDay">▶</button>
    </div>
    <div class="card">
      <h2 class="section-title">きょうのまとめ</h2>
      <div class="summary-row" id="summaryRow"></div>
    </div>
    ${selectedDate === todayISO() ? `
    <div class="card">
      <h2 class="section-title">トイレ</h2>
      <div class="btn-grid">
        <button class="log-btn toilet1" data-type="toilet" data-value="pee">🚽 排尿</button>
        <button class="log-btn toilet2" data-type="toilet" data-value="poop">💩 排便</button>
      </div>
    </div>
    <div class="card">
      <h2 class="section-title">調子（3段階）</h2>
      <div class="btn-grid cols3">
        <button class="log-btn good" data-type="condition" data-value="good">😊<br>良好</button>
        <button class="log-btn normal" data-type="condition" data-value="normal">🙂<br>普通</button>
        <button class="log-btn bad" data-type="condition" data-value="bad">😟<br>不調</button>
      </div>
    </div>
    <div class="card">
      <h2 class="section-title">お昼ごはん</h2>
      <div class="btn-grid">
        <button class="log-btn" data-type="lunch" data-value="full">🍚 完食</button>
        <button class="log-btn" data-type="lunch" data-value="half">🍚 半分</button>
        <button class="log-btn" data-type="lunch" data-value="little">🍚 少し</button>
        <button class="log-btn" data-type="lunch" data-value="none">🍚 ほぼ食べず</button>
      </div>
    </div>
    <div class="card">
      <h2 class="section-title">水分補給</h2>
      <div class="btn-grid">
        <button class="log-btn" data-type="water" data-value="50">💧 +50ml</button>
        <button class="log-btn" data-type="water" data-value="100">💧 +100ml</button>
        <button class="log-btn" data-type="water" data-value="150">💧 +150ml</button>
        <button class="log-btn" data-type="water" data-value="200">💧 +200ml</button>
      </div>
    </div>
    <div class="card">
      <h2 class="section-title">様子・メモ</h2>
      <div class="memo-row"><input id="memoInput" placeholder="今日の様子など自由に"><button id="memoBtn">記録</button></div>
    </div>
    ` : ''}
    <div class="card">
      <h2 class="section-title">きろく一覧</h2>
      <div class="timeline" id="timeline"></div>
    </div>
  `;

  renderChildRow();
  renderSummary();
  renderTimeline();

  document.getElementById('prevDay').onclick = () => { shiftDate(-1); };
  document.getElementById('nextDay').onclick = () => { shiftDate(1); };
  const todayBtn = document.getElementById('todayBtn');
  if (todayBtn) todayBtn.onclick = () => { selectedDate = todayISO(); watchLogs(); main(); };

  document.querySelectorAll('.log-btn[data-type]').forEach(b => {
    b.onclick = () => addLog(b.dataset.type, b.dataset.value);
  });
  const memoBtn = document.getElementById('memoBtn');
  if (memoBtn) {
    memoBtn.onclick = async () => {
      const input = document.getElementById('memoInput');
      const v = input.value.trim();
      if (!v) return;
      await addLog('memo', v);
      input.value = '';
    };
  }
}

function shiftDate(delta) {
  const d = new Date(selectedDate + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  const iso = d.toISOString().slice(0, 10);
  if (iso > todayISO()) return;
  selectedDate = iso;
  watchLogs();
  main();
}

function renderChildRow() {
  const row = document.getElementById('childRow');
  row.innerHTML = children.map(c => `<div class="child-chip ${c.id === selectedChildId ? 'active' : ''}" data-id="${c.id}">${escapeHtml(c.name)}</div>`).join('')
    + `<div class="child-chip add" id="manageChipBtn">＋ 管理</div>`;
  row.querySelectorAll('.child-chip[data-id]').forEach(chip => {
    chip.onclick = () => {
      selectedChildId = chip.dataset.id;
      localStorage.setItem('selectedChildId', selectedChildId);
      watchLogs();
      main();
    };
  });
  document.getElementById('manageChipBtn').onclick = openManageChildren;
}

function renderSummary() {
  const row = document.getElementById('summaryRow');
  const toiletCount = logs.filter(l => l.type === 'toilet').length;
  const waterTotal = logs.filter(l => l.type === 'water').reduce((s, l) => s + Number(l.value), 0);
  const lastCondition = [...logs].reverse().find(l => l.type === 'condition');
  const lastLunch = [...logs].reverse().find(l => l.type === 'lunch');
  const pills = [];
  pills.push(`<span class="summary-pill">🚽 トイレ ${toiletCount}回</span>`);
  pills.push(`<span class="summary-pill">💧 水分 ${waterTotal}ml</span>`);
  pills.push(`<span class="summary-pill">${lastCondition ? LABELS.condition[lastCondition.value] : '調子：未記録'}</span>`);
  pills.push(`<span class="summary-pill">${lastLunch ? LABELS.lunch[lastLunch.value] : '昼食：未記録'}</span>`);
  row.innerHTML = pills.join('');
}

function labelFor(log) {
  if (log.type === 'memo') return `📝 ${escapeHtml(log.value)}`;
  if (log.type === 'water') return `💧 水分 ${log.value}ml`;
  return LABELS[log.type]?.[log.value] || log.type;
}

function renderTimeline() {
  const el = document.getElementById('timeline');
  if (logs.length === 0) { el.innerHTML = '<div class="empty">この日の記録はまだありません</div>'; return; }
  const sorted = [...logs].sort((a, b) => b.time.localeCompare(a.time));
  el.innerHTML = sorted.map(l => `
    <div class="log-item">
      <div class="log-time">${l.time}</div>
      <div class="log-body">
        <div class="log-label">${labelFor(l)}</div>
        <div class="log-staff">${escapeHtml(l.staff || '')}</div>
      </div>
      <button class="log-del" data-id="${l.id}">✕</button>
    </div>
  `).join('');
  el.querySelectorAll('.log-del').forEach(b => {
    b.onclick = () => deleteLog(b.dataset.id);
  });
}

async function addLog(type, value) {
  if (!staffName) { openStaffModal(true, () => addLog(type, value)); return; }
  const child = children.find(c => c.id === selectedChildId);
  await db.collection('logs').add({
    childId: selectedChildId,
    childName: child ? child.name : '',
    date: todayISO(),
    time: nowHM(),
    type, value: String(value),
    staff: staffName,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
}

async function deleteLog(id) {
  if (!confirm('この記録を削除しますか？')) return;
  await db.collection('logs').doc(id).delete();
}

async function addChild(name) {
  await db.collection('children').add({ name, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
}

async function removeChild(id) {
  if (!confirm('この児童を削除しますか？記録は残ります。')) return;
  await db.collection('children').doc(id).delete();
}

function openManageChildren() {
  const root = document.getElementById('modalRoot');
  root.innerHTML = `
    <div class="modal-bg" id="modalBg">
      <div class="modal">
        <h3>児童の管理</h3>
        <div class="child-manage" id="childManageList">
          ${children.map(c => `<div class="child-manage-item"><span>${escapeHtml(c.name)}</span><button data-id="${c.id}">削除</button></div>`).join('')}
        </div>
        <div class="memo-row" style="margin-top:10px;">
          <input id="newChildInput" placeholder="新しい児童の名前">
          <button id="newChildBtn">追加</button>
        </div>
        <div class="row" style="margin-top:14px;"><button class="cancel" id="closeManage">閉じる</button></div>
      </div>
    </div>`;
  document.getElementById('closeManage').onclick = () => { root.innerHTML = ''; };
  document.getElementById('modalBg').onclick = (e) => { if (e.target.id === 'modalBg') root.innerHTML = ''; };
  document.getElementById('newChildBtn').onclick = async () => {
    const v = document.getElementById('newChildInput').value.trim();
    if (!v) return;
    await addChild(v);
    root.innerHTML = '';
  };
  document.querySelectorAll('#childManageList button').forEach(b => {
    b.onclick = async () => { await removeChild(b.dataset.id); root.innerHTML = ''; };
  });
}

function openStaffModal(forceReason, onDone) {
  const root = document.getElementById('modalRoot');
  root.innerHTML = `
    <div class="modal-bg" id="modalBg2">
      <div class="modal">
        <h3>記録者の名前</h3>
        <input id="staffInput" placeholder="例：山田" value="${escapeHtml(staffName)}">
        <div class="row">
          ${forceReason ? '' : '<button class="cancel" id="staffCancel">閉じる</button>'}
          <button class="ok" id="staffOk">保存</button>
        </div>
      </div>
    </div>`;
  const close = () => { root.innerHTML = ''; };
  if (!forceReason) document.getElementById('staffCancel').onclick = close;
  document.getElementById('staffOk').onclick = () => {
    const v = document.getElementById('staffInput').value.trim();
    if (!v) return;
    staffName = v;
    localStorage.setItem('staffName', staffName);
    document.getElementById('staffBadge').textContent = `👤 ${staffName}`;
    close();
    if (onDone) onDone();
  };
}

function watchChildren() {
  if (unsubChildren) unsubChildren();
  unsubChildren = db.collection('children').orderBy('createdAt', 'asc').onSnapshot(snap => {
    children = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    main();
  });
}

function watchLogs() {
  if (unsubLogs) unsubLogs();
  if (!selectedChildId) { logs = []; return; }
  unsubLogs = db.collection('logs')
    .where('childId', '==', selectedChildId)
    .where('date', '==', selectedDate)
    .onSnapshot(snap => {
      logs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderSummary();
      renderTimeline();
    });
}

document.getElementById('staffBadge').textContent = staffName ? `👤 ${staffName}` : '記録者を設定';
document.getElementById('staffBadge').onclick = () => openStaffModal(false);

auth.signInAnonymously().catch(err => {
  document.getElementById('mainArea').innerHTML = `<div class="status">ログインに失敗しました: ${escapeHtml(err.message)}<br>Firebaseの設定(firebase-config.js)とAuthenticationの匿名ログイン設定を確認してください。</div>`;
});
auth.onAuthStateChanged(user => {
  if (user) {
    authReady = true;
    watchChildren();
    watchLogs();
    main();
  }
});
