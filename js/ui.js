// 画面描画とイベント処理
import {
  PL_FIELDS, BS_FIELDS, CATEGORIES, INDICATORS, MAX_PERIODS, CHART_ROWS,
  calcIndicators, getWarnings, formatValue, buildResultText, parseAmount, isNum,
  buildComparison, formatChangeAmount, formatChangeRate,
} from './calc.js';
import {
  loadData, saveData, createEmptyData, getSampleMultiData,
  addPeriod, removePeriod, movePeriod,
  backupToJson, backupFileName, parseBackup, getLastBackupAt, setLastBackupAt,
  needsBackupReminder, hasAnyData,
} from './store.js';
import { buildLineChartSvg } from './chart.js';
import { registerServiceWorker, requestPersistentStorage } from './pwa.js';

const SAVE_DELAY_MS = 300;

const state = {
  data: createEmptyData(),
  storageError: null,
  selected: 0, // 入力タブで選択中の期
  view: 'input',
  basis: 'end',
  showChange: true,
};

let saveTimer = null;

const $ = (id) => document.getElementById(id);

function currentPeriod() {
  return state.data.periods[state.selected];
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'className') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(c);
  return node;
}

// 入力欄の表示用（内部値は丸めない。表示のみカンマ区切り）
function formatInput(v) {
  if (!isNum(v)) return '';
  return v.toLocaleString('ja-JP', { maximumFractionDigits: 10 });
}

function periodName(p, i) {
  return p.label || `第${i + 1}期`;
}

// ---- 保存 ----

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, SAVE_DELAY_MS);
}

function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const { ok, error } = saveData(state.data);
  const next = ok ? null : error;
  if (state.storageError !== next) {
    state.storageError = next;
    renderGlobalWarnings();
  }
}

// ---- 入力タブ ----

function renderAmountFields(containerId, section, fields) {
  const container = $(containerId);
  container.replaceChildren();
  const values = currentPeriod()[section];
  for (const f of fields) {
    const id = `f-${section}-${f.key}`;
    const input = el('input', {
      id,
      type: 'text',
      inputmode: 'decimal',
      autocomplete: 'off',
      enterkeyhint: 'next',
      'data-section': section,
      'data-key': f.key,
    });
    input.value = formatInput(values[f.key]);
    input.addEventListener('input', onFieldInput);
    input.addEventListener('blur', onFieldBlur);
    const sign = el('button', {
      type: 'button',
      className: 'sign-btn',
      'aria-label': `${f.label}の符号を反転`,
      text: '±',
    });
    sign.addEventListener('click', () => toggleSign(section, f.key, input));
    container.append(el('div', { className: 'amount-row' }, [
      el('label', { for: id, text: f.label }),
      input,
      sign,
    ]));
  }
}

function renderPeriodBar() {
  const box = $('periodChips');
  box.replaceChildren();
  state.data.periods.forEach((p, i) => {
    const chip = el('button', {
      type: 'button',
      className: 'chip',
      role: 'tab',
      'aria-selected': String(i === state.selected),
      text: periodName(p, i),
    });
    chip.addEventListener('click', () => selectPeriod(i));
    box.append(chip);
  });
  const full = state.data.periods.length >= MAX_PERIODS;
  const add = el('button', { type: 'button', className: 'chip chip-add', text: full ? '上限5期' : '＋ 期を追加' });
  if (full) add.disabled = true;
  add.addEventListener('click', onAddPeriod);
  box.append(add);

  $('periodLabel').value = currentPeriod().label;
  $('btnMoveLeft').disabled = state.selected === 0;
  $('btnMoveRight').disabled = state.selected === state.data.periods.length - 1;
}

function renderForm() {
  $('companyName').value = state.data.companyName;
  renderPeriodBar();
  renderAmountFields('plFields', 'pl', PL_FIELDS);
  renderAmountFields('bsFields', 'bs', BS_FIELDS);
}

