// 画面描画とイベント処理
import {
  PL_FIELDS, BS_FIELDS, CATEGORIES, INDICATORS, MAX_PERIODS, CHART_ROWS,
  calcIndicators, getWarnings, formatValue, buildResultText, parseAmount, isNum,
  buildComparison, formatChangeAmount, formatChangeRate,
  ADJUSTMENT_CATEGORIES, calcNormalizedEbitda, getAdjustmentWarnings, buildEbitdaBridge, formatAmount,
  DEBT_LIKE_EXAMPLES, CASH_LIKE_EXAMPLES, calcWorkingCapital, calcWorkingCapitalSeries,
  calcAdjustedNetDebt, getNetDebtItemWarnings, buildNetDebtBreakdown,
} from './calc.js';
import {
  loadData, saveData, createEmptyData, getSampleMultiData,
  addPeriod, removePeriod, movePeriod,
  backupToJson, backupFileName, parseBackup, getLastBackupAt, setLastBackupAt,
  needsBackupReminder, hasAnyData,
  createAdjustment, addAdjustment, removeAdjustment,
  createLineItem, addLineItem, removeLineItem, deleteAllData,
} from './store.js';
import { buildLineChartSvg } from './chart.js';
import { buildComparisonCsv, buildBridgeCsv, buildNetDebtCsv, csvFileName, CSV_KINDS } from './csv.js';
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
  renderAdjustments();
  renderNetDebtInputs();
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

// ---- 正常化EBITDA（調整項目） ----

function formatSigned(v) {
  if (!isNum(v)) return '—';
  const t = formatAmount(v);
  return v > 0 && t !== '0' ? `+${t}` : t;
}

function renderAdjustments() {
  const p = currentPeriod();
  $('adjPeriodName').textContent = periodName(p, state.selected);
  const list = $('adjList');
  list.replaceChildren();
  p.adjustments.forEach((a, i) => {
    const idBase = `adj-${i}`;
    const select = el('select', { id: `${idBase}-cat`, 'aria-label': '区分' });
    for (const c of ADJUSTMENT_CATEGORIES) {
      const o = el('option', { value: c.id, text: c.name });
      if (c.id === a.category) o.selected = true;
      select.append(o);
    }
    select.addEventListener('change', () => { a.category = select.value; onAdjustmentChanged(); });

    const desc = el('input', { id: `${idBase}-desc`, type: 'text', autocomplete: 'off', placeholder: '例：本社移転費用' });
    desc.value = a.description;
    desc.addEventListener('input', () => { a.description = desc.value; onAdjustmentChanged(); });

    const amount = el('input', { id: `${idBase}-amt`, type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '千円' });
    amount.value = formatInput(a.amount);
    amount.addEventListener('input', () => {
      const text = amount.value.trim();
      a.amount = parseAmount(text);
      amount.setAttribute('aria-invalid', text !== '' && a.amount === null ? 'true' : 'false');
      onAdjustmentChanged();
    });
    amount.addEventListener('blur', () => { if (isNum(a.amount)) amount.value = formatInput(a.amount); });
    const sign = el('button', { type: 'button', className: 'sign-btn', 'aria-label': '金額の符号を反転', text: '±' });
    sign.addEventListener('click', () => {
      if (!isNum(a.amount)) {
        amount.value = '-';
        amount.focus();
        return;
      }
      a.amount = -a.amount;
      amount.value = formatInput(a.amount);
      onAdjustmentChanged();
    });

    const memo = el('textarea', { id: `${idBase}-memo`, rows: '3', placeholder: '根拠メモ（例：役員報酬の市場水準の根拠、発生が一度限りである理由）' });
    memo.value = a.memo;
    memo.addEventListener('input', () => { a.memo = memo.value; onAdjustmentChanged(); });

    const remove = el('button', { type: 'button', className: 'btn btn-danger btn-small', text: '削除' });
    remove.addEventListener('click', () => onRemoveAdjustment(a));

    const item = el('div', { className: 'adj-item', 'data-adj-id': a.id }, [
      el('label', { className: 'field', for: select.id }, [el('span', { className: 'field-label', text: '区分' }), select]),
      el('label', { className: 'field', for: desc.id }, [el('span', { className: 'field-label', text: '内容' }), desc]),
      el('div', { className: 'field' }, [
        el('label', { className: 'field-label', for: amount.id, text: '金額（千円。EBITDAに加算は＋、減算は−）' }),
        el('div', { className: 'adj-amount' }, [amount, sign]),
      ]),
      el('label', { className: 'field', for: memo.id }, [el('span', { className: 'field-label', text: '根拠メモ' }), memo]),
      el('div', { className: 'adj-foot' }, [el('span', { className: 'adj-badges' }), remove]),
    ]);
    list.append(item);
  });
  renderAdjustmentSummary();
}

