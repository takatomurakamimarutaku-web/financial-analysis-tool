// 設定タブ
import {
  BADGE_TARGETS, CRITERIA, JFC_DATA_CHECKED_AT, JFC_INDUSTRIES, jfcSurveyLabel, jfcUpdateDue, jfcYearsSummary, TKC_TARGETS, criterionLabel, guideFor, isModified, resetOverrides, ruleFor, setBadgeDisabled, setCriterion, setOverride, setTkcValue,
} from '../badges.js';
import { ADJUSTMENT_CATEGORIES, CATEGORIES, INDICATORS, formulaText, isNum, parseAmount } from '../calc.js';
import { CHANGELOG } from '../changelog.js';
import { CONTACT, COPYRIGHT, DISCLAIMER, LICENSE_TEXT, NA_RULES, PRIVACY, helpCatalog } from '../help.js';
import { APP_VERSION, checkForUpdate, isStoragePersisted } from '../pwa.js';
import {
  AMOUNT_UNITS, BACKUP_REMINDER_CHOICES, DIGIT_LIMITS, MAX_CUSTOM_ACCOUNTS, NEGATIVE_STYLES, OTHER_DETAIL_LABEL, THEMES, UNIT_SCOPES, accountTree, addCustomAccount, commonUnit, createDefaultSettings, indicatorList, moveAccount, moveIndicator, removeCustomAccount, renameAccount, renameCategory, setAccountHidden, setIndicatorHidden, setUnit, unitOf, updateSettings,
} from '../settings.js';
import { getLastBackupAt } from '../store.js';
import { loadUndo } from '../workspace.js';
import { update } from './app.js';
import { onExport, onImportClick, onUndo } from './backup.js';
import { loadLock } from '../lock.js';
import { renderLockPage } from './lock.js';
import { renderCompaniesPage } from './companies.js';
import { $, days, el, evaluation, formatDateTime, fv, settings, showToast, state } from './core.js';
import { changelogList, helpBody, openOnboarding } from './dialogs.js';
import { renderForm } from './input.js';
import { acc } from './netdebt.js';
import { onDeleteAll } from './report.js';


export const SETTINGS_PAGES = [
  { id: 'companies', title: '会社の管理', summary: () => `${state.workspace.companies.length}社を登録` },
  { id: 'unit', title: '金額の単位', summary: () => (commonUnit(settings()) ? `すべて${commonUnit(settings()).name}` : '区分ごとに設定') },
  { id: 'pl', title: 'PL科目', summary: () => accountSummary('pl') },
  { id: 'bs', title: 'BS科目', summary: () => accountSummary('bs') },
  { id: 'indicators', title: '指標の表示・並び順', summary: () => `${INDICATORS.length}件中${indicatorList(settings()).length}件を表示` },
  { id: 'evaluation', title: '評価基準（バッジ）', summary: () => (evaluation().enabled ? criterionLabel(evaluation()) : 'バッジを表示しない') },
  { id: 'glossary', title: '指標の解説（計算式一覧）', summary: () => '計算式・意味・評価の目安' },
  { id: 'analysis', title: '分析の基本設定', summary: () => `1年＝${days()}日・比較の初期値：${settings().analysis.defaultBasis === 'average' ? '平均残高' : '期末残高'}` },
  { id: 'display', title: '画面の表示', summary: () => `テーマ：${THEMES.find((t) => t.id === settings().theme).name}・マイナス：${settings().negativeStyle === 'triangle' ? '△' : '−'}` },
  { id: 'digits', title: '表示桁数', summary: () => `%：${settings().digits.pct}桁・日：${settings().digits.days}桁・倍/回：${settings().digits.times}桁` },
  { id: 'categories', title: '正常化EBITDAの調整区分', summary: () => `${Object.keys(settings().adjustmentCategoryNames).length}件を名称変更` },
  { id: 'lock', title: 'パスコードロック', summary: () => (loadLock().record ? 'オン' : 'オフ') },
  { id: 'data', title: 'バックアップ・データ管理', summary: () => (settings().backupReminderDays ? `${settings().backupReminderDays}日ごとに案内` : 'バックアップの案内なし') },
  { id: 'about', title: 'このアプリについて', summary: () => `バージョン ${APP_VERSION}` },
];

export function accountSummary(section) {
  const tree = accountTree(settings(), section);
  const hidden = tree.filter((a) => a.hidden).length;
  const kids = tree.reduce((n, a) => n + a.children.length, 0);
  const parts = [`${tree.length}科目`];
  if (hidden) parts.push(`非表示${hidden}`);
  if (kids) parts.push(`内訳${kids}`);
  return parts.join('・');
}

