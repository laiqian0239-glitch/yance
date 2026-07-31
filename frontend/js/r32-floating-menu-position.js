(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.YanceFloatingMenuPosition = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  function clamp(value, minimum, maximum) {
    return Math.min(Math.max(Number(value) || 0, minimum), Math.max(minimum, maximum));
  }

  function calculate(input = {}) {
    const margin = Math.max(4, Number(input.margin || 8));
    const viewportWidth = Math.max(margin * 2 + 1, Number(input.viewportWidth || 0));
    const viewportHeight = Math.max(margin * 2 + 1, Number(input.viewportHeight || 0));
    const menuWidth = Math.min(Math.max(1, Number(input.menuWidth || 1)), viewportWidth - margin * 2);
    const requestedHeight = Math.max(1, Number(input.menuHeight || 1));
    const maxHeight = Math.max(1, viewportHeight - margin * 2);
    const menuHeight = Math.min(requestedHeight, maxHeight);
    const anchorX = Number(input.anchorX || 0);
    const anchorY = Number(input.anchorY || 0);
    const spaceBelow = viewportHeight - margin - anchorY;
    const spaceAbove = anchorY - margin;
    const preferAbove = input.preferAbove === true || (spaceBelow < menuHeight && spaceAbove > spaceBelow);
    const top = preferAbove
      ? clamp(anchorY - menuHeight, margin, viewportHeight - menuHeight - margin)
      : clamp(anchorY, margin, viewportHeight - menuHeight - margin);
    const left = clamp(anchorX, margin, viewportWidth - menuWidth - margin);
    return Object.freeze({ left, top, maxHeight, placement: preferAbove ? 'above' : 'below' });
  }

  function placeMenu(menu, event = {}, options = {}) {
    if (!menu) return null;
    const win = options.window || (typeof window !== 'undefined' ? window : null);
    const viewportWidth = Math.max(1, Number(options.viewportWidth || win?.innerWidth || 0));
    const viewportHeight = Math.max(1, Number(options.viewportHeight || win?.innerHeight || 0));
    const rect = menu.getBoundingClientRect?.() || {};
    const result = calculate({
      anchorX: Number(event.clientX ?? options.anchorX ?? 0),
      anchorY: Number(event.clientY ?? options.anchorY ?? 0),
      menuWidth: Number(rect.width || menu.offsetWidth || options.menuWidth || 1),
      menuHeight: Number(rect.height || menu.scrollHeight || options.menuHeight || 1),
      viewportWidth,
      viewportHeight,
      margin: options.margin,
      preferAbove: options.preferAbove
    });
    menu.style.left = `${Math.round(result.left)}px`;
    menu.style.top = `${Math.round(result.top)}px`;
    menu.style.maxHeight = `${Math.round(result.maxHeight)}px`;
    menu.dataset.placement = result.placement;
    return result;
  }

  return Object.freeze({ calculate, placeMenu });
});