// 調整項目の一覧は作り直さず（入力中のフォーカスを保つ）、警告とブリッジだけを更新する
function renderAdjustmentSummary() {
  const p = currentPeriod();
  const warnings = getAdjustmentWarnings(p);
  const box = $('adjWarnings');
  box.replaceChildren();
  const memoCount = warnings.filter((w) => w.type === 'memoMissing').length;
  if (memoCount) box.append(el('div', { className: 'warning', text: `根拠未記載の調整項目が${memoCount}件あります` }));

  $('adjList').querySelectorAll('.adj-item').forEach((node, i) => {
    const mine = warnings.filter((w) => w.index === i);
    node.classList.toggle('warn', mine.length > 0);
    const badges = node.querySelector('.adj-badges');
    badges.replaceChildren(...mine.map((w) => el('span', {
      className: 'badge-warn',
      text: w.type === 'memoMissing' ? '根拠未記載' : '金額未入力',
    })));
  });

  const r = calcNormalizedEbitda(p);
  const table = $('bridgeSingle');
  table.replaceChildren();
  const row = (name, value, cls = '') => el('tr', { className: cls }, [el('th', { scope: 'row', text: name }), el('td', { text: value })]);
  table.append(row('報告EBITDA（営業利益＋減価償却費）', isNum(r.reported) ? `${formatAmount(r.reported)}千円` : '—'));
  for (const c of r.byCategory.filter((x) => x.count > 0)) {
    table.append(row(`${c.name}（${c.count}件）`, `${formatSigned(c.total)}千円`, 'indent'));
  }
  table.append(row('調整額合計', `${formatSigned(r.adjustmentTotal)}千円`));
  table.append(row('正常化EBITDA', isNum(r.normalized) ? `${formatAmount(r.normalized)}千円` : '—', 'total'));
  table.append(row('正常化EBITDAマージン', formatValue({ value: r.margin, status: isNum(r.margin) ? 'ok' : 'na' }, '%')));
}

function onAdjustmentChanged() {
  renderAdjustmentSummary();
  if (state.view === 'compare') renderCompare();
  scheduleSave();
}

function onAddAdjustment() {
  state.data = addAdjustment(state.data, state.selected, createAdjustment('executiveComp'));
  renderAdjustments();
  onAdjustmentChanged();
  const items = $('adjList').querySelectorAll('.adj-item');
  items[items.length - 1]?.querySelector('input[type="text"]')?.focus();
}

function onRemoveAdjustment(a) {
  const label = a.description ? `「${a.description}」` : 'この調整項目';
  if (!window.confirm(`${label}を削除します。よろしいですか？`)) return;
  state.data = removeAdjustment(state.data, state.selected, a.id);
  renderAdjustments();
  onAdjustmentChanged();
}