// 設定を変更して保存し、関係する画面を描き直す
export function changeSettings(next, { rerenderPage = true } = {}) {
  state.data = next;
  renderForm();
  update();
  if (rerenderPage) renderSettings();
}

export function openSettingsPage(id) {
  state.settingsPage = id;
  renderSettings();
  window.scrollTo(0, 0);
}

export function renderSettings() {
  const box = $('settingsBody');
  box.replaceChildren();
  const page = SETTINGS_PAGES.find((p) => p.id === state.settingsPage);
  if (!page) {
    const list = el('ul', { className: 'settings-list' });
    for (const p of SETTINGS_PAGES) {
      const b = el('button', { type: 'button', className: 'settings-item' }, [
        el('span', { className: 'settings-item-title', text: p.title }),
        el('span', { className: 'settings-item-summary', text: p.summary() }),
        el('span', { className: 'settings-item-arrow', 'aria-hidden': 'true', text: '›' }),
      ]);
      b.addEventListener('click', () => openSettingsPage(p.id));
      list.append(el('li', {}, [b]));
    }
    box.append(el('section', { className: 'panel' }, [el('h2', { className: 'panel-title', text: '設定' }), list]));
    box.append(el('p', { className: 'note', text: '設定はこの端末のデータと一緒に保存され、JSONバックアップにも含まれます。' }));
    return;
  }
  const back = el('button', { type: 'button', className: 'btn settings-back', text: '← 設定に戻る' });
  back.addEventListener('click', () => openSettingsPage(null));
  const panel = el('section', { className: 'panel settings-page' }, [el('h2', { className: 'panel-title', text: page.title })]);
  box.append(back, panel);
  SETTINGS_RENDERERS[page.id](panel);
}

export function radioGroup(name, options, current, onChange) {
  const group = el('div', { className: 'choice-list', role: 'radiogroup' });
  for (const o of options) {
    const input = el('input', { type: 'radio', name, value: String(o.value) });
    input.checked = o.value === current;
    input.addEventListener('change', () => onChange(o.value));
    group.append(el('label', { className: 'choice' }, [input, el('span', {}, [
      el('span', { className: 'choice-title', text: o.label }),
      ...(o.note ? [el('span', { className: 'choice-note', text: o.note })] : []),
    ])]));
  }
  return group;
}

export function smallBtn(text, label, onClick, disabled = false) {
  const b = el('button', { type: 'button', className: 'btn btn-icon btn-small', 'aria-label': label, text });
  b.disabled = disabled;
  b.addEventListener('click', onClick);
  return b;
}

export function toggle(label, checked, onChange) {
  const input = el('input', { type: 'checkbox' });
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  return el('label', { className: 'check toggle' }, [input, el('span', { text: label })]);
}

export function unitSelect(scope, label) {
  const select = el('select', { id: `unit-${scope}`, 'aria-label': `${label}の単位` });
  for (const u of AMOUNT_UNITS) {
    const o = el('option', { value: u.id, text: u.name });
    if (u.id === unitOf(settings(), scope).id) o.selected = true;
    select.append(o);
  }
  select.addEventListener('change', () => changeSettings(updateSettings(state.data, { units: setUnit(settings(), scope, select.value).units })));
  return select;
}

export function renderUnitPage(panel) {
  panel.append(el('p', { className: 'note', text: '区分ごとに、入力と表示に使う金額の単位を選べます。保存されている金額（内部は千円）は変わらず、入力・表示のときだけ換算します（例：1,000千円 → 1,000,000円）。百万円は小数第1位まで表示します。' }));
  for (const x of UNIT_SCOPES) {
    panel.append(el('label', { className: 'field unit-field', for: `unit-${x.id}` }, [
      el('span', { className: 'unit-field-name', text: x.name }),
      unitSelect(x.id, x.name),
      el('span', { className: 'note unit-field-note', text: x.note }),
    ]));
  }
  const all = el('div', { className: 'actions' }, AMOUNT_UNITS.map((u) => {
    const b = el('button', { type: 'button', className: 'btn', text: `すべて${u.name}` });
    b.addEventListener('click', () => changeSettings(updateSettings(state.data, { units: setUnit(settings(), 'all', u.id).units })));
    return b;
  }));
  panel.append(el('h3', { className: 'sub-title', text: 'まとめて変更' }), all);
}