function onFieldInput(e) {
  const input = e.target;
  const { section, key } = input.dataset;
  const text = input.value.trim();
  const v = parseAmount(text);
  currentPeriod()[section][key] = v;
  input.setAttribute('aria-invalid', text !== '' && v === null ? 'true' : 'false');
  update();
}

function onFieldBlur(e) {
  const input = e.target;
  const v = currentPeriod()[input.dataset.section][input.dataset.key];
  if (isNum(v)) input.value = formatInput(v);
}

function toggleSign(section, key, input) {
  const v = currentPeriod()[section][key];
  if (!isNum(v)) {
    // 未入力時は「-」を入れて入力を促す
    input.value = '-';
    input.focus();
    return;
  }
  currentPeriod()[section][key] = -v;
  input.value = formatInput(-v);
  update();
}

function selectPeriod(i) {
  state.selected = i;
  renderForm();
  renderInputResults();
}

function onAddPeriod() {
  const next = addPeriod(state.data);
  if (next === state.data) return;
  state.data = next;
  state.selected = next.periods.length - 1;
  renderForm();
  update();
}

function onRemovePeriod() {
  const p = currentPeriod();
  if (!window.confirm(`「${periodName(p, state.selected)}」を削除します。よろしいですか？`)) return;
  state.data = removePeriod(state.data, state.selected);
  state.selected = Math.min(state.selected, state.data.periods.length - 1);
  renderForm();
  update();
}

function onMovePeriod(delta) {
  const next = movePeriod(state.data, state.selected, delta);
  if (next === state.data) return;
  state.data = next;
  state.selected += delta;
  renderPeriodBar();
  update();
}

function renderInputWarnings() {
  const box = $('warnings');
  box.replaceChildren();
  for (const w of getWarnings(currentPeriod())) {
    box.append(el('div', { className: 'warning', text: w.message }));
  }
}

function renderGlobalWarnings() {
  const box = $('warnings-global');
  box.replaceChildren();
  if (state.storageError) {
    box.append(el('div', { className: 'warning error', text: state.storageError }));
  }
}

function valueClass(base, r) {
  const c = [base];
  if (!r || r.status !== 'ok') c.push('na');
  else if (r.value < 0) c.push('negative');
  return c.join(' ');
}

function renderInputResults() {
  const results = calcIndicators(currentPeriod());
  const box = $('results');
  box.replaceChildren();
  for (const cat of CATEGORIES) {
    const card = el('section', { className: 'panel category' }, [el('h2', { text: cat.name })]);
    for (const ind of INDICATORS.filter((i) => i.category === cat.id)) {
      const r = results[ind.id];
      const details = el('details', { className: 'indicator' }, [
        el('summary', {}, [
          el('span', { className: 'indicator-name', text: ind.name }),
          el('span', { className: valueClass('indicator-value', r), text: formatValue(r, ind.unit) }),
        ]),
        el('dl', { className: 'indicator-detail' }, [
          el('dt', { text: '計算式' }),
          el('dd', { text: ind.formula }),
          el('dt', { text: '一般的な見方' }),
          el('dd', { text: ind.guide }),
        ]),
      ]);
      card.append(details);
    }
    box.append(card);
  }
}

// ---- 比較タブ ----

const GROUP_NAMES = { amounts: '主要数値（千円）', ...Object.fromEntries(CATEGORIES.map((c) => [c.id, c.name])) };