function renderBridgeTable() {
  const b = buildEbitdaBridge(state.data);
  const table = $('bridgeTable');
  table.replaceChildren();
  const head = el('tr', {}, [el('th', { className: 'row-head', scope: 'col', text: '項目' })]);
  b.labels.forEach((l, i) => head.append(el('th', { scope: 'col', text: l || `第${i + 1}期` })));
  table.append(el('thead', {}, [head]));
  const tbody = el('tbody');
  for (const r of b.rows) {
    const cls = r.kind === 'adjustment' ? 'indent' : r.kind === 'total' ? 'total' : '';
    const tr = el('tr', { className: cls }, [el('th', { className: 'row-head', scope: 'row', text: r.name })]);
    for (const v of r.values) {
      let text;
      if (r.unit === '%') text = formatValue({ value: v, status: isNum(v) ? 'ok' : 'na' }, '%');
      else if (r.kind === 'adjustment' || r.kind === 'subtotal') text = formatSigned(v);
      else text = isNum(v) ? formatAmount(v) : '—';
      tr.append(el('td', {}, [el('span', { className: `cell-value${isNum(v) ? (v < 0 ? ' negative' : '') : ' na'}`, text })]));
    }
    tbody.append(tr);
  }
  table.append(tbody);
}

// ---- 運転資本・ネットデット ----

const LINE_LISTS = [
  { key: 'debtLikeItems', container: 'debtLikeList', datalist: 'debtLikeExamples', kind: 'デットライク' },
  { key: 'cashLikeItems', container: 'cashLikeList', datalist: 'cashLikeExamples', kind: 'キャッシュライク' },
];

function pctText(v) {
  return formatValue({ value: v, status: isNum(v) ? 'ok' : 'na' }, '%');
}

function amountText(v) {
  return isNum(v) ? `${formatAmount(v)}千円` : '—';
}

function renderNetDebtInputs() {
  const p = currentPeriod();
  $('ndPeriodName').textContent = periodName(p, state.selected);
  for (const def of LINE_LISTS) {
    const list = $(def.container);
    list.replaceChildren();
    (p[def.key] ?? []).forEach((it, i) => {
      const idBase = `${def.key}-${i}`;
      const name = el('input', { id: `${idBase}-name`, type: 'text', autocomplete: 'off', list: def.datalist, placeholder: '名称' });
      name.value = it.name;
      name.addEventListener('input', () => { it.name = name.value; onNetDebtChanged(); });

      const amount = el('input', { id: `${idBase}-amt`, type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '千円' });
      amount.value = formatInput(it.amount);
      amount.addEventListener('input', () => {
        const text = amount.value.trim();
        it.amount = parseAmount(text);
        amount.setAttribute('aria-invalid', text !== '' && it.amount === null ? 'true' : 'false');
        onNetDebtChanged();
      });
      amount.addEventListener('blur', () => { if (isNum(it.amount)) amount.value = formatInput(it.amount); });
      const sign = el('button', { type: 'button', className: 'sign-btn', 'aria-label': '金額の符号を反転', text: '±' });
      sign.addEventListener('click', () => {
        if (!isNum(it.amount)) {
          amount.value = '-';
          amount.focus();
          return;
        }
        it.amount = -it.amount;
        amount.value = formatInput(it.amount);
        onNetDebtChanged();
      });

      const memo = el('textarea', { id: `${idBase}-memo`, rows: '2', placeholder: '根拠メモ（例：債務とみなす理由、換金性の根拠）' });
      memo.value = it.memo;
      memo.addEventListener('input', () => { it.memo = memo.value; onNetDebtChanged(); });

      const remove = el('button', { type: 'button', className: 'btn btn-danger btn-small', text: '削除' });
      remove.addEventListener('click', () => {
        const label = it.name ? `「${it.name}」` : 'この項目';
        if (!window.confirm(`${label}を削除します。よろしいですか？`)) return;
        state.data = removeLineItem(state.data, state.selected, def.key, it.id);
        renderNetDebtInputs();
        onNetDebtChanged();
      });

      list.append(el('div', { className: 'adj-item', 'data-list': def.key }, [
        el('label', { className: 'field', for: name.id }, [el('span', { className: 'field-label', text: '名称' }), name]),
        el('div', { className: 'field' }, [
          el('label', { className: 'field-label', for: amount.id, text: '金額（千円）' }),
          el('div', { className: 'adj-amount' }, [amount, sign]),
        ]),
        el('label', { className: 'field', for: memo.id }, [el('span', { className: 'field-label', text: '根拠メモ' }), memo]),
        el('div', { className: 'adj-foot' }, [el('span', { className: 'adj-badges' }), remove]),
      ]));
    });
  }
  renderNetDebtSummary();
}

