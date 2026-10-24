// 画面描画とイベント処理
import {
  PL_FIELDS, BS_FIELDS, CATEGORIES, INDICATORS,
  calcIndicators, getWarnings, formatValue, buildResultText, parseAmount, isNum,
} from './calc.js';
import { loadData, saveData, createEmptyData, getSampleData } from './store.js';

const SAVE_DELAY_MS = 300;

const state = {
  data: createEmptyData(),
  storageError: null,
};

let saveTimer = null;

const $ = (id) => document.getElementById(id);

function currentPeriod() {
  return state.data.periods[0];
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

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, SAVE_DELAY_MS);
}

function saveNow() {
  clearTimeout(saveTimer);
  const { ok, error } = saveData(state.data);
  const changed = state.storageError !== (ok ? null : error);
  state.storageError = ok ? null : error;
  if (changed) renderWarnings();
}

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

function renderForm() {
  $('companyName').value = state.data.companyName;
  $('periodLabel').value = currentPeriod().label;
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

function renderWarnings() {
  const box = $('warnings');
  box.replaceChildren();
  if (state.storageError) {
    box.append(el('div', { className: 'warning error', text: state.storageError }));
  }
  for (const w of getWarnings(currentPeriod())) {
    box.append(el('div', { className: 'warning', text: w.message }));
  }
}

function renderResults() {
  const results = calcIndicators(currentPeriod());
  const box = $('results');
  box.replaceChildren();
  for (const cat of CATEGORIES) {
    const card = el('section', { className: 'panel category' }, [el('h2', { text: cat.name })]);
    for (const ind of INDICATORS.filter((i) => i.category === cat.id)) {
      const r = results[ind.id];
      const valueClass = ['indicator-value'];
      if (r.status !== 'ok') valueClass.push('na');
      else if (r.value < 0) valueClass.push('negative');
      const details = el('details', { className: 'indicator' }, [
        el('summary', {}, [
          el('span', { className: 'indicator-name', text: ind.name }),
          el('span', { className: valueClass.join(' '), text: formatValue(r, ind.unit) }),
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

function update() {
  renderWarnings();
  renderResults();
  scheduleSave();
}

function hasAnyInput() {
  const p = currentPeriod();
  return Boolean(state.data.companyName || p.label)
    || Object.values(p.pl).some(isNum)
    || Object.values(p.bs).some(isNum);
}

function onLoadSample() {
  if (hasAnyInput() && !window.confirm('入力中のデータをサンプルデータで上書きします。よろしいですか？')) return;
  state.data = getSampleData();
  renderForm();
  update();
  saveNow();
  showToast('サンプルデータを読み込みました');
}

function onClear() {
  if (!window.confirm('入力内容をすべてクリアします。よろしいですか？')) return;
  state.data = createEmptyData();
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
  const text = buildResultText(state.data, calcIndicators(p), getWarnings(p));
  const ok = await copyText(text);
  showToast(ok ? '結果をコピーしました' : 'コピーできませんでした');
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
  renderForm();
  renderWarnings();
  renderResults();

  $('companyName').addEventListener('input', (e) => {
    state.data.companyName = e.target.value;
    scheduleSave();
  });
  $('periodLabel').addEventListener('input', (e) => {
    currentPeriod().label = e.target.value;
    scheduleSave();
  });
  $('btnSample').addEventListener('click', onLoadSample);
  $('btnClear').addEventListener('click', onClear);
  $('btnCopy').addEventListener('click', onCopy);
  // 閉じる直前に未保存分を書き込む
  window.addEventListener('pagehide', () => { if (saveTimer) saveNow(); });
}

init();
