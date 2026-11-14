// Window-menu controls shared by every screen: a pointer cursor on the selected item,
// arrow keys to move it, Enter/Space to choose, plus small cursor sounds.
// A menu is any element with class "menu" whose choices have class "mi".
// When several menus are visible, the one with the highest data-prio gets the keyboard.
(() => {
  'use strict';
  const visible = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const items = (menu) => [...menu.querySelectorAll('.mi')].filter((b) => !b.disabled && visible(b) && b.closest('.menu') === menu);
  const sfx = (name) => { try { if (window.FX && window.FX.sfx) window.FX.sfx(name); } catch { /* sound is optional */ } };

  function activeMenu() {
    const menus = [...document.querySelectorAll('.menu')].filter(visible);
    menus.sort((a, b) => (Number(b.dataset.prio) || 0) - (Number(a.dataset.prio) || 0));
    return menus[0] || null;
  }

  function select(menu, item, { scroll = true, sound = false } = {}) {
    if (!menu || !item) return;
    const prev = menu.querySelector('.mi.sel');
    if (prev === item) return;
    if (prev) prev.classList.remove('sel');
    item.classList.add('sel');
    menu.dataset.selIndex = String(items(menu).indexOf(item));
    if (scroll) item.scrollIntoView({ block: 'nearest' });
    if (sound) sfx('cursor');
    menu.dispatchEvent(new CustomEvent('menuselect', { detail: item }));
  }

  // Call after (re)building a menu: keeps the cursor where it was, or puts it on the first choice.
  function init(menu, keep = true) {
    if (!menu) return;
    const list = items(menu);
    if (!list.length) return;
    const i = keep ? Math.min(list.length - 1, Math.max(0, Number(menu.dataset.selIndex) || 0)) : 0;
    list.forEach((b) => b.classList.remove('sel'));
    list[i].classList.add('sel');
    menu.dataset.selIndex = String(i);
  }

  function move(delta) {
    const menu = activeMenu();
    if (!menu) return false;
    const list = items(menu);
    if (!list.length) return false;
    let i = list.indexOf(menu.querySelector('.mi.sel'));
    i = i < 0 ? 0 : (i + delta + list.length) % list.length;
    select(menu, list[i], { sound: true });
    return true;
  }

  const typing = () => {
    const a = document.activeElement;
    return a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable);
  };

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || typing()) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (move(e.key === 'ArrowDown' ? 1 : -1)) e.preventDefault();
    } else if (e.key === 'Enter' || e.key === ' ') {
      const a = document.activeElement;
      if (a && a.tagName === 'BUTTON' && !a.classList.contains('mi')) return; // a focused normal button handles itself
      const menu = activeMenu();
      const item = menu && menu.querySelector('.mi.sel');
      if (item && visible(item) && !item.disabled) { e.preventDefault(); item.click(); }
    }
  });

  // Mouse/touch: hovering moves the cursor; choosing plays a confirm sound.
  document.addEventListener('pointerover', (e) => {
    const item = e.target.closest && e.target.closest('.mi');
    if (!item || item.disabled) return;
    const menu = item.closest('.menu');
    if (menu) select(menu, item, { scroll: false, sound: e.pointerType === 'mouse' });
  });
  document.addEventListener('click', (e) => {
    const item = e.target.closest && e.target.closest('.mi');
    if (item && !item.disabled) sfx(item.classList.contains('back') ? 'back' : 'select');
  }, true);

  window.Menus = { init, select, activeMenu, items };
})();