// 入力欄は作り直さず、警告と集計表だけを更新する
function renderNetDebtSummary() {
  const p = currentPeriod();
  const warnings = getNetDebtItemWarnings(p);
  const box = $('ndWarnings');
  box.replaceChildren();
  const memoCount = warnings.filter((w) => w.type === 'memoMissing').length;
  if (memoCount) box.append(el('div', { className: 'warning', text: `根拠未記載のデットライク・キャッシュライク項目が${memoCount}件あります` }));
  for (const def of LINE_LISTS) {
    $(def.container).querySelectorAll('.adj-item').forEach((node, i) => {
      const mine = warnings.filter((w) => w.list === def.key && w.index === i);
      node.classList.toggle('warn', mine.length > 0);
      node.querySelector('.adj-badges').replaceChildren(...mine.map((w) => el('span', {
        className: 'badge-warn',
        text: w.type === 'memoMissing' ? '根拠未記載' : '金額未入力',
      })));
    });
  }

  const row = (name, value, cls = '') => el('tr', { className: cls }, [el('th', { scope: 'row', text: name }), el('td', { text: value })]);
  const wc = calcWorkingCapital(p);
  const bs = p.bs;
  $('wcSingle').replaceChildren(
    row('売上債権', amountText(bs.receivables), 'indent'),
    row('＋ 棚卸資産', amountText(bs.inventory), 'indent'),
    row('− 仕入債務', amountText(bs.payables), 'indent'),
    row('運転資本', amountText(wc.amount), 'total'),
    row('売上高に対する比率', pctText(wc.ratio)),
  );

  const nd = calcAdjustedNetDebt(p);
  $('ndSingle').replaceChildren(
    row('有利子負債', amountText(nd.interestBearingDebt)),
    row('＋ デットライク項目', amountText(nd.debtLikeTotal), 'indent'),
    row('− 現預金', amountText(nd.cash), 'indent'),
    row('− キャッシュライク項目', amountText(nd.cashLikeTotal), 'indent'),
    row('調整後ネットデット', amountText(nd.adjusted), 'total'),
    row('正常化EBITDA', amountText(nd.normalizedEbitda)),
    row('調整後ネットデット ÷ 正常化EBITDA', formatValue(nd.multiple, '倍')),
  );
}

function onNetDebtChanged() {
  renderNetDebtSummary();
  if (state.view === 'compare') renderCompare();
  scheduleSave();
}

function onAddLineItem(def) {
  state.data = addLineItem(state.data, state.selected, def.key, createLineItem());
  renderNetDebtInputs();
  onNetDebtChanged();
  const items = $(def.container).querySelectorAll('.adj-item');
  items[items.length - 1]?.querySelector('input')?.focus();
}

function headRowFor(labels, extra = []) {
  const head = el('tr', {}, [el('th', { className: 'row-head', scope: 'col', text: '項目' })]);
  labels.forEach((l, i) => head.append(el('th', { scope: 'col', text: l || `第${i + 1}期` })));
  for (const x of extra) head.append(el('th', { scope: 'col', className: 'avg-col', text: x }));
  return el('thead', {}, [head]);
}

function valueCell(text, v, cls = '') {
  return el('td', { className: cls }, [el('span', { className: `cell-value${isNum(v) ? (v < 0 ? ' negative' : '') : ' na'}`, text })]);
}