export function renderAccountsPage(section, panel) {
  panel.append(el('p', { className: 'note', text: '↑↓で並び替え、名称を書き換えると入力画面の表示名が変わります（空欄にすると標準名に戻ります）。計算に使う標準科目は削除できないため、使わない科目は「表示」を外してください（入力済みの値は計算に使われます）。' }));
  panel.append(el('p', { className: 'note', text: `「＋内訳」で科目の内訳を追加できます。内訳に金額を入れた期は、親科目が内訳の合計で自動計算されます。親科目に入力済みの金額は「${OTHER_DETAIL_LABEL}」の内訳に移すため、合計は変わりません。` }));
  const tree = accountTree(settings(), section);
  const list = el('div', { className: 'acc-list' });
  const full = settings().accounts.custom.length >= MAX_CUSTOM_ACCOUNTS;
  tree.forEach((a, i) => {
    const name = el('input', { type: 'text', autocomplete: 'off', placeholder: a.standardLabel, 'aria-label': `${a.standardLabel}の表示名` });
    name.value = a.renamed ? a.label : '';
    name.addEventListener('change', () => changeSettings(updateSettings(state.data, { accounts: renameAccount(settings(), a.key, name.value.trim()).accounts })));
    const card = el('div', { className: `acc-item${a.hidden ? ' is-hidden' : ''}`, 'data-key': a.key }, [
      el('div', { className: 'acc-row' }, [
        name,
        smallBtn('↑', `${a.label}を上へ`, () => changeSettings(updateSettings(state.data, { accounts: moveAccount(settings(), a.key, -1).accounts })), i === 0),
        smallBtn('↓', `${a.label}を下へ`, () => changeSettings(updateSettings(state.data, { accounts: moveAccount(settings(), a.key, 1).accounts })), i === tree.length - 1),
      ]),
      el('div', { className: 'acc-meta' }, [
        el('span', { className: 'acc-std', text: a.renamed ? `標準名：${a.standardLabel}` : '標準科目' }),
        toggle('表示', !a.hidden, (on) => changeSettings(updateSettings(state.data, { accounts: setAccountHidden(settings(), a.key, !on).accounts }))),
      ]),
    ]);
    a.children.forEach((c, j) => {
      const cn = el('input', { type: 'text', autocomplete: 'off', placeholder: '内訳の名称', 'aria-label': `${a.label}の内訳の名称`, 'data-child': c.key });
      cn.value = settings().accounts.custom.find((x) => x.key === c.key)?.label ?? '';
      cn.addEventListener('change', () => changeSettings(updateSettings(state.data, { accounts: renameAccount(settings(), c.key, cn.value.trim()).accounts })));
      const del = el('button', { type: 'button', className: 'btn btn-danger btn-small', text: '削除' });
      del.addEventListener('click', () => {
        if (!window.confirm(`内訳「${c.label}」を削除します。全期の入力値も削除され、${a.label}は残りの内訳の合計で再計算されます。よろしいですか？`)) return;
        changeSettings(removeCustomAccount(state.data, c.key));
        showToast('内訳を削除しました');
      });
      card.append(el('div', { className: 'acc-row acc-child' }, [
        cn,
        smallBtn('↑', `${c.label}を上へ`, () => changeSettings(updateSettings(state.data, { accounts: moveAccount(settings(), c.key, -1).accounts })), j === 0),
        smallBtn('↓', `${c.label}を下へ`, () => changeSettings(updateSettings(state.data, { accounts: moveAccount(settings(), c.key, 1).accounts })), j === a.children.length - 1),
        del,
      ]));
    });
    const add = el('button', { type: 'button', className: 'btn btn-small acc-add', text: `＋ ${a.label}の内訳` });
    add.disabled = full;
    add.addEventListener('click', () => {
      const moved = !a.children.length && state.data.periods.some((p) => isNum(p[section][a.key]));
      const { data, key } = addCustomAccount(state.data, a.key, '');
      if (!key) return;
      changeSettings(data);
      if (moved) showToast(`入力済みの金額は内訳「${OTHER_DETAIL_LABEL}」に移しました`);
      $('settingsBody').querySelector(`[data-child="${key}"]`)?.focus();
    });
    card.append(add);
    list.append(card);
  });
  panel.append(list);
  if (full) panel.append(el('p', { className: 'note', text: `内訳は全体で${MAX_CUSTOM_ACCOUNTS}件までです。` }));
  const reset = el('button', { type: 'button', className: 'btn', text: '名称・並び・表示を初期状態に戻す' });
  reset.addEventListener('click', () => {
    if (!window.confirm('この表の科目の名称・並び順・表示を初期状態に戻します（内訳と入力値はそのまま）。よろしいですか？')) return;
    changeSettings(updateSettings(state.data, { accounts: { ...settings().accounts, [section]: createDefaultSettings().accounts[section] } }));
  });
  panel.append(el('div', { className: 'actions' }, [reset]));
}

