// 出力（CSV・印刷用レポート）・データ削除
import { badgeFor, reportNote } from '../badges.js';
import {
  buildComparison, buildEbitdaBridge, buildNetDebtBreakdown, calcWorkingCapitalSeries, getAdjustmentWarnings, getNetDebtItemWarnings, getWarnings, isNum,
} from '../calc.js';
import { CSV_KINDS, csvFileName } from '../csv.js';
import { REPORT_DISCLAIMER } from '../help.js';
import { categoryLabel, rowLabel } from '../settings.js';
import { createEmptyData, deleteAllData } from '../store.js';
import { formatSigned, renderAdjustmentSummary } from './adjustments.js';
import { downloadFile, renderBackupStatus } from './backup.js';
import { createWorkspace } from '../workspace.js';
import { renderCompanyBar } from './companies.js';
import {
  $, cancelPendingSave, days, el, evaluation, fa, fmt, formatDateTime, fv, saveNow, setWorkspace, settings, showToast, state, unitName,
} from './core.js';
import { periodName, renderForm, renderInputResults, renderInputWarnings } from './input.js';
import { pctText, renderNetDebtSummary } from './netdebt.js';


// iPhone では共有シート（「"ファイル"に保存」など）、それ以外はダウンロード。
// 戻り値：true（保存した）/ false（キャンセル）。失敗時は例外。
export async function saveFile(file) {
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

export async function exportCsv(kind, build) {
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
export const REPORT_ROWS = [
  'sales', 'operatingIncome', 'ebitda', 'normalizedEbitda',
  'grossMargin', 'operatingMargin', 'normalizedEbitdaMargin', 'roe', 'roa',
  'equityRatio', 'currentRatio', 'deRatio', 'icr', 'ccc',
  'workingCapital', 'workingCapitalRatio', 'adjustedNetDebt', 'adjustedNetDebtToNormalizedEbitda',
];

export function reportTable(labels, rows) {
  const head = el('tr', {}, [el('th', { scope: 'col', text: '項目' })]);
  labels.forEach((l, i) => head.append(el('th', { scope: 'col', text: l || `第${i + 1}期` })));
  const tbody = el('tbody');
  for (const r of rows) {
    const tr = el('tr', { className: r.cls || '' }, [el('th', { scope: 'row', text: r.name })]);
    r.cells.forEach((c) => tr.append(el('td', { className: c.neg ? 'neg' : '' }, [
      c.text, ...(c.badge ? [el('span', { className: `report-badge badge-${c.badge.level}`, text: c.badge.text })] : []),
    ])));
    tbody.append(tr);
  }
  return el('table', {}, [el('thead', {}, [head]), tbody]);
}

export function renderReport() {
  const data = state.data;
  const labels = data.periods.map((p, i) => periodName(p, i));
  const box = $('report');
  box.replaceChildren();
  const now = new Date();
  box.append(
    el('h1', { text: '財務分析レポート' }),
    el('p', { className: 'report-app', text: '数字のミカタ' }),
    el('p', { className: 'report-meta', text: `会社名：${data.companyName || '（未入力）'}　対象期：${labels.join('、')}　作成日：${formatDateTime(now).slice(0, 10)}　金額単位：${unitName('report')}` }),
  );

  // 主要指標
  const cmp = buildComparison(data, 'end');
  const rows = REPORT_ROWS.map((id) => cmp.rows.find((r) => r.id === id)).filter(Boolean).map((r) => ({
    name: rowLabel(settings(), r),
    cells: r.cells.map((c, ci) => ({
      badge: badgeFor(r.id, c.result, data.periods[ci], evaluation()),
      text: r.group === 'amounts' || r.unit === '千円'
        ? (isNum(c.result.value) ? fa(c.result.value, 'report') : (c.result.status === 'notApplicable' ? '参考外' : '—'))
        : fv(c.result, r.unit, 'report'),
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
        text: r.unit === '%' ? pctText(v) : r.kind === 'adjustment' || r.kind === 'subtotal' ? formatSigned(v, 'report') : (isNum(v) ? fa(v, 'report') : '—'),
        neg: isNum(v) && v < 0,
      })),
    }))),
  ]));

  // 調整項目の明細
  const adjRows = [];
  data.periods.forEach((p, i) => {
    for (const a of p.adjustments) adjRows.push([labels[i], categoryLabel(settings(), a.category), a.description || '—', a.amount, a.memo || '（根拠未記載）']);
  });
  if (adjRows.length) {
    const tbody = el('tbody');
    for (const [l, cat, desc, amt, memo] of adjRows) {
      tbody.append(el('tr', {}, [
        el('td', { className: 'text', text: l }), el('td', { className: 'text', text: cat }), el('td', { className: 'text', text: desc }),
        el('td', { className: isNum(amt) && amt < 0 ? 'neg' : '', text: formatSigned(amt, 'report') }), el('td', { className: 'text', text: memo }),
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
    cells: r.values.map((v) => ({ text: isNum(v) ? fa(v, 'report') : '—', neg: isNum(v) && v < 0 })),
  }));
  ndRows.push({ name: '調整後ネットデット ÷ 正常化EBITDA', cells: nd.multiples.map((m) => ({ text: fv(m, '倍', 'report'), neg: m.status === 'ok' && m.value < 0 })) });
  box.append(el('section', {}, [el('h2', { text: 'ネットデット内訳' }), reportTable(labels, ndRows)]));

  // 運転資本
  const wc = calcWorkingCapitalSeries(data);
  box.append(el('section', {}, [
    el('h2', { text: '運転資本（トレード）' }),
    reportTable([...labels, '参考：平均'], [
      { name: '運転資本', cells: [...wc.items.map((x) => x.amount), wc.average].map((v) => ({ text: isNum(v) ? fa(v, 'report') : '—', neg: isNum(v) && v < 0 })) },
      { name: '売上高に対する比率', cells: [...wc.items.map((x) => x.ratio), wc.averageRatio].map((v) => ({ text: pctText(v) })) },
    ]),
  ]));

  // 警告・注記
  const warnings = [];
  data.periods.forEach((p, i) => {
    for (const w of [...getWarnings(p, fmt('report'), fmt('report')), ...getAdjustmentWarnings(p), ...getNetDebtItemWarnings(p)]) warnings.push(`${labels[i]}：${w.message}`);
  });
  const notes = [
    `金額単位は${unitName('report')}。計算は入力値をそのまま用い、表示時のみ丸めています。`,
    `回転日数は1年を${days()}日として計算しています。`,
    '指標は期末残高ベースです。分母が0または未入力の指標は「—」、債務超過等で意味をなさない指標は「参考外」としています。',
    '正常化EBITDA ＝ 報告EBITDA（営業利益＋減価償却費）＋ 調整額合計。調整の妥当性は各根拠メモをご確認ください。',
    '調整後ネットデット ＝ 有利子負債 ＋ デットライク項目 − 現預金 − キャッシュライク項目。',
    '参考：平均運転資本は、本来は月次残高で算定すべきものであり、本値は期末残高による簡易的な目安です。',
    ...(reportNote(evaluation()) ? [reportNote(evaluation())] : []),
    REPORT_DISCLAIMER,
  ];
  box.append(el('section', { className: 'notes' }, [
    el('h2', { text: '警告・注記' }),
    el('ul', {}, [...warnings.map((w) => el('li', { text: `【警告】${w}` })), ...notes.map((n) => el('li', { text: n }))]),
  ]));
}

export function onDeleteAll() {
  if (!window.confirm(`この端末に保存されているすべてのデータ（全${state.workspace.companies.length}社の入力・設定・最終バックアップ日時）を削除します。元に戻せません。\n\n削除する前に「全社のバックアップ」を保存することをおすすめします。削除してよろしいですか？`)) return;
  cancelPendingSave();
  const { ok, error } = deleteAllData();
  if (!ok) {
    showToast(error);
    return;
  }
  setWorkspace(createWorkspace());
  renderCompanyBar();
  renderForm();
  renderInputWarnings();
  renderInputResults();
  renderAdjustmentSummary();
  renderNetDebtSummary();
  renderBackupStatus();
  showToast('すべてのデータを削除しました');
}