function renderWorkingCapitalTable() {
  const s = calcWorkingCapitalSeries(state.data);
  const periods = state.data.periods;
  const table = $('wcTable');
  table.replaceChildren(headRowFor(s.labels, ['参考：平均']));
  const tbody = el('tbody');
  const line = (name, values, avg, fmt, cls = '') => {
    const tr = el('tr', { className: cls }, [el('th', { className: 'row-head', scope: 'row', text: name })]);
    values.forEach((v) => tr.append(valueCell(fmt(v), v)));
    tr.append(valueCell(avg === undefined ? '' : fmt(avg), avg ?? null, 'avg-col'));
    tbody.append(tr);
  };
  const amt = (v) => (isNum(v) ? formatAmount(v) : '—');
  line('売上債権', periods.map((p) => p.bs.receivables), undefined, amt, 'indent');
  line('＋ 棚卸資産', periods.map((p) => p.bs.inventory), undefined, amt, 'indent');
  line('− 仕入債務', periods.map((p) => p.bs.payables), undefined, amt, 'indent');
  line('運転資本', s.items.map((x) => x.amount), s.average, amt, 'total');
  line('売上高に対する比率', s.items.map((x) => x.ratio), s.averageRatio, pctText);
  table.append(tbody);
}

function renderNetDebtTable() {
  const b = buildNetDebtBreakdown(state.data);
  const table = $('ndTable');
  table.replaceChildren(headRowFor(b.labels));
  const tbody = el('tbody');
  for (const r of b.rows) {
    const cls = r.kind === 'total' ? 'total' : r.kind === 'reference' ? 'reference' : r.kind === 'base' ? '' : 'indent';
    const tr = el('tr', { className: cls }, [el('th', { className: 'row-head', scope: 'row', text: r.name })]);
    r.values.forEach((v) => tr.append(valueCell(isNum(v) ? formatAmount(v) : '—', v)));
    tbody.append(tr);
  }
  const tr = el('tr', {}, [el('th', { className: 'row-head', scope: 'row', text: '調整後ネットデット ÷ 正常化EBITDA' })]);
  b.multiples.forEach((m) => tr.append(valueCell(formatValue(m, '倍'), m.status === 'ok' ? m.value : null)));
  tbody.append(tr);
  table.append(tbody);
}

// ---- 出力（CSV・印刷用レポート） ----

// iPhone では共有シート（「"ファイル"に保存」など）、それ以外はダウンロード。
// 戻り値：true（保存した）/ false（キャンセル）。失敗時は例外。
async function saveFile(file) {
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: file.name });
      return true;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return false;
  }
  downloadFile(file);
  return true;
}

async function exportCsv(kind, build) {
  saveNow();
  try {
    const csv = build();
    const file = new File([csv], csvFileName(kind), { type: 'text/csv;charset=utf-8' });
    if (await saveFile(file)) showToast(`${CSV_KINDS[kind]}のCSVを出力しました`);
  } catch {
    showToast('CSVを出力できませんでした');
  }
}

// レポートに載せる主要指標（比較表の行 id）
const REPORT_ROWS = [
  'sales', 'operatingIncome', 'ebitda', 'normalizedEbitda',
  'grossMargin', 'operatingMargin', 'normalizedEbitdaMargin', 'roe', 'roa',
  'equityRatio', 'currentRatio', 'deRatio', 'icr', 'ccc',
  'workingCapital', 'workingCapitalRatio', 'adjustedNetDebt', 'adjustedNetDebtToNormalizedEbitda',
];

function reportTable(labels, rows) {
  const head = el('tr', {}, [el('th', { scope: 'col', text: '項目' })]);
  labels.forEach((l, i) => head.append(el('th', { scope: 'col', text: l || `第${i + 1}期` })));
  const tbody = el('tbody');
  for (const r of rows) {
    const tr = el('tr', { className: r.cls || '' }, [el('th', { scope: 'row', text: r.name })]);
    r.cells.forEach((c) => tr.append(el('td', { className: c.neg ? 'neg' : '', text: c.text })));
    tbody.append(tr);
  }
  return el('table', {}, [el('thead', {}, [head]), tbody]);
}

