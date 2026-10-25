// 試算表・決算書CSVの取込（選択中の期に入れる）
import { AUTO_PRESET, CSV_PRESETS, PRESET_NOTICE, presetById } from '../import-presets.js';
import {
  IGNORE, IMPORT_UNITS, analyzeImport, applyImportToPeriod, buildImport, decodeCsv, updateImportMap,
} from '../importer.js';
import { columnName } from '../xlsx.js';
import { accountTree, isComputedAccount } from '../settings.js';
import { update } from './app.js';
import { keepUndo, showUndoToast } from './backup.js';
import { $, currentPeriod, el, fa, saveNow, settings, showToast, state, unitName } from './core.js';
import { openModal } from './dialogs.js';
import { periodName, renderForm } from './input.js';

export function onCsvImportClick() {
  $('csvFile').value = '';
  $('csvFile').click();
}

// 最後に選んだ会計ソフト（端末ごとの設定。保存できなくても動く）
const PRESET_KEY = 'finAnalysisTool.importPreset';
function loadPreset() {
  try {
    const v = localStorage.getItem(PRESET_KEY);
    return v && (v === AUTO_PRESET || presetById(v)) ? v : AUTO_PRESET;
  } catch {
    return AUTO_PRESET;
  }
}
function savePreset(id) {
  try {
    localStorage.setItem(PRESET_KEY, id);
  } catch {
    // 保存できない環境では次回は自動判定
  }
}

export async function onCsvFile(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  let decoded;
  try {
    decoded = decodeCsv(new Uint8Array(await file.arrayBuffer()));
  } catch {
    showToast('ファイルを読み込めませんでした');
    return;
  } finally {
    // 同じファイルをもう一度選んでも取り込めるように
    e.target.value = '';
  }
  const first = analyzeImport(decoded.text, state.workspace.importMap, { preset: loadPreset() });
  if (!first.items.length && !first.rows.some((r) => r.some((c) => c.trim() !== ''))) {
    window.alert('取り込める行が見つかりませんでした。\n「科目名」と「金額」が1行に並んだCSV（試算表・決算書の書き出しなど）を選んでください。');
    return;
  }
  openImportDialog(decoded, file.name);
}

// 選べる入力項目（内訳科目の合計で計算している項目は除く。取り込んでも内訳の合計で上書きされるため）
function targetOptions() {
  const s = settings();
  const p = currentPeriod();
  const groups = [];
  for (const [section, name] of [['pl', '損益計算書'], ['bs', '貸借対照表']]) {
    const opts = accountTree(s, section)
      .filter((a) => !isComputedAccount(p, s, a.key))
      .map((a) => ({ id: `${section}.${a.key}`, label: a.label }));
    groups.push({ name, opts });
  }
  return groups;
}

function targetSelect(item, groups, onChange) {
  const sel = el('select', { 'aria-label': `「${item.label}」の取込先` });
  sel.append(el('option', { value: IGNORE, text: '取り込まない' }));
  for (const g of groups) {
    const og = el('optgroup', { label: g.name });
    og.append(...g.opts.map((o) => el('option', { value: o.id, text: o.label })));
    sel.append(og);
  }
  const valid = groups.some((g) => g.opts.some((o) => o.id === item.target));
  sel.value = valid ? item.target : IGNORE;
  if (!valid) item.target = IGNORE;
  sel.addEventListener('change', () => {
    item.target = sel.value;
    item.from = 'user';
    onChange();
  });
  return sel;
}

const FROM_NOTE = {
  saved: '前回の対応',
  auto: '自動',
  dedup: '合計の行を優先',
  none: '',
  user: '変更',
};

const MANUAL = 'manual';
const DC = 'dc';

function columnOptions(rows, names) {
  const n = Math.min(Math.max(0, ...rows.slice(0, 50).map((r) => r.length)), 60);
  return Array.from({ length: n }, (_, i) => ({ value: String(i), text: `${columnName(i)}列${names?.[i] ? `「${names[i]}」` : ''}` }));
}

function selectOf(id, label, options, value, onChange) {
  const sel = el('select', { id, 'aria-label': label }, options.map((o) => el('option', { value: o.value, text: o.text })));
  sel.value = value;
  sel.addEventListener('change', () => onChange(sel.value));
  return el('label', { className: 'field csv-col' }, [el('span', { className: 'field-label', text: label }), sel]);
}