function renderCompare() {
  document.querySelectorAll('.seg').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.basis === state.basis)));
  $('showChange').checked = state.showChange;
  $('basisNote').textContent = state.basis === 'average'
    ? '平均残高ベース：ROA・ROE・回転日数・CCC の BS 項目を (前期末 + 当期末) ÷ 2 で計算します（★印）。前期がない期は「—」。その他の指標は期末残高です。'
    : '期末残高ベース：BS 項目は各期の期末残高を使います。';

  const cmp = buildComparison(state.data, state.basis);
  const table = $('compareTable');
  table.replaceChildren();

  const headRow = el('tr', {}, [el('th', { className: 'row-head', scope: 'col', text: '指標' })]);
  cmp.labels.forEach((l, i) => headRow.append(el('th', { scope: 'col', text: l || `第${i + 1}期` })));
  table.append(el('thead', {}, [headRow]));

  const tbody = el('tbody');
  let group = null;
  for (const row of cmp.rows) {
    if (row.group !== group) {
      group = row.group;
      tbody.append(el('tr', { className: 'group-row' }, [
        el('th', { colspan: String(cmp.labels.length + 1), scope: 'colgroup' }, [el('span', { text: GROUP_NAMES[group] })]),
      ]));
    }
    const head = el('th', { className: 'row-head', scope: 'row', text: row.name });
    if (state.basis === 'average' && row.averageable) head.append(el('span', { className: 'avg-mark', text: '★' }));
    const tr = el('tr', {}, [head]);
    for (const cell of row.cells) {
      const td = el('td', {}, [
        el('span', {
          className: valueClass('cell-value', cell.result),
          text: row.unit === '千円' && row.group === 'amounts'
            ? (isNum(cell.result.value) ? cell.result.value.toLocaleString('ja-JP', { maximumFractionDigits: 0 }) : '—')
            : formatValue(cell.result, row.unit),
        }),
      ]);
      if (state.showChange && cell.change) {
        td.append(el('span', { className: 'cell-change', text: formatChangeAmount(cell.change, row.unit) }));
        td.append(el('span', { className: 'cell-change', text: formatChangeRate(cell.change) }));
      }
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(tbody);

  renderCharts(cmp);
}

function tickFormatFor(unit) {
  if (unit === '%') return (v) => `${Number((v * 100).toPrecision(6))}%`;
  return (v) => v.toLocaleString('ja-JP', { maximumFractionDigits: 2 });
}

function renderCharts(cmp) {
  const box = $('charts');
  box.replaceChildren();
  const labels = cmp.labels.map((l, i) => l || `第${i + 1}期`);
  for (const id of CHART_ROWS) {
    const row = cmp.rows.find((r) => r.id === id);
    const values = row.cells.map((c) => (c.result.status === 'ok' ? c.result.value : null));
    const svg = buildLineChartSvg({
      labels,
      values,
      title: row.name,
      format: (v) => formatValue({ value: v, status: 'ok' }, row.unit),
      tickFormat: tickFormatFor(row.unit),
    });
    const card = el('div', { className: 'panel chart-card' }, [el('h3', { text: row.unit === '千円' ? `${row.name}（千円）` : row.name })]);
    // svg は chart.js で全テキストをエスケープ済み
    const holder = el('div');
    holder.innerHTML = svg;
    card.append(holder);
    box.append(card);
  }
}

// ---- 共通 ----

function setView(view) {
  state.view = view;
  document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.view === view)));
  $('view-input').hidden = view !== 'input';
  $('view-compare').hidden = view !== 'compare';
  if (view === 'compare') renderCompare();
  window.scrollTo(0, 0);
}

function update() {
  renderInputWarnings();
  renderInputResults();
  renderBackupStatus();
  if (state.view === 'compare') renderCompare();
  scheduleSave();
}

function hasAnyInput() {
  return hasAnyData(state.data);
}

// ---- バックアップ・復元 ----