function renderReport() {
  const data = state.data;
  const labels = data.periods.map((p, i) => periodName(p, i));
  const box = $('report');
  box.replaceChildren();
  const now = new Date();
  box.append(
    el('h1', { text: '財務分析レポート' }),
    el('p', { className: 'report-meta', text: `会社名：${data.companyName || '（未入力）'}　対象期：${labels.join('、')}　作成日：${formatDateTime(now).slice(0, 10)}　金額単位：千円` }),
  );

  // 主要指標
  const cmp = buildComparison(data, 'end');
  const rows = REPORT_ROWS.map((id) => cmp.rows.find((r) => r.id === id)).filter(Boolean).map((r) => ({
    name: r.name,
    cells: r.cells.map((c) => ({
      text: r.group === 'amounts' || r.unit === '千円'
        ? (isNum(c.result.value) ? formatAmount(c.result.value) : (c.result.status === 'notApplicable' ? '参考外' : '—'))
        : formatValue(c.result, r.unit),
      neg: c.result.status === 'ok' && c.result.value < 0,
    })),
  }));
  box.append(el('section', {}, [el('h2', { text: '主要指標（期末残高ベース）' }), reportTable(labels, rows)]));

  // EBITDAブリッジ
  const b = buildEbitdaBridge(data);
  box.append(el('section', {}, [
    el('h2', { text: 'EBITDAブリッジ' }),
    reportTable(labels, b.rows.map((r) => ({
      name: r.name,
      cls: r.kind === 'adjustment' ? 'indent' : r.kind === 'total' ? 'total' : '',
      cells: r.values.map((v) => ({
        text: r.unit === '%' ? pctText(v) : r.kind === 'adjustment' || r.kind === 'subtotal' ? formatSigned(v) : (isNum(v) ? formatAmount(v) : '—'),
        neg: isNum(v) && v < 0,
      })),
    }))),
  ]));

  // 調整項目の明細
  const adjRows = [];
  data.periods.forEach((p, i) => {
    for (const a of p.adjustments) adjRows.push([labels[i], ADJUSTMENT_CATEGORIES.find((c) => c.id === a.category)?.name ?? 'その他', a.description || '—', a.amount, a.memo || '（根拠未記載）']);
  });
  if (adjRows.length) {
    const tbody = el('tbody');
    for (const [l, cat, desc, amt, memo] of adjRows) {
      tbody.append(el('tr', {}, [
        el('td', { className: 'text', text: l }), el('td', { className: 'text', text: cat }), el('td', { className: 'text', text: desc }),
        el('td', { className: isNum(amt) && amt < 0 ? 'neg' : '', text: formatSigned(amt) }), el('td', { className: 'text', text: memo }),
      ]));
    }
    box.append(el('section', {}, [
      el('h2', { text: '正常化調整の明細' }),
      el('table', {}, [el('thead', {}, [el('tr', {}, ['期', '区分', '内容', '金額', '根拠'].map((t) => el('th', { scope: 'col', text: t })))]), tbody]),
    ]));
  }

  // ネットデット内訳
  const nd = buildNetDebtBreakdown(data);
  const ndRows = nd.rows.map((r) => ({
    name: r.name,
    cls: r.kind === 'total' ? 'total' : ['debtLike', 'cash', 'cashLike'].includes(r.kind) ? 'indent' : '',
    cells: r.values.map((v) => ({ text: isNum(v) ? formatAmount(v) : '—', neg: isNum(v) && v < 0 })),
  }));
  ndRows.push({ name: '調整後ネットデット ÷ 正常化EBITDA', cells: nd.multiples.map((m) => ({ text: formatValue(m, '倍'), neg: m.status === 'ok' && m.value < 0 })) });
  box.append(el('section', {}, [el('h2', { text: 'ネットデット内訳' }), reportTable(labels, ndRows)]));

  // 運転資本
  const wc = calcWorkingCapitalSeries(data);
  box.append(el('section', {}, [
    el('h2', { text: '運転資本（トレード）' }),
    reportTable([...labels, '参考：平均'], [
      { name: '運転資本', cells: [...wc.items.map((x) => x.amount), wc.average].map((v) => ({ text: isNum(v) ? formatAmount(v) : '—', neg: isNum(v) && v < 0 })) },
      { name: '売上高に対する比率', cells: [...wc.items.map((x) => x.ratio), wc.averageRatio].map((v) => ({ text: pctText(v) })) },
    ]),
  ]));

  // 警告・注記
  const warnings = [];
  data.periods.forEach((p, i) => {
    for (const w of [...getWarnings(p), ...getAdjustmentWarnings(p), ...getNetDebtItemWarnings(p)]) warnings.push(`${labels[i]}：${w.message}`);
  });
  const notes = [
    '金額単位は千円。計算は入力値をそのまま用い、表示時のみ丸めています。',
    '指標は期末残高ベースです。分母が0または未入力の指標は「—」、債務超過等で意味をなさない指標は「参考外」としています。',
    '正常化EBITDA ＝ 報告EBITDA（営業利益＋減価償却費）＋ 調整額合計。調整の妥当性は各根拠メモをご確認ください。',
    '調整後ネットデット ＝ 有利子負債 ＋ デットライク項目 − 現預金 − キャッシュライク項目。',
    '参考：平均運転資本は、本来は月次残高で算定すべきものであり、本値は期末残高による簡易的な目安です。',
    '本レポートは入力データに基づく簡易的な分析であり、監査・保証や財務デューデリジェンスの結論ではありません。',
  ];
  box.append(el('section', { className: 'notes' }, [
    el('h2', { text: '警告・注記' }),
    el('ul', {}, [...warnings.map((w) => el('li', { text: `【警告】${w}` })), ...notes.map((n) => el('li', { text: n }))]),
  ]));
}

