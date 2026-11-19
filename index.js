// OUTBREAK — загрузчик. Намеренно написан на самом простом JS: если основной файл не загрузится
// (старый браузер, ошибка синтаксиса, неверный путь), причина покажется красной плашкой на экране.
(function () {
  function banner(msg) {
    try {
      var d = document.createElement('div');
      d.style.cssText = 'position:fixed;left:8px;right:8px;top:8px;z-index:999999;background:#3a0d0d;color:#ffd7d7;border:2px solid #d55;padding:10px 12px;font:13px/1.4 monospace;white-space:pre-wrap;word-break:break-word';
      d.textContent = 'OUTBREAK: ' + msg + '\n(нажмите, чтобы закрыть)';
      d.onclick = function () { d.remove(); };
      (document.body || document.documentElement).appendChild(d);
    } catch (e) { /* */ }
  }
  window.__obBanner = banner;
  try {
    import('./main.js').catch(function (e) {
      console.error('[Outbreak]', e);
      banner('не удалось загрузить main.js/engine.js — ' + (e && (e.name + ': ' + e.message) || e));
    });
  } catch (e) { banner('браузер не поддерживает import(): ' + e); }
})();
