// VibeTheWorld — Copy-to-clipboard for code blocks

(function () {
  'use strict';

  var blocks = document.querySelectorAll('.code-block');

  for (var i = 0; i < blocks.length; i++) {
    var btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.textContent = 'Copy';
    btn.setAttribute('type', 'button');
    blocks[i].appendChild(btn);
  }

  document.addEventListener('click', function (e) {
    if (!e.target.classList.contains('copy-btn')) return;

    var block = e.target.closest('.code-block');
    if (!block) return;

    var code = block.querySelector('code');
    if (!code) return;

    var text = code.textContent || '';

    navigator.clipboard.writeText(text).then(function () {
      e.target.textContent = 'Copied!';
      e.target.classList.add('copied');
      setTimeout(function () {
        e.target.textContent = 'Copy';
        e.target.classList.remove('copied');
      }, 2000);
    }).catch(function () {
      // Fallback for older browsers
      var area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      try { document.execCommand('copy'); } catch (_) {}
      document.body.removeChild(area);
      e.target.textContent = 'Copied!';
      e.target.classList.add('copied');
      setTimeout(function () {
        e.target.textContent = 'Copy';
        e.target.classList.remove('copied');
      }, 2000);
    });
  });
})();