function onDeleteAll() {
  if (!window.confirm('この端末に保存されているすべてのデータ（全期の入力・調整項目・最終バックアップ日時）を削除します。元に戻せません。\n\n削除する前にバックアップを保存することをおすすめします。削除してよろしいですか？')) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  const { ok, error } = deleteAllData();
  if (!ok) {
    showToast(error);
    return;
  }
  state.data = createEmptyData();
  state.selected = 0;
  renderForm();
  renderInputWarnings();
  renderInputResults();
  renderAdjustmentSummary();
  renderNetDebtSummary();
  renderBackupStatus();
  showToast('すべてのデータを削除しました');
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

  renderBridgeTable();
  renderWorkingCapitalTable();
  renderNetDebtTable();
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

// ---- 項目へのジャンプ ----

const SECTION_NAV = {
  input: [
    ['sec-basic', '基本情報'],
    ['sec-pl', 'PL入力'],
    ['sec-bs', 'BS入力'],
    ['results', '分析結果'],
    ['sec-adj', '正常化EBITDA'],
    ['sec-nd', '運転資本・ネットデット'],
    ['sec-backup', 'バックアップ'],
  ],
  compare: [
    ['sec-cmp-setting', '基準'],
    ['sec-cmp-table', '比較表'],
    ['sec-bridge', 'EBITDAブリッジ'],
    ['sec-wc', '運転資本'],
    ['sec-ndb', 'ネットデット'],
    ['sec-charts', 'グラフ'],
    ['sec-export', '出力'],
  ],
};

let sectionObserver = null;

function updateNavHeight() {
  const nav = document.querySelector('.sticky-nav');
  if (nav) document.documentElement.style.setProperty('--nav-height', `${nav.offsetHeight + 8}px`);
}

function setCurrentSection(id) {
  $('sectionNav').querySelectorAll('.section-link').forEach((b) => {
    const on = b.dataset.target === id;
    b.setAttribute('aria-current', String(on));
    if (on) b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
}

function jumpTo(id) {
  const target = $(id);
  if (!target) return;
  if (target.tagName === 'DETAILS') target.open = true;
  updateNavHeight();
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  setCurrentSection(id);
}

function renderSectionNav(view) {
  const nav = $('sectionNav');
  const items = SECTION_NAV[view] ?? [];
  nav.replaceChildren(...items.map(([id, label]) => {
    const b = el('button', { type: 'button', className: 'section-link', 'data-target': id, text: label });
    b.addEventListener('click', () => jumpTo(id));
    return b;
  }));
  // 画面に見えている項目をメニュー上で強調する
  if (sectionObserver) sectionObserver.disconnect();
  if (!('IntersectionObserver' in window)) return;
  sectionObserver = new IntersectionObserver((entries) => {
    const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
    if (visible[0]) setCurrentSection(visible[0].target.id);
  }, { rootMargin: '-120px 0px -60% 0px' });
  for (const [id] of items) if ($(id)) sectionObserver.observe($(id));
  updateNavHeight();
}

// ---- 共通 ----

function setView(view) {
  state.view = view;
  document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.view === view)));
  $('view-input').hidden = view !== 'input';
  $('view-compare').hidden = view !== 'compare';
  const reporting = view === 'report';
  document.body.classList.toggle('reporting', reporting);
  document.querySelector('.app-header').hidden = reporting;
  document.querySelector('.sticky-nav').hidden = reporting;
  document.querySelector('.app-main').hidden = reporting;
  if (!reporting) renderSectionNav(view);
  $('view-report').hidden = !reporting;
  if (view === 'compare') renderCompare();
  if (reporting) renderReport();
  window.scrollTo(0, 0);
}