export function renderIndicatorsPage(panel) {
  panel.append(el('p', { className: 'note', text: '「表示」を外した指標は、入力タブの分析結果・比較表・比較表CSV・結果テキストに表示しません（計算はされています）。↑↓で区分内の並び順を変えられます。印刷用レポートは常に主要指標を載せます。' }));
  const all = indicatorList(settings(), true);
  for (const cat of CATEGORIES) {
    const inds = all.filter((i) => i.category === cat.id);
    const list = el('div', { className: 'acc-list' });
    inds.forEach((ind, i) => {
      list.append(el('div', { className: `acc-item${ind.hidden ? ' is-hidden' : ''}` }, [
        el('div', { className: 'acc-row' }, [
          el('span', { className: 'ind-name', text: ind.name }),
          smallBtn('↑', `${ind.name}を上へ`, () => changeSettings(updateSettings(state.data, { indicators: moveIndicator(settings(), ind.id, -1).indicators })), i === 0),
          smallBtn('↓', `${ind.name}を下へ`, () => changeSettings(updateSettings(state.data, { indicators: moveIndicator(settings(), ind.id, 1).indicators })), i === inds.length - 1),
        ]),
        el('div', { className: 'acc-meta' }, [
          el('span', { className: 'acc-std', text: formulaText(ind, days()) }),
          toggle('表示', !ind.hidden, (on) => changeSettings(updateSettings(state.data, { indicators: setIndicatorHidden(settings(), ind.id, !on).indicators }))),
        ]),
      ]));
    });
    panel.append(el('h3', { className: 'sub-title', text: cat.name }), list);
  }
}

export function renderAnalysisPage(panel) {
  const an = settings().analysis;
  panel.append(
    el('h3', { className: 'sub-title', text: '回転日数の1年の日数' }),
    el('p', { className: 'note', text: '売上債権・棚卸資産・仕入債務の回転日数とCCCの計算に使います。' }),
    radioGroup('days', [
      { value: 365, label: '365日', note: '一般的な計算' },
      { value: 360, label: '360日', note: '金融機関などで使われる簡便法' },
    ], an.daysInYear, (v) => changeSettings(updateSettings(state.data, { analysis: { ...settings().analysis, daysInYear: v } }))),
    el('h3', { className: 'sub-title', text: '比較タブの計算基準（初期値）' }),
    el('p', { className: 'note', text: 'アプリを開いたときの比較タブの基準です。比較タブで一時的に切り替えることもできます。' }),
    radioGroup('basis', [
      { value: 'end', label: '期末残高' },
      { value: 'average', label: '平均残高', note: 'ROA・ROE・回転日数・CCC を (前期末＋当期末)÷2 で計算' },
    ], an.defaultBasis, (v) => {
      state.basis = v;
      changeSettings(updateSettings(state.data, { analysis: { ...settings().analysis, defaultBasis: v } }));
    }),
  );
}

export function digitSelect(label, key, unitLabel) {
  const [min, max] = DIGIT_LIMITS[key];
  const select = el('select', { 'aria-label': label });
  for (let d = min; d <= max; d += 1) {
    const o = el('option', { value: String(d), text: `${d}桁` });
    if (d === settings().digits[key]) o.selected = true;
    select.append(o);
  }
  select.addEventListener('change', () => changeSettings(updateSettings(state.data, { digits: { ...settings().digits, [key]: Number(select.value) } })));
  const sample = { pct: 0.123456, days: 45.6789, times: 1.23456 }[key];
  const unit = { pct: '%', days: '日', times: '倍' }[key];
  return el('label', { className: 'field digit-field' }, [
    el('span', { className: 'field-label', text: `${label}（例：${fv({ value: sample, status: 'ok' }, unit)}）` }),
    select,
    el('span', { className: 'note', text: unitLabel }),
  ]);
}

export function renderDigitsPage(panel) {
  panel.append(
    el('p', { className: 'note', text: '小数点以下の表示桁数です。計算は丸めずに行い、表示のときだけ四捨五入します。' }),
    digitSelect('%の指標', 'pct', '利益率・ROE・自己資本比率など（前期比のpt・増減率も同じ桁数）'),
    digitSelect('日数の指標', 'days', '回転日数・CCC'),
    digitSelect('倍・回の指標', 'times', 'D/Eレシオ・ICR・総資産回転率など'),
  );
}