function openImportDialog(decoded, fileName) {
  const groups = targetOptions();
  const labelOf = new Map(groups.flatMap((g) => g.opts.map((o) => [o.id, o.label])));
  const p = currentPeriod();
  let preset = loadPreset();
  let userColumns = null; // 利用者が選んだ列の割り当て（null = 見出し行から自動）
  let analysis = null;
  let items = [];

  const unit = el('select', { id: 'csvUnit', 'aria-label': 'CSVの金額の単位' },
    IMPORT_UNITS.map((u) => el('option', { value: u.id, text: u.name })));
  unit.value = 'yen';
  const presetBox = el('div', { className: 'csv-preset' });
  const columnsBox = el('details', { className: 'csv-columns' });
  const list = el('div', { className: 'csv-map' });
  const preview = el('div', { className: 'csv-preview', 'aria-live': 'polite' });
  const head = el('p');

  const refreshPreview = () => {
    const r = buildImport(items, unit.value);
    const counts = {};
    for (const it of items) if (it.target !== IGNORE) counts[it.target] = (counts[it.target] ?? 0) + 1;
    const rows = [];
    for (const section of ['pl', 'bs']) {
      for (const [key, v] of Object.entries(r[section])) {
        const id = `${section}.${key}`;
        const before = p[section][key];
        rows.push(el('li', {}, [
          el('span', { className: 'csv-preview-name', text: labelOf.get(id) ?? id }),
          el('span', { className: 'csv-preview-value', text: `${fa(v, section)}${unitName(section)}${counts[id] > 1 ? `（${counts[id]}行を合算）` : ''}` }),
          el('span', { className: 'csv-preview-before', text: before === null || before === undefined ? '' : `いま：${fa(before, section)}${unitName(section)}` }),
        ]));
      }
    }
    preview.replaceChildren(
      el('p', { className: 'csv-preview-head', text: rows.length ? `取り込む項目（${rows.length}項目）` : '取り込む項目がありません。右の欄で入力項目を選んでください。' }),
      el('ul', { className: 'csv-preview-list' }, rows),
    );
  };

  const renderList = () => {
    list.replaceChildren(...items.map((it) => {
      const note = el('span', { className: 'csv-map-from', text: FROM_NOTE[it.from] ?? '' });
      const row = el('div', { className: 'csv-map-row' });
      const sel = targetSelect(it, groups, () => {
        note.textContent = FROM_NOTE.user;
        row.classList.toggle('ignored', it.target === IGNORE);
        refreshPreview();
      });
      row.classList.toggle('ignored', it.target === IGNORE);
      row.append(
        el('div', { className: 'csv-map-head' }, [
          el('span', { className: 'csv-map-label', text: it.label }),
          el('span', { className: 'csv-map-amount', text: it.amount.toLocaleString('ja-JP', { maximumFractionDigits: 6 }) }),
        ]),
        el('div', { className: 'csv-map-target' }, [sel, note]),
      );
      return row;
    }));
    if (!items.length) list.append(el('p', { className: 'warning', text: '読み取れた行がありません。「列の割り当て」で科目名と金額の列を選んでください。' }));
  };

  const renderPreset = () => {
    const pr = presetById(preset);
    const sel = selectOf('csvPreset', '会計ソフト', [
      { value: AUTO_PRESET, text: '自動判定（ソフトを指定しない）' },
      ...CSV_PRESETS.map((x) => ({ value: x.id, text: `${x.name}（未検証）` })),
    ], preset, (v) => {
      preset = v;
      savePreset(v);
      userColumns = null;
      analyze();
    });
    presetBox.replaceChildren(sel, ...(pr ? [el('details', { className: 'csv-howto' }, [
      el('summary', { text: `${pr.name}からの書き出し方` }),
      el('ol', {}, pr.howTo.map((t) => el('li', { text: t }))),
    ])] : []), el('p', { className: 'note csv-unverified', text: PRESET_NOTICE }));
  };

  const renderColumns = () => {
    const c = analysis.columns;
    const opts = columnOptions(analysis.rows, c?.names);
    const manual = (patch) => {
      const base = c ?? { headerIndex: -1, names: [], label: 0, labels: [0], sub: null, code: null, amount: Math.max(0, opts.length - 1), debitBalance: null, creditBalance: null };
      userColumns = { ...base, ...patch };
      analyze();
    };
    const hasDc = c && c.debitBalance !== null && c.creditBalance !== null;
    const amountValue = !c ? MANUAL : (c.amount === null ? DC : String(c.amount));
    const status = c
      ? `見出し行：${c.headerIndex >= 0 ? `${c.headerIndex + 1}行目` : 'なし（すべての行を読む）'}${userColumns ? '（列を手動で選択）' : '（自動で判定）'}`
      : '見出し行が見つからないため、各行の最初の文字を科目名、最後の数値を金額として読んでいます。';
    columnsBox.replaceChildren(
      el('summary', { text: `列の割り当て（文字コード：${decoded.encoding}）` }),
      el('p', { className: 'note', text: status }),
      selectOf('csvColLabel', '科目名の列', [...(c ? [] : [{ value: MANUAL, text: '（自動）' }]), ...opts], c ? String(c.label) : MANUAL,
        (v) => { if (v !== MANUAL) manual({ label: Number(v), labels: [Number(v)] }); }),
      selectOf('csvColAmount', '金額の列（期末の残高）', [
        ...(c ? [] : [{ value: MANUAL, text: '（自動）' }]),
        ...(hasDc ? [{ value: DC, text: '「借方残高」「貸方残高」の列から' }] : []),
        ...opts,
      ], amountValue, (v) => {
        if (v === MANUAL) return;
        manual(v === DC ? { amount: null } : { amount: Number(v) });
      }),
      selectOf('csvColSub', '補助科目の列（値のある行は除く）', [{ value: 'none', text: 'なし' }, ...opts], c?.sub === null || c?.sub === undefined ? 'none' : String(c.sub),
        (v) => manual({ sub: v === 'none' ? null : Number(v) })),
      ...(userColumns ? [(() => {
        const b = el('button', { type: 'button', className: 'btn btn-small', text: '自動の判定に戻す' });
        b.addEventListener('click', () => { userColumns = null; analyze(); });
        return b;
      })()] : []),
      el('p', { className: 'note', text: '列を変えると、科目ごとの取込先は選び直しになります。' }),
    );
  };

  function analyze() {
    analysis = analyzeImport(decoded.text, state.workspace.importMap, { preset, columns: userColumns });
    items = analysis.items;
    head.textContent = `「${fileName}」の${items.length}行を「${periodName(p, state.selected)}」に取り込みます。科目ごとに入力項目を選んでください（選び直した対応は次回も使います）。`;
    renderPreset();
    renderColumns();
    renderList();
    refreshPreview();
  }

  unit.addEventListener('change', refreshPreview);
  analyze();
  if (!analysis.columns) columnsBox.open = true;

  openModal({
    title: '試算表CSVを取り込む',
    body: [
      head,
      presetBox,
      columnsBox,
      el('label', { className: 'field csv-unit' }, [el('span', { className: 'field-label', text: 'CSVの金額の単位' }), unit]),
      list,
      preview,
      el('p', { className: 'note', text: '取り込んだ項目だけを上書きし、ほかの入力・調整項目は変わりません。同じ入力項目に複数の行を選ぶと合計します。' }),
    ],
    actions: [
      { label: 'キャンセル' },
      { label: '取り込む', primary: true, onClick: () => applyImport(items, unit.value) },
    ],
  });
}

function applyImport(items, unit) {
  const r = buildImport(items, unit);
  const n = Object.keys(r.pl).length + Object.keys(r.bs).length;
  // 取り込む項目がなくても、選び直した対応は保存する
  const importMap = updateImportMap(state.workspace.importMap, items);
  if (!n) {
    state.workspace = { ...state.workspace, importMap };
    saveNow();
    showToast('取り込む項目がありませんでした');
    return;
  }
  const undoable = keepUndo('import');
  state.data.periods[state.selected] = applyImportToPeriod(currentPeriod(), r);
  state.workspace = { ...state.workspace, importMap };
  renderForm();
  update();
  saveNow();
  showUndoToast(`${n}項目を取り込みました`, undoable);
}
