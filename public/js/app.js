// VibeTheWorld — Stats & Leaderboard

(function () {
  'use strict';

  var REFRESH_INTERVAL = 30000;
  var currentCategory = 'level';

  // --- Stats ---

  function fetchStats() {
    fetch('/api/stats')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        setText('stat-players', data.players);
        setText('stat-chunks', data.chunks);
        setText('stat-locations', data.locations);
        setText('stat-items', data.items);
        setText('stat-players-full', data.players);
        setText('stat-alive', data.alive);
        setText('stat-chunks-full', data.chunks);
        setText('stat-items-full', data.items);
      })
      .catch(function () {
        // Stats unavailable — leave placeholders
      });
  }

  function setText(id, value) {
    var el = document.getElementById(id);
    if (el) {
      el.textContent = typeof value === 'number' ? value.toLocaleString() : String(value);
    }
  }

  // --- Leaderboard ---

  function fetchLeaderboard(category) {
    fetch('/api/leaderboard?category=' + encodeURIComponent(category) + '&per_page=10')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        renderLeaderboard(data, category);
      })
      .catch(function () {
        var body = document.getElementById('leaderboard-body');
        if (body) {
          body.innerHTML = '<tr><td colspan="3" style="color:var(--text-dim);text-align:center">Unavailable</td></tr>';
        }
      });
  }

  function renderLeaderboard(data, category) {
    var body = document.getElementById('leaderboard-body');
    if (!body) return;

    var entries = data.entries || data.leaderboard || [];
    if (entries.length === 0) {
      body.innerHTML = '<tr><td colspan="3" style="color:var(--text-dim);text-align:center">No players yet</td></tr>';
      return;
    }

    var html = '';
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      var rank = entry.rank || (i + 1);
      var name = escapeHtml(entry.name || entry.player || '???');
      var value = formatValue(entry.value !== undefined ? entry.value : entry[category], category);

      html += '<tr>';
      html += '<td>' + rank + '</td>';
      html += '<td>' + name + '</td>';
      html += '<td style="color:var(--green)">' + value + '</td>';
      html += '</tr>';
    }

    body.innerHTML = html;
  }

  function formatValue(val, category) {
    if (val === undefined || val === null) return '--';
    var num = Number(val);
    if (category === 'gold' || category === 'net_worth') {
      return num.toLocaleString() + 'g';
    }
    return num.toLocaleString();
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // --- Tab Switching ---

  var tabContainer = document.getElementById('leaderboard-tabs');
  if (tabContainer) {
    tabContainer.addEventListener('click', function (e) {
      var btn = e.target;
      if (!btn.classList.contains('tab')) return;

      var category = btn.getAttribute('data-category');
      if (!category || category === currentCategory) return;

      currentCategory = category;

      var tabs = tabContainer.querySelectorAll('.tab');
      for (var i = 0; i < tabs.length; i++) {
        tabs[i].classList.remove('active');
      }
      btn.classList.add('active');

      fetchLeaderboard(category);
    });
  }

  // --- Init ---

  fetchStats();
  fetchLeaderboard(currentCategory);

  setInterval(function () {
    fetchStats();
    fetchLeaderboard(currentCategory);
  }, REFRESH_INTERVAL);
})();