export function renderCategoriesPage(panel) {
  panel.append(el('p', { className: 'note', text: '正常化EBITDAの調整区分の表示名を変更できます（空欄にすると元の名称に戻ります）。区分の追加・削除はできません。該当しない調整は「その他」を使ってください。' }));
  for (const c of ADJUSTMENT_CATEGORIES) {
    const input = el('input', { type: 'text', autocomplete: 'off', placeholder: c.name, 'aria-label': `${c.name}の表示名` });
    input.value = settings().adjustmentCategoryNames[c.id] ?? '';
    input.addEventListener('change', () => changeSettings(updateSettings(state.data, { adjustmentCategoryNames: renameCategory(settings(), c.id, input.value.trim()).adjustmentCategoryNames })));
    panel.append(el('label', { className: 'field' }, [el('span', { className: 'field-label', text: `標準名：${c.name}` }), input]));
  }
}

export function renderDataPage(panel) {
  const select = el('select', { 'aria-label': 'バックアップの案内' });
  for (const d of BACKUP_REMINDER_CHOICES) {
    const o = el('option', { value: String(d), text: d ? `${d}日ごと` : '案内しない' });
    if (d === settings().backupReminderDays) o.selected = true;
    select.append(o);
  }
  select.addEventListener('change', () => changeSettings(updateSettings(state.data, { backupReminderDays: Number(select.value) })));
  const last = getLastBackupAt();
  const btn = (text, cls, fn) => {
    const b = el('button', { type: 'button', className: `btn ${cls}`, text });
    b.addEventListener('click', fn);
    return b;
  };
  panel.append(
    el('label', { className: 'field' }, [el('span', { className: 'field-label', text: 'バックアップの案内' }), select]),
    el('p', { className: 'note', text: `最終バックアップ：${last ? formatDateTime(last) : '未実施'}。前回のバックアップから設定した日数がたつと、入力タブに案内を表示します。` }),
    el('div', { className: 'actions' }, [
      btn('この会社のバックアップ', '', async () => { await onExport('company'); renderSettings(); }),
      btn('全社のバックアップ', '', async () => { await onExport('all'); renderSettings(); }),
      btn('バックアップから復元', '', onImportClick),
    ]),
    ...undoSection(),
    el('h3', { className: 'sub-title', text: '初期化' }),
    el('div', { className: 'actions' }, [
      btn('設定を初期値に戻す', '', onResetSettings),
      btn('すべてのデータを削除', 'btn-danger', () => { onDeleteAll(); renderSettings(); }),
    ]),
    el('p', { className: 'note', text: '「設定を初期値に戻す」は入力した金額を残します（内訳科目は削除し、親科目は内訳の合計のまま入力欄に戻ります）。' }),
  );
}

export function undoSection() {
  const u = loadUndo();
  if (!u) return [];
  const b = el('button', { type: 'button', className: 'btn', text: `「${u.label}」の前の状態に戻す` });
  b.addEventListener('click', () => {
    if (!window.confirm(`「${u.label}」の前の状態${u.at ? `（${formatDateTime(u.at)}）` : ''}に戻します。いまの入力内容は置き換わります。よろしいですか？`)) return;
    onUndo();
    renderSettings();
  });
  return [
    el('h3', { className: 'sub-title', text: '元に戻す' }),
    el('p', { className: 'note', text: '直前の「クリア」「期の削除」「バックアップからの復元」「サンプルデータの読込」「会社の削除」の前の状態（全社分）を1つだけ、この端末内に退避しています。' }),
    el('div', { className: 'actions' }, [b]),
  ];
}

export function onResetSettings() {
  if (!window.confirm('すべての設定（表示単位・科目・指標・桁数など）を初期値に戻します。内訳科目は削除されます（親科目の金額は残ります）。よろしいですか？')) return;
  // 内訳の値だけを消し、親科目は現在の金額（内訳の合計）のまま残す
  const periods = state.data.periods.map((p) => ({ ...p, details: {} }));
  state.basis = 'end';
  changeSettings({ ...state.data, periods, settings: createDefaultSettings() });
  showToast('設定を初期値に戻しました');
}

