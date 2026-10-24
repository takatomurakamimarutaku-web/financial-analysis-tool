// パスコードロックの画面：起動時・ほかのアプリから戻ったときにロックし、パスコードで解除する。
// 画面を隠すのは html の .app-locked（index.html の先頭で、描画前に付ける）。
import { deleteAllData } from '../store.js';
import {
  LOCK_NOTICE, PASSCODE_MAX, PASSCODE_MIN, RELOCK_OPTIONS, checkPasscode, clearLock, createLock, loadLock, lockoutMs, saveLock,
  shouldRelock, verifyPasscode, withRelockMinutes,
} from '../lock.js';
import { $, el, showToast } from './core.js';

let failures = 0;
let waitUntil = 0;
let hiddenAt = null;
let waitTimer = null;

export function isLocked() {
  return document.documentElement.classList.contains('app-locked');
}

export function lockNow() {
  const { record } = loadLock();
  if (!record) return false;
  document.activeElement?.blur?.();
  document.documentElement.classList.add('app-locked');
  $('lockInput').value = '';
  $('lockError').textContent = '';
  setTimeout(() => $('lockInput').focus(), 0);
  return true;
}

function unlock() {
  document.documentElement.classList.remove('app-locked');
  failures = 0;
  waitUntil = 0;
  $('lockInput').value = '';
  $('lockError').textContent = '';
}

function showWait() {
  clearTimeout(waitTimer);
  const left = Math.ceil((waitUntil - Date.now()) / 1000);
  if (left <= 0) {
    $('lockError').textContent = '';
    $('lockSubmit').disabled = false;
    return;
  }
  $('lockSubmit').disabled = true;
  $('lockError').textContent = `続けて間違えたため、${left}秒後に入力できます`;
  waitTimer = setTimeout(showWait, 1000);
}

async function onSubmit(e) {
  e.preventDefault();
  if (Date.now() < waitUntil) return;
  const { record } = loadLock();
  if (!record) {
    unlock();
    return;
  }
  const code = $('lockInput').value;
  $('lockSubmit').disabled = true;
  const ok = await verifyPasscode(record, code).catch(() => false);
  $('lockSubmit').disabled = false;
  if (ok) {
    unlock();
    return;
  }
  failures += 1;
  $('lockInput').value = '';
  $('lockInput').focus();
  const wait = lockoutMs(failures);
  if (wait) {
    waitUntil = Date.now() + wait;
    showWait();
  } else {
    $('lockError').textContent = 'パスコードが違います';
  }
}

function onForgot() {
  if (!window.confirm('パスコードは確認・再発行できません。\n\nこの端末のすべてのデータ（全社の入力・設定）を削除して、ロックを解除します。バックアップのファイルがあれば、あとで「バックアップから復元」で戻せます。\n\n削除してよろしいですか？')) return;
  deleteAllData();
  clearLock();
  window.location.reload();
}

// 起動時に呼ぶ。読めないロックの記録は消してロックしない（解除できなくなるのを防ぐ）
export function initLock() {
  const { record, invalid } = loadLock();
  if (invalid) clearLock();
  if (!record) document.documentElement.classList.remove('app-locked');
  else lockNow();
  $('lockForm').addEventListener('submit', onSubmit);
  $('lockForgot').addEventListener('click', onForgot);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      return;
    }
    const { record: r } = loadLock();
    if (r && !isLocked() && shouldRelock(hiddenAt, Date.now(), r.relockMinutes)) lockNow();
    hiddenAt = null;
  });
}

// 設定 →「パスコードロック」の画面。rerender は設定画面の描き直し
export function renderLockPage(panel, rerender) {
  const { record } = loadLock();
  const error = el('p', { className: 'warning', role: 'alert' });
  error.hidden = true;
  const fail = (msg) => {
    error.textContent = msg;
    error.hidden = false;
  };
  const codeInput = (label, id) => {
    const input = el('input', { type: 'password', id, inputmode: 'numeric', pattern: '[0-9]*', maxlength: String(PASSCODE_MAX), autocomplete: 'off' });
    return { input, field: el('label', { className: 'field' }, [el('span', { className: 'field-label', text: label }), input]) };
  };
  const btn = (text, cls, fn) => {
    const b = el('button', { type: 'button', className: `btn ${cls}`, text });
    b.addEventListener('click', fn);
    return b;
  };
  panel.append(el('p', { className: 'note', text: LOCK_NOTICE }));
  if (!record) {
    const a = codeInput(`パスコード（数字${PASSCODE_MIN}〜${PASSCODE_MAX}桁）`, 'lockNew');
    const b = codeInput('パスコード（確認）', 'lockNew2');
    panel.append(
      el('p', { text: '状態：オフ' }),
      a.field, b.field, error,
      el('div', { className: 'actions' }, [btn('ロックを設定', 'btn-primary', async () => {
        const msg = checkPasscode(a.input.value, b.input.value);
        if (msg) return fail(msg);
        const rec = await createLock(a.input.value);
        if (!saveLock(rec)) return fail('保存できませんでした（端末の保存領域をご確認ください）');
        showToast('パスコードロックを設定しました');
        rerender();
      })]),
      el('p', { className: 'note', text: 'パスコードを忘れると、この端末のデータを削除しない限り解除できません。先に「パスワード付きのバックアップ」を保存しておくと安心です。' }),
    );
    return;
  }
  const select = el('select', { 'aria-label': 'ロックするタイミング', id: 'lockRelock' });
  for (const o of RELOCK_OPTIONS) {
    const opt = el('option', { value: String(o.value), text: o.label });
    if (o.value === record.relockMinutes) opt.selected = true;
    select.append(opt);
  }
  select.addEventListener('change', () => {
    saveLock(withRelockMinutes(record, Number(select.value)));
    showToast('ロックするタイミングを変更しました');
  });
  const cur = codeInput('いまのパスコード', 'lockCurrent');
  const next = codeInput('新しいパスコード（変更するときだけ）', 'lockChange');
  const next2 = codeInput('新しいパスコード（確認）', 'lockChange2');
  const verifyCurrent = async () => {
    if (await verifyPasscode(record, cur.input.value)) return true;
    fail('いまのパスコードが違います');
    return false;
  };
  panel.append(
    el('p', { text: '状態：オン' }),
    el('label', { className: 'field' }, [el('span', { className: 'field-label', text: 'ロックするタイミング' }), select]),
    el('div', { className: 'actions' }, [btn('今すぐロック', '', () => lockNow())]),
    el('h3', { className: 'sub-title', text: 'パスコードの変更・ロックの解除' }),
    cur.field, next.field, next2.field, error,
    el('div', { className: 'actions' }, [
      btn('パスコードを変更', '', async () => {
        if (!(await verifyCurrent())) return;
        const msg = checkPasscode(next.input.value, next2.input.value);
        if (msg) return fail(msg);
        const rec = await createLock(next.input.value, { relockMinutes: loadLock().record?.relockMinutes });
        if (!saveLock(rec)) return fail('保存できませんでした');
        showToast('パスコードを変更しました');
        rerender();
      }),
      btn('ロックをオフにする', 'btn-danger', async () => {
        if (!(await verifyCurrent())) return;
        clearLock();
        showToast('パスコードロックをオフにしました');
        rerender();
      }),
    ]),
  );
}
