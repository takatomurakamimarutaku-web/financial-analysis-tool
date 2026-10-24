// 試算表・決算書CSVの取込（選択中の期に入れる）
import {
  IGNORE, IMPORT_UNITS, applyImportToPeriod, buildImport, decodeCsvBytes, prepareImport, updateImportMap,
} from '../importer.js';
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

export async function onCsvFile(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  let text;
  try {
    text = decodeCsvBytes(new Uint8Array(await file.arrayBuffer()));
  } catch {
    showToast('ファイルを読み込めませんでした');
    return;
  } finally {
    // 同じファイルをもう一度選んでも取り込めるように
    e.target.value = '';
  }
  const items = prepareImport(text, state.workspace.importMap);
  if (!items.length) {
    window.alert('取り込める行が見つかりませんでした。\n「科目名」と「金額」が1行に並んだCSV（試算表・決算書の書き出しなど）を選んでください。');
    return;
  }
  openImportDialog(items, file.name);
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

function openImportDialog(items, fileName) {
  const groups = targetOptions();
  const labelOf = new Map(groups.flatMap((g) => g.opts.map((o) => [o.id, o.label])));
  const p = currentPeriod();
  const unit = el('select', { id: 'csvUnit', 'aria-label': 'CSVの金額の単位' },
    IMPORT_UNITS.map((u) => el('option', { value: u.id, text: u.name })));
  unit.value = 'yen';
  const preview = el('div', { className: 'csv-preview', 'aria-live': 'polite' });

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

  const list = el('div', { className: 'csv-map' }, items.map((it) => {
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
  unit.addEventListener('change', refreshPreview);
  refreshPreview();

  openModal({
    title: '試算表CSVを取り込む',
    body: [
      el('p', { text: `「${fileName}」の${items.length}行を「${periodName(p, state.selected)}」に取り込みます。科目ごとに入力項目を選んでください（選び直した対応は次回も使います）。` }),
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
