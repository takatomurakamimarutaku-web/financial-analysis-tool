// 項目へのジャンプメニュー
import { $, el } from './core.js';


export const SECTION_NAV = {
  input: [
    ['sec-summary', 'サマリー'],
    ['sec-basic', '基本情報'],
    ['sec-pl', 'PL入力'],
    ['sec-bs', 'BS入力'],
    ['results', '分析結果'],
    ['sec-adj', '正常化EBITDA'],
    ['sec-nd', '運転資本・ネットデット'],
    ['sec-backup', 'バックアップ'],
  ],
  diagram: [
    ['sec-dg-period', '期'],
    ['sec-dg-radar', 'バランス'],
    ['sec-dg-pl', '損益'],
    ['sec-dg-bs', '財産と集め方'],
    ['sec-dg-ccc', 'お金の回収'],
    ['sec-dg-ebitda', '正常化EBITDA'],
    ['sec-dg-nd', '実質的な借入'],
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

export let sectionObserver = null;

export function updateNavHeight() {
  const nav = document.querySelector('.sticky-nav');
  if (nav) document.documentElement.style.setProperty('--nav-height', `${nav.offsetHeight + 8}px`);
}

export function setCurrentSection(id) {
  $('sectionNav').querySelectorAll('.section-link').forEach((b) => {
    const on = b.dataset.target === id;
    b.setAttribute('aria-current', String(on));
    if (on) b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
}

export function jumpTo(id) {
  const target = $(id);
  if (!target) return;
  if (target.tagName === 'DETAILS') target.open = true;
  updateNavHeight();
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  setCurrentSection(id);
}

export function renderSectionNav(view) {
  const nav = $('sectionNav');
  const items = SECTION_NAV[view] ?? [];
  nav.hidden = items.length === 0;
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
