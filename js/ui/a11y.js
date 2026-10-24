// キーボード操作：タブ（role="tab"）とボタン型の選択肢（role="radio"）を矢印キーで切り替える。
// フォーカスは選択中の1つだけに入る（ほかは tabindex="-1"。Tab キーでグループ全体を1回で通過する）。

const GROUPS = [
  { group: '[role="tablist"]', item: '[role="tab"]', selected: 'aria-selected' },
  { group: '[role="radiogroup"]', item: 'button[role="radio"]', selected: 'aria-checked' },
];

function itemsOf(groupEl, def) {
  return [...groupEl.querySelectorAll(def.item)].filter((n) => n.closest(def.group) === groupEl && !n.disabled && !n.hidden);
}

// 選択中の項目だけ tabindex="0"、ほかは "-1"。選択中がなければ先頭を "0"
export function syncRoving(root = document) {
  for (const def of GROUPS) {
    root.querySelectorAll(def.group).forEach((g) => {
      const items = itemsOf(g, def);
      if (!items.length) return;
      const current = items.find((n) => n.getAttribute(def.selected) === 'true') ?? items[0];
      for (const n of items) n.tabIndex = n === current ? 0 : -1;
    });
  }
}

function onKeydown(e) {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  for (const def of GROUPS) {
    const item = e.target.closest?.(def.item);
    const g = item?.closest(def.group);
    if (!item || !g) continue;
    const items = itemsOf(g, def);
    const i = items.indexOf(item);
    if (i < 0) return;
    let next = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = items[(i + 1) % items.length];
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = items[(i - 1 + items.length) % items.length];
    else if (e.key === 'Home') next = items[0];
    else if (e.key === 'End') next = items[items.length - 1];
    if (!next) return;
    e.preventDefault();
    // 選ぶと画面が描き直されることがあるため、選んだあとに同じ位置の項目へフォーカスを戻す
    const index = items.indexOf(next);
    next.click();
    const after = itemsOf(g, def);
    (after[index] ?? next).focus();
    syncRoving();
    return;
  }
}

export function initKeyboardNavigation() {
  document.addEventListener('keydown', onKeydown);
  syncRoving();
  // 選択の変更や描き直しのたびに tabindex を合わせる
  const observer = new MutationObserver(() => syncRoving());
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-selected', 'aria-checked'] });
}