function update() {
  renderInputWarnings();
  renderInputResults();
  renderAdjustmentSummary();
  renderNetDebtSummary();
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
    if (!(await saveFile(file))) return; // 共有をキャンセルした
  } catch {
    showToast('バックアップを保存できませんでした');
    return;
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
    $('adjPeriodName').textContent = periodName(currentPeriod(), state.selected);
    $('ndPeriodName').textContent = periodName(currentPeriod(), state.selected);
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
  $('btnAddAdj').addEventListener('click', onAddAdjustment);
  $('btnAddDebtLike').addEventListener('click', () => onAddLineItem(LINE_LISTS[0]));
  $('btnAddCashLike').addEventListener('click', () => onAddLineItem(LINE_LISTS[1]));
  $('debtLikeExamples').replaceChildren(...DEBT_LIKE_EXAMPLES.map((v) => el('option', { value: v })));
  $('cashLikeExamples').replaceChildren(...CASH_LIKE_EXAMPLES.map((v) => el('option', { value: v })));
  $('btnExport').addEventListener('click', onExport);
  $('btnDeleteAll').addEventListener('click', onDeleteAll);
  $('btnCsvCompare').addEventListener('click', () => exportCsv('comparison', () => buildComparisonCsv(state.data, state.basis)));
  $('btnCsvBridge').addEventListener('click', () => exportCsv('bridge', () => buildBridgeCsv(state.data)));
  $('btnCsvNetDebt').addEventListener('click', () => exportCsv('netDebt', () => buildNetDebtCsv(state.data)));
  $('btnReport').addEventListener('click', () => setView('report'));
  $('btnReportBack').addEventListener('click', () => setView('compare'));
  $('btnPrint').addEventListener('click', () => window.print());
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

  renderSectionNav('input');
  window.addEventListener('resize', updateNavHeight);

  // 閉じる直前に未保存分を書き込む
  window.addEventListener('pagehide', () => { if (saveTimer) saveNow(); });
}

init();