function formatDateTime(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderBackupStatus() {
  const last = getLastBackupAt();
  $('lastBackup').textContent = last ? `最終バックアップ：${formatDateTime(last)}` : '最終バックアップ：未実施';
  $('backupReminder').hidden = !needsBackupReminder(last, hasAnyInput());
}

function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const a = el('a', { href: url, download: file.name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function onExport() {
  saveNow();
  const now = new Date();
  const file = new File([backupToJson(state.data, now)], backupFileName(now), { type: 'application/json' });
  try {
    // iPhone では共有シートから「"ファイル"に保存」できる
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: file.name });
    } else {
      downloadFile(file);
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return; // 共有をキャンセルした
    try {
      downloadFile(file);
    } catch {
      showToast('バックアップを保存できませんでした');
      return;
    }
  }
  setLastBackupAt(now);
  renderBackupStatus();
  showToast('バックアップを作成しました');
}

function onImportClick() {
  $('importFile').value = '';
  $('importFile').click();
}

async function onImportFile(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  let text;
  try {
    text = await file.text();
  } catch {
    showToast('ファイルを読み込めませんでした');
    return;
  }
  const result = parseBackup(text);
  if (!result.ok) {
    window.alert(`復元できませんでした。\n${result.error}`);
    return;
  }
  const when = result.exportedAt ? `（${formatDateTime(new Date(result.exportedAt))} 作成）` : '';
  if (!window.confirm(`バックアップ${when}で現在のデータを上書きします。よろしいですか？`)) return;
  state.data = result.data;
  state.selected = state.data.periods.length - 1;
  renderForm();
  update();
  saveNow();
  showToast('バックアップから復元しました');
}

function onLoadSample() {
  if (hasAnyInput() && !window.confirm('入力中のデータをサンプルデータで上書きします。よろしいですか？')) return;
  state.data = getSampleMultiData();
  state.selected = state.data.periods.length - 1;
  renderForm();
  update();
  saveNow();
  showToast('サンプルデータを読み込みました');
}

function onClear() {
  if (!window.confirm('すべての期の入力内容をクリアします。よろしいですか？')) return;
  state.data = createEmptyData();
  state.selected = 0;
  renderForm();
  update();
  saveNow();
  showToast('クリアしました');
}

async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 下の方式で再試行する
  }
  try {
    const ta = el('textarea', { readonly: '', style: 'position:fixed;top:0;left:0;opacity:0;' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

async function onCopy() {
  const p = currentPeriod();
  const text = buildResultText(state.data, calcIndicators(p), getWarnings(p), state.selected);
  const ok = await copyText(text);
  showToast(ok ? `${periodName(p, state.selected)}の結果をコピーしました` : 'コピーできませんでした');
}

let toastTimer = null;
function showToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2000);
}

function init() {
  const { data, error } = loadData();
  state.data = data;
  state.storageError = error;
  state.selected = data.periods.length - 1;
  renderForm();
  renderGlobalWarnings();
  renderInputWarnings();
  renderInputResults();
  renderBackupStatus();

  $('companyName').addEventListener('input', (e) => {
    state.data.companyName = e.target.value;
    scheduleSave();
  });
  $('periodLabel').addEventListener('input', (e) => {
    currentPeriod().label = e.target.value;
    // チップの表示だけ更新（入力欄のフォーカスを保つ）
    const chip = $('periodChips').children[state.selected];
    if (chip) chip.textContent = periodName(currentPeriod(), state.selected);
    scheduleSave();
  });
  $('btnMoveLeft').addEventListener('click', () => onMovePeriod(-1));
  $('btnMoveRight').addEventListener('click', () => onMovePeriod(1));
  $('btnRemovePeriod').addEventListener('click', onRemovePeriod);
  $('btnSample').addEventListener('click', onLoadSample);
  $('btnClear').addEventListener('click', onClear);
  $('btnCopy').addEventListener('click', onCopy);
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => setView(t.dataset.view)));
  document.querySelectorAll('.seg').forEach((b) => b.addEventListener('click', () => {
    state.basis = b.dataset.basis;
    renderCompare();
  }));
  $('showChange').addEventListener('change', (e) => {
    state.showChange = e.target.checked;
    renderCompare();
  });
  $('btnExport').addEventListener('click', onExport);
  $('btnImport').addEventListener('click', onImportClick);
  $('importFile').addEventListener('change', onImportFile);

  registerServiceWorker((apply) => {
    $('updateBar').hidden = false;
    $('btnUpdate').onclick = () => {
      $('btnUpdate').disabled = true;
      saveNow();
      apply();
    };
  });
  requestPersistentStorage();

  // 閉じる直前に未保存分を書き込む
  window.addEventListener('pagehide', () => { if (saveTimer) saveNow(); });
}

init();