export function renderAboutPage(panel) {
  const persisted = el('dd', { text: '確認中…' });
  isStoragePersisted().then((v) => { persisted.textContent = v === true ? '保護あり（自動削除されにくい）' : v === false ? '保護なし（空き容量不足などで消えることがあります）' : '確認できません'; });
  const check = el('button', { type: 'button', className: 'btn', text: '更新を確認' });
  const guide = el('button', { type: 'button', className: 'btn', text: '使い方ガイドを見る' });
  guide.addEventListener('click', () => openOnboarding(0));
  check.addEventListener('click', async () => {
    check.disabled = true;
    const r = await checkForUpdate();
    check.disabled = false;
    if (r === 'checked') showToast($('updateBar').hidden ? '確認しました（新しいバージョンがあれば画面下に表示されます）' : '新しいバージョンがあります。画面下の［更新］を押してください');
    else showToast('この環境では更新を確認できません');
  });
  panel.append(
    el('dl', { className: 'about-list' }, [
      el('dt', { text: 'アプリのバージョン' }), el('dd', { text: APP_VERSION }),
      el('dt', { text: 'データ形式' }), el('dd', { text: `version ${state.data.version}` }),
      el('dt', { text: '保存先' }), el('dd', { text: 'この端末のブラウザ内（外部には送信しません）' }),
      el('dt', { text: '保存データの保護' }), persisted,
    ]),
    el('div', { className: 'actions' }, [check, guide]),
    el('h3', { className: 'sub-title', text: '更新履歴' }),
    changelogList(CHANGELOG),
    el('h3', { className: 'sub-title', text: 'ご利用にあたって（免責事項）' }),
    el('ul', { className: 'legal-list' }, DISCLAIMER.map((t) => el('li', { text: t }))),
    el('h3', { className: 'sub-title', text: 'プライバシー' }),
    el('ul', { className: 'legal-list' }, PRIVACY.map((t) => el('li', { text: t }))),
    el('h3', { className: 'sub-title', text: '著作権・ライセンス' }),
    el('p', { className: 'note', text: COPYRIGHT }),
    el('ul', { className: 'legal-list' }, LICENSE_TEXT.map((t) => el('li', { text: t }))),
    el('h3', { className: 'sub-title', text: 'お問い合わせ' }),
    el('p', { className: 'note', text: CONTACT ?? '準備中です。' }),
  );
}

export function renderDisplayPage(panel) {
  panel.append(
    el('h3', { className: 'sub-title', text: '表示テーマ' }),
    radioGroup('theme', THEMES.map((t) => ({
      value: t.id, label: t.name,
      note: t.id === 'auto' ? 'iPhone の「ライト／ダーク」の設定に合わせて自動で切り替えます' : '',
    })), settings().theme, (v) => changeSettings(updateSettings(state.data, { theme: v }))),
    el('h3', { className: 'sub-title', text: 'マイナスの表示' }),
    el('p', { className: 'note', text: '画面・レポートの表示に使います。入力欄でも△で表示し、△・▲・− のどれで入力しても負の数として扱います。CSV は数値（-1000）のまま出力します。' }),
    radioGroup('negative', NEGATIVE_STYLES.map((t) => ({ value: t.id, label: t.name })), settings().negativeStyle,
      (v) => changeSettings(updateSettings(state.data, { negativeStyle: v }))),
  );
}


export function saveEvaluation(next) {
  changeSettings(updateSettings(state.data, { evaluation: next }));
}

const JFC_UPDATE_NOTICE = '最新の公表から1年以上たっています。公庫から新しい調査が公表されている可能性があり、値が異なる場合があります。';

function formatIsoDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${y}年${m}月${d}日`;
}

export function criterionDetails(c) {
  const lines = [el('p', { text: c.summary }), el('p', { className: 'note', text: `出典：${c.source}` })];
  if (c.id === 'standard') {
    lines.push(el('p', { className: 'note', text: '業種による差は考慮しません。回転日数・CCC・金額の指標は評価しません。' }));
  }
  if (c.id === 'furutado') {
    lines.push(el('p', { className: 'note', text: '自己資本比率・ROA・流動比率・当座比率・総資産回転率を古田土会計の目安に置き換え、それ以外の指標と、示されていない側の境界は標準の値を使います。指標ごとの目安で、どれが標準から引き継いだ値か確認できます。' }));
  }
  if (c.id === 'jfc') {
    lines.push(el('p', { className: 'note', text: `小企業（原則従業者20人未満）を対象とした調査の「業種全体」の表を使います。${jfcYearsSummary()}（${formatIsoDate(JFC_DATA_CHECKED_AT)}に公庫ウェブサイトで確認）。調査の対象は9指標（売上総利益率・営業利益率・経常利益率・ROA・総資産回転率・流動比率・当座比率・固定長期適合率・自己資本比率）で、それ以外の指標は標準で評価します。規模の大きい会社では参考程度にしてください。` }));
    if (jfcUpdateDue()) lines.push(el('p', { className: 'warning', text: JFC_UPDATE_NOTICE }));
    const ul = el('ul', { className: 'note source-list' });
    for (const x of JFC_INDUSTRIES) ul.append(el('li', { text: `${x.name}：${x.year}調査・${x.count.toLocaleString('ja-JP')}社（うち黒字かつ自己資本プラス${x.goodCount.toLocaleString('ja-JP')}社）・公庫ウェブサイト ${x.file}` }));
    lines.push(ul);
  }
  if (c.id === 'tkc') {
    lines.push(el('p', { className: 'note', text: c.notice }));
    lines.push(el('p', { className: 'note', text: '入力した値はこの端末にだけ保存され、JSONバックアップに含まれます。未入力の指標は標準の基準で評価し、指標の詳しい説明にその旨を表示します。' }));
  }
  return el('details', { className: 'criterion-detail' }, [el('summary', { text: `${c.name}について詳しく` }), ...lines]);
}

export function boundInput(label, value, unit, onSave) {
  const input = el('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-label': label, value: isNum(value) ? String(value) : '' });
  input.addEventListener('change', () => onSave(parseAmount(input.value)));
  return el('label', { className: 'bound-field' }, [el('span', { className: 'bound-label', text: label }), input, el('span', { className: 'bound-unit', text: unit })]);
}

export function renderEvaluationPage(panel) {
  const ev = evaluation();
  panel.append(
    el('p', { className: 'note', text: '分析結果・比較表・レポートの指標に「良好」「注意」のバッジを付けます。どちらでもない場合はバッジを付けません。判定は丸める前の値で行い、境界の値は良好側に含めます。バッジは目安との比較で、業種・規模・事業モデルによって適切な水準は異なります。' }),
    toggle('評価バッジを表示する', ev.enabled, (v) => saveEvaluation({ ...ev, enabled: v })),
    el('h3', { className: 'sub-title', text: '評価基準' }),
    radioGroup('criterion', CRITERIA.map((c) => ({ value: c.id, label: c.name, note: c.summary })), ev.criterion, (v) => saveEvaluation(setCriterion(ev, v))),
  );
  if (ev.criterion === 'jfc') {
    const select = el('select', { id: 'jfcIndustry', 'aria-label': '業種' });
    for (const x of JFC_INDUSTRIES) {
      const o = el('option', { value: x.id, text: `${x.name}（${jfcSurveyLabel(x)}）` });
      if (x.id === ev.jfcIndustry) o.selected = true;
      select.append(o);
    }
    select.addEventListener('change', () => saveEvaluation({ ...ev, jfcIndustry: select.value }));
    const ind = JFC_INDUSTRIES.find((x) => x.id === ev.jfcIndustry) ?? JFC_INDUSTRIES[1];
    panel.append(
      el('label', { className: 'field', for: 'jfcIndustry' }, [el('span', { className: 'field-label', text: '業種（公庫）' }), select]),
      el('p', { className: 'note', id: 'jfcSurvey', text: `使用データ：日本政策金融公庫「小企業の経営指標調査」${jfcSurveyLabel(ind)}・${ind.name}（${ind.count.toLocaleString('ja-JP')}社）。${formatIsoDate(JFC_DATA_CHECKED_AT)}時点の最新の調査です。` }),
      ...(jfcUpdateDue() ? [el('p', { className: 'warning', text: JFC_UPDATE_NOTICE })] : []),
    );
  }
  if (ev.criterion === 'tkc') {
    const input = el('input', { type: 'text', id: 'tkcIndustry', maxlength: '40', autocomplete: 'off', placeholder: '例：金属製品製造業', value: ev.tkc.industry });
    input.addEventListener('change', () => saveEvaluation({ ...ev, tkc: { ...ev.tkc, industry: input.value.trim() } }));
    panel.append(
      el('label', { className: 'field', for: 'tkcIndustry' }, [el('span', { className: 'field-label', text: '業種名（TKC）' }), input]),
      el('p', { className: 'note notice', text: CRITERIA.find((c) => c.id === 'tkc').notice }),
    );
  }
  panel.append(el('h3', { className: 'sub-title', text: '基準の説明' }), ...CRITERIA.map(criterionDetails));

  // 指標ごとの目安・変更・オン/オフ
  const tkc = ev.criterion === 'tkc';
  panel.append(
    el('h3', { className: 'sub-title', text: `指標ごとの目安（${criterionLabel(ev)}）` }),
    el('p', { className: 'note', text: tkc
      ? '「優良企業平均」以上で良好、「黒字企業平均」未満で注意とします（低いほど良い指標は逆）。空欄の指標は標準の基準で評価します。'
      : '境界の値を書き換えると、この基準の値として保存されます（空欄にするとその側は判定しません）。変更は基準ごとに保存され、「元に戻す」で基準の値に戻ります。' }),
  );
  const list = el('div', { className: 'eval-list' });
  for (const t of BADGE_TARGETS) {
    const g = guideFor(t.id, ev);
    const rule = ruleFor(t.id, ev);
    const hi = t.dir === 'high';
    const row = el('div', { className: 'eval-row' }, [
      el('div', { className: 'eval-head' }, [
        el('span', { className: 'eval-name', text: t.name }),
        toggle('表示', !ev.disabled.includes(t.id), (v) => saveEvaluation(setBadgeDisabled(ev, t.id, !v))),
      ]),
      el('p', { className: 'eval-bounds', text: `${g.text}（${g.source}）` }),
      ...g.notes.filter((n) => !n.startsWith('この指標のバッジは')).map((n) => el('p', { className: 'note eval-note', text: n })),
    ]);
    if (tkc && TKC_TARGETS.includes(t.id)) {
      const v = ev.tkc.values[t.id] ?? {};
      row.append(el('div', { className: 'bound-fields' }, [
        boundInput('優良企業平均', v.good, t.unit, (x) => saveEvaluation(setTkcValue(ev, t.id, { ...v, good: x }))),
        boundInput('黒字企業平均', v.caution, t.unit, (x) => saveEvaluation(setTkcValue(ev, t.id, { ...v, caution: x }))),
      ]));
    } else if (!tkc) {
      const bounds = { good: rule.good, caution: rule.caution };
      const fields = el('div', { className: 'bound-fields' }, [
        boundInput(`良好（${hi ? '以上' : '以下'}）`, rule.good, t.unit, (x) => saveEvaluation(setOverride(ev, t.id, { ...bounds, good: x }))),
        boundInput(`注意（${hi ? '未満' : '超'}）`, rule.caution, t.unit, (x) => saveEvaluation(setOverride(ev, t.id, { ...bounds, caution: x }))),
      ]);
      if (rule.modified) fields.append(smallBtn('元に戻す', `${t.name}の目安を元に戻す`, () => saveEvaluation(setOverride(ev, t.id, null))));
      const edit = el('details', { className: 'bound-edit' }, [el('summary', { text: rule.modified ? '目安を変更（変更あり）' : '目安を変更' }), fields]);
      edit.open = rule.modified;
      row.append(edit);
    }
    list.append(row);
  }
  panel.append(list);
  if (isModified(ev)) {
    const reset = el('button', { type: 'button', className: 'btn', text: `${CRITERIA.find((c) => c.id === ev.criterion).name}の変更をすべて元に戻す` });
    reset.addEventListener('click', () => {
      if (window.confirm('この基準で変更した目安をすべて元の値に戻します。よろしいですか？')) saveEvaluation(resetOverrides(ev));
    });
    panel.append(el('div', { className: 'actions' }, [reset]));
  }
}

export function renderGlossaryPage(panel) {
  panel.append(el('p', { className: 'note', text: `計算式は期末残高ベースです（比較タブの「平均残高」では★の指標のBS項目を前期末と当期末の平均で計算します）。回転日数は1年を${days()}日として計算します。評価の目安は現在の評価基準（${criterionLabel(evaluation())}）です。` }));
  for (const g of helpCatalog({ days: days(), evaluation: evaluation() })) {
    panel.append(el('h3', { className: 'sub-title', text: g.name }));
    for (const h of g.items) {
      panel.append(el('details', { className: 'glossary-item' }, [
        el('summary', {}, [el('span', { className: 'glossary-name', text: h.name }), el('span', { className: 'glossary-formula', text: h.formula })]),
        helpBody(h),
      ]));
    }
  }
  panel.append(
    el('h3', { className: 'sub-title', text: '計算できない場合の表示' }),
    el('ul', { className: 'note' }, NA_RULES.map((t) => el('li', { text: t }))),
  );
}

export const SETTINGS_RENDERERS = {
  lock: (panel) => renderLockPage(panel, renderSettings),
  companies: renderCompaniesPage,
  glossary: renderGlossaryPage,
  evaluation: renderEvaluationPage,
  display: renderDisplayPage,
  unit: renderUnitPage,
  pl: (panel) => renderAccountsPage('pl', panel),
  bs: (panel) => renderAccountsPage('bs', panel),
  indicators: renderIndicatorsPage,
  analysis: renderAnalysisPage,
  digits: renderDigitsPage,
  categories: renderCategoriesPage,
  data: renderDataPage,
  about: renderAboutPage,
};
