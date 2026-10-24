// 画面の切り替え・全体の再描画・起動
import { CASH_LIKE_EXAMPLES, DEBT_LIKE_EXAMPLES } from '../calc.js';
import { LAST_VERSION_KEY } from '../changelog.js';
import { buildBridgeCsv, buildComparisonCsv, buildNetDebtCsv } from '../csv.js';
import { APP_VERSION, registerServiceWorker, requestPersistentStorage } from '../pwa.js';
import { hasAnyData } from '../store.js';
import { loadWorkspace } from '../workspace.js';
import { renderCompanyBar } from './companies.js';
import { onAddAdjustment, renderAdjustmentSummary } from './adjustments.js';
import { onClear, onCopy, onExport, onImportClick, onImportFile, onLoadSample, renderBackupStatus } from './backup.js';
import { renderCompare } from './compare.js';
import { $, currentPeriod, el, hasPendingSave, saveNow, scheduleSave, setWorkspace, settings, state } from './core.js';
import { renderDiagrams } from './diagram.js';
import { closeModal, openOnboarding, readOnboarded, showChangesIfUpdated } from './dialogs.js';
import {
  attachLiveGrouping, onCopyPrevious, onMovePeriod, onRemovePeriod, periodName, renderForm, renderGlobalWarnings, renderInputResults, renderInputWarnings,
  renderMissingFields, renderSummary,
} from './input.js';
import { renderSectionNav, updateNavHeight } from './nav.js';
import { initKeyboardNavigation } from './a11y.js';
import { initLock } from './lock.js';
import { renderCashFlowInput } from './cashflow.js';
import { LINE_LISTS, onAddLineItem, renderNetDebtSummary } from './netdebt.js';
import { exportCsv, exportXlsx, onDeleteAll, renderReport, renderReportOptions } from './report.js';
import { renderSettings, toggle } from './settings-view.js';
import { onCsvFile, onCsvImportClick } from './import-view.js';


export function setView(view) {
  state.view = view;
  document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.view === view)));
  $('view-input').hidden = view !== 'input';
  $('view-compare').hidden = view !== 'compare';
  $('view-settings').hidden = view !== 'settings';
  $('view-diagram').hidden = view !== 'diagram';
  $('companyBar').hidden = view === 'settings' || view === 'report';
  const reporting = view === 'report';
  document.body.classList.toggle('reporting', reporting);
  document.querySelector('.app-header').hidden = reporting;
  document.querySelector('.sticky-nav').hidden = reporting;
  document.querySelector('.app-main').hidden = reporting;
  if (!reporting) renderSectionNav(view);
  $('view-report').hidden = !reporting;
  if (view === 'compare') renderCompare();
  if (view === 'settings') renderSettings();
  if (view === 'diagram') renderDiagrams();
  if (reporting) {
    renderReportOptions();
    renderReport();
  }
  window.scrollTo(0, 0);
}

export function update() {
  renderSummary();
  renderMissingFields();
  renderInputWarnings();
  renderInputResults();
  renderAdjustmentSummary();
  renderNetDebtSummary();
  renderCashFlowInput();
  renderBackupStatus();
  if (state.view === 'compare') renderCompare();
  if (state.view === 'diagram') renderDiagrams();
  scheduleSave();
}

export function hasAnyInput() {
  return hasAnyData(state.data);
}

export function init() {
  initLock();
  window.__fatalBackup = () => { onExport('all', { ask: false }).catch(() => window.__saveRawBackup?.()); };
  const { workspace, error } = loadWorkspace();
  setWorkspace(workspace);
  state.storageError = error;
  state.basis = state.data.settings.analysis.defaultBasis;
  renderCompanyBar();
  renderForm();
  renderGlobalWarnings();
  renderSummary();
  renderInputWarnings();
  renderInputResults();
  renderBackupStatus();

  $('companyName').addEventListener('input', (e) => {
    state.data.companyName = e.target.value;
    renderCompanyBar();
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
  $('btnCopyPrev').addEventListener('click', onCopyPrevious);
  attachLiveGrouping();
  initKeyboardNavigation();
  $('btnCsvImport').addEventListener('click', onCsvImportClick);
  $('csvFile').addEventListener('change', onCsvFile);
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
  $('btnExport').addEventListener('click', () => onExport('company'));
  $('btnExportAll').addEventListener('click', () => onExport('all'));
  $('btnDeleteAll').addEventListener('click', onDeleteAll);
  $('btnCsvCompare').addEventListener('click', () => exportCsv('comparison', () => buildComparisonCsv(state.data, state.basis)));
  $('btnCsvBridge').addEventListener('click', () => exportCsv('bridge', () => buildBridgeCsv(state.data)));
  $('btnCsvNetDebt').addEventListener('click', () => exportCsv('netDebt', () => buildNetDebtCsv(state.data)));
  $('btnXlsx').addEventListener('click', exportXlsx);
  $('btnReport').addEventListener('click', () => setView('report'));
  $('btnReportBack').addEventListener('click', () => setView('compare'));
  $('btnPrint').addEventListener('click', () => window.print());
  $('btnImport').addEventListener('click', onImportClick);
  $('importFile').addEventListener('change', onImportFile);
  $('btnStorageBackup').addEventListener('click', () => onExport('all'));
  $('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

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
  window.addEventListener('pagehide', () => { if (hasPendingSave()) saveNow(); });

  // 初めて使う人（データなし・ガイド未表示）には使い方ガイドを出す
  if (!readOnboarded() && !hasAnyData(state.data)) {
    openOnboarding(0);
    try { localStorage.setItem(LAST_VERSION_KEY, APP_VERSION); } catch { /* 記録できなくても使える */ }
  } else showChangesIfUpdated();
}
