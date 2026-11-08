// 浸染: line up the pattern that seeps into white cards with the faint pattern
// on the page background, so both read as one continuous cloth.
// Each dyed element gets --dye-ox / --dye-oy = minus its offset from <body>.
(function () {
  var SELECTOR = '.dye, .a-panel, .a-summary, .a-login';
  var queued = false;
  function align() {
    queued = false;
    var b = document.body;
    if (!b) return;
    var br = b.getBoundingClientRect();
    var bx = br.left + b.clientLeft, by = br.top + b.clientTop;
    var list = document.querySelectorAll(SELECTOR);
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') continue; // hidden
      var r = el.getBoundingClientRect();
      var x = r.left + el.clientLeft - bx, y = r.top + el.clientTop - by;
      el.style.setProperty('--dye-ox', (-x).toFixed(2) + 'px');
      el.style.setProperty('--dye-oy', (-y).toFixed(2) + 'px');
    }
  }
  function queue() {
    if (queued) return;
    queued = true;
    (window.requestAnimationFrame || setTimeout)(align);
  }
  window.dyeAlign = queue;
  document.addEventListener('DOMContentLoaded', queue);
  window.addEventListener('load', queue);
  window.addEventListener('resize', queue);
  document.addEventListener('click', function () { setTimeout(queue, 0); }, true);
  document.addEventListener('toggle', queue, true);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(queue);
  if ('ResizeObserver' in window) {
    var ro = new ResizeObserver(queue);
    var start = function () { ro.observe(document.body); };
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  }
  if ('MutationObserver' in window) {
    var mo = new MutationObserver(queue);
    // Structure/visibility changes only (never 'style', which we write ourselves).
    var watch = function () { mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class', 'open'] }); };
    if (document.body) watch(); else document.addEventListener('DOMContentLoaded', watch);
  }
})();
