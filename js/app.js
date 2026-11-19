/* Splitter UI. Depends on window.SplitMath (js/money.js). */
(function () {
  'use strict';

  var M = window.SplitMath;
  var STORAGE_KEY = 'splitter:v1';
  var CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'INR', 'CHF', 'SGD', 'NZD', 'MXN'];

  // ---------------------------------------------------------------- state

  var state = load();
  var ui = { tab: 'expenses' };

  function emptyState() { return { version: 1, activeGroupId: null, groups: [] }; }

  function load() {
    var raw;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { return emptyState(); }
    if (!raw) return emptyState();
    try {
      var data = JSON.parse(raw);
      if (!data || !Array.isArray(data.groups)) throw new Error('bad shape');
      data.groups.forEach(function (g) {
        g.members = Array.isArray(g.members) ? g.members : [];
        g.expenses = Array.isArray(g.expenses) ? g.expenses : [];
        g.payments = Array.isArray(g.payments) ? g.payments : [];
        g.currency = g.currency || 'USD';
      });
      if (!data.groups.some(function (g) { return g.id === data.activeGroupId; })) {
        data.activeGroupId = data.groups.length ? data.groups[0].id : null;
      }
      return data;
    } catch (e) {
      // Don't silently destroy unreadable data: keep a copy before starting fresh.
      try { localStorage.setItem(STORAGE_KEY + ':corrupt-' + Date.now(), raw); } catch (e2) { /* ignore */ }
      return emptyState();
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      toast('Couldn’t save — your browser storage may be full or disabled.');
    }
  }

  // Keep multiple open tabs in sync.
  window.addEventListener('storage', function (e) {
    if (e.key === STORAGE_KEY) { state = load(); render(); }
  });

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function group() {
    for (var i = 0; i < state.groups.length; i++) if (state.groups[i].id === state.activeGroupId) return state.groups[i];
    return null;
  }

  function memberIds(g) { return g.members.map(function (m) { return m.id; }); }
  function memberName(g, id) {
    for (var i = 0; i < g.members.length; i++) if (g.members[i].id === id) return g.members[i].name;
    return 'Unknown';
  }
  function isMemberUsed(g, id) {
    return g.expenses.some(function (e) { return e.paidBy === id || e.split.participants.indexOf(id) !== -1; }) ||
      g.payments.some(function (p) { return p.from === id || p.to === id; });
  }

  // ---------------------------------------------------------------- helpers

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var fmtCache = {};
  function money(cents, currency) {
    var c = currency || (group() && group().currency) || 'USD';
    if (!fmtCache[c]) {
      try { fmtCache[c] = new Intl.NumberFormat(undefined, { style: 'currency', currency: c, minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
      catch (e) { fmtCache[c] = { format: function (v) { return c + ' ' + v.toFixed(2); } }; }
    }
    return fmtCache[c].format(cents / 100);
  }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function fmtDate(iso) {
    var p = iso.split('-').map(Number);
    var d = new Date(p[0], p[1] - 1, p[2]);
    var opts = { month: 'short', day: 'numeric' };
    if (p[0] !== new Date().getFullYear()) opts.year = 'numeric';
    return d.toLocaleDateString(undefined, opts);
  }

  function initials(name) {
    var parts = name.trim().split(/\s+/);
    return ((parts[0] || '')[0] || '?').toUpperCase() + (parts.length > 1 ? (parts[parts.length - 1][0] || '').toUpperCase() : '');
  }
  function hue(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
    return h;
  }
  function avatar(g, id, size) {
    var name = memberName(g, id);
    return '<span class="avatar' + (size ? ' avatar-' + size : '') + '" style="--h:' + hue(id) + '" aria-hidden="true">' + esc(initials(name)) + '</span>';
  }

  function sortedExpenses(g) {
    return g.expenses.slice().sort(function (a, b) {
      return a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0);
    });
  }

  function splitLabel(g, e) {
    var n = e.split.participants.length;
    var who = n === g.members.length && n > 1 ? 'everyone' : n === 1 ? memberName(g, e.split.participants[0]) : n + ' people';
    if (e.split.mode === 'even') return 'Split evenly · ' + who;
    if (e.split.mode === 'percent') return 'Split by % · ' + who;
    return 'Custom amounts · ' + who;
  }

  // ---------------------------------------------------------------- render

  var app = document.getElementById('app');

  function render() {
    renderGroupSwitch();
    var g = group();
    if (!g) { app.innerHTML = renderWelcome(); return; }

    var tabs = [
      ['expenses', 'Expenses'],
      ['balances', 'Balances'],
      ['settle', 'Settle up'],
      ['members', 'People']
    ];
    var settleCount = g.members.length ? M.settleUp(balancesOf(g), memberIds(g)).length : 0;

    var html = '<nav class="tabs" role="tablist">' + tabs.map(function (t) {
      var badge = t[0] === 'settle' && settleCount ? '<span class="badge">' + settleCount + '</span>' : '';
      return '<button role="tab" class="tab' + (ui.tab === t[0] ? ' active' : '') + '" aria-selected="' + (ui.tab === t[0]) +
        '" data-action="go-tab" data-tab="' + t[0] + '">' + t[1] + badge + '</button>';
    }).join('') + '</nav>';

    if (ui.tab === 'expenses') html += renderExpenses(g);
    else if (ui.tab === 'balances') html += renderBalances(g);
    else if (ui.tab === 'settle') html += renderSettle(g);
    else html += renderMembers(g);

    app.innerHTML = html;
  }

  function renderGroupSwitch() {
    var el = document.getElementById('group-switch');
    if (!state.groups.length) { el.innerHTML = ''; return; }
    el.innerHTML =
      '<label class="sr-only" for="group-select">Group</label>' +
      '<select id="group-select" class="group-select" data-action="switch-group">' +
      state.groups.map(function (g) {
        return '<option value="' + esc(g.id) + '"' + (g.id === state.activeGroupId ? ' selected' : '') + '>' + esc(g.name) + '</option>';
      }).join('') +
      '</select>' +
      '<button class="btn btn-ghost btn-icon" data-action="new-group" title="New group" aria-label="New group">' + icon('plus') + '</button>';
  }

  function renderWelcome() {
    return '<section class="welcome card">' +
      '<div class="welcome-art" aria-hidden="true"><span></span><span></span><span></span></div>' +
      '<h1>Split shared costs, minus the awkwardness.</h1>' +
      '<p class="muted">Create a group for your place, add your roommates, and log what everyone pays. ' +
      'Splitter keeps a running balance and tells you the fewest payments needed to square up.</p>' +
      '<button class="btn btn-primary btn-lg" data-action="new-group">Create a group</button>' +
      '<p class="fine">Everything is saved in this browser. Nothing is sent anywhere.</p>' +
      '</section>';
  }

  function balancesOf(g) { return M.computeBalances(memberIds(g), g.expenses, g.payments); }

  function renderExpenses(g) {
    var total = g.expenses.reduce(function (s, e) { return s + e.amount; }, 0);
    var html = '<div class="toolbar">' +
      '<div><div class="eyebrow">Total spent</div><div class="stat">' + money(total) + '</div></div>' +
      '<button class="btn btn-primary" data-action="add-expense"' + (g.members.length ? '' : ' disabled') + '>' + icon('plus') + '<span>Add expense</span></button>' +
      '</div>';

    if (!g.members.length) {
      return html + emptyCard('Add your roommates first', 'You need people in the group before you can split anything.', 'go-tab:members', 'Add people');
    }
    if (!g.expenses.length) {
      return html + emptyCard('No expenses yet', 'Log rent, groceries, utilities — anything you share.', 'add-expense', 'Add the first one');
    }

    var lastDate = null;
    html += '<ul class="list card">';
    sortedExpenses(g).forEach(function (e) {
      if (e.date !== lastDate) {
        html += '<li class="list-date">' + esc(fmtDate(e.date)) + '</li>';
        lastDate = e.date;
      }
      html += '<li><button class="row row-btn" data-action="edit-expense" data-id="' + esc(e.id) + '">' +
        avatar(g, e.paidBy) +
        '<span class="row-main"><span class="row-title">' + esc(e.description) + '</span>' +
        '<span class="row-sub">' + esc(memberName(g, e.paidBy)) + ' paid · ' + esc(splitLabel(g, e)) + '</span></span>' +
        '<span class="row-amount">' + money(e.amount) + '</span>' +
        '</button></li>';
    });
    return html + '</ul>';
  }

  function renderBalances(g) {
    if (!g.members.length) return emptyCard('Nobody here yet', 'Add people to see balances.', 'go-tab:members', 'Add people');
    var bal = balancesOf(g);
    var paid = {}, share = {};
    g.members.forEach(function (m) { paid[m.id] = 0; share[m.id] = 0; });
    g.expenses.forEach(function (e) {
      paid[e.paidBy] += e.amount;
      var s = M.computeShares(e);
      Object.keys(s).forEach(function (id) { share[id] += s[id]; });
    });
    var maxAbs = Math.max.apply(null, g.members.map(function (m) { return Math.abs(bal[m.id]); }).concat([1]));

    var settled = g.members.every(function (m) { return bal[m.id] === 0; });
    var html = '<p class="lead muted">' + (settled
      ? 'Everyone is square. ' + (g.expenses.length ? 'Nice.' : '')
      : 'Positive means the group owes them; negative means they owe the group.') + '</p>';

    html += '<ul class="list card">';
    g.members.slice().sort(function (a, b) { return bal[b.id] - bal[a.id]; }).forEach(function (m) {
      var b = bal[m.id];
      var cls = b > 0 ? 'pos' : b < 0 ? 'neg' : 'zero';
      var label = b > 0 ? 'is owed' : b < 0 ? 'owes' : 'settled up';
      html += '<li class="row balance-row">' + avatar(g, m.id) +
        '<span class="row-main"><span class="row-title">' + esc(m.name) + '</span>' +
        '<span class="row-sub">Paid ' + money(paid[m.id]) + ' · Share ' + money(share[m.id]) + '</span>' +
        '<span class="bar ' + cls + '"><span style="width:' + (Math.abs(b) / maxAbs * 100).toFixed(1) + '%"></span></span></span>' +
        '<span class="row-amount ' + cls + '"><span class="tiny">' + label + '</span>' + (b ? money(Math.abs(b)) : '') + '</span>' +
        '</li>';
    });
    html += '</ul>';
    return html;
  }

  function renderSettle(g) {
    if (!g.members.length) return emptyCard('Nobody here yet', 'Add people to settle up.', 'go-tab:members', 'Add people');
    var plan = M.settleUp(balancesOf(g), memberIds(g));
    var html = '';

    if (!plan.length) {
      html += '<section class="card done-card">' + icon('check', 'done-icon') +
        '<h2>All settled up</h2><p class="muted">Nobody owes anybody anything right now.</p></section>';
    } else {
      html += '<p class="lead muted">' + plan.length + ' payment' + (plan.length === 1 ? '' : 's') +
        ' will clear every balance — that’s the fewest possible.</p>';
      html += '<ul class="list card">';
      plan.forEach(function (p) {
        html += '<li class="row settle-row">' +
          '<span class="pair">' + avatar(g, p.from) + '<span class="arrow" aria-hidden="true">' + icon('arrow') + '</span>' + avatar(g, p.to) + '</span>' +
          '<span class="row-main"><span class="row-title"><b>' + esc(memberName(g, p.from)) + '</b> pays <b>' + esc(memberName(g, p.to)) + '</b></span>' +
          '<span class="row-sub settle-amount">' + money(p.amount) + '</span></span>' +
          '<button class="btn btn-soft btn-sm" data-action="mark-paid" data-from="' + esc(p.from) + '" data-to="' + esc(p.to) + '" data-amount="' + p.amount + '">Mark paid</button>' +
          '</li>';
      });
      html += '</ul>';
    }

    html += '<div class="section-head"><h2>Payments</h2>' +
      '<button class="btn btn-ghost btn-sm" data-action="record-payment"' + (g.members.length > 1 ? '' : ' disabled') + '>' + icon('plus') + '<span>Record payment</span></button></div>';

    if (!g.payments.length) {
      html += '<p class="muted small">Payments you mark as done show up here. Paid only part? Use “Record payment”.</p>';
    } else {
      html += '<ul class="list card">';
      g.payments.slice().sort(function (a, b) {
        return a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0);
      }).forEach(function (p) {
        html += '<li class="row">' + avatar(g, p.from) +
          '<span class="row-main"><span class="row-title">' + esc(memberName(g, p.from)) + ' paid ' + esc(memberName(g, p.to)) + '</span>' +
          '<span class="row-sub">' + esc(fmtDate(p.date)) + '</span></span>' +
          '<span class="row-amount">' + money(p.amount) + '</span>' +
          '<button class="btn btn-ghost btn-icon" data-action="delete-payment" data-id="' + esc(p.id) + '" title="Remove payment" aria-label="Remove payment">' + icon('trash') + '</button>' +
          '</li>';
      });
      html += '</ul>';
    }
    return html;
  }

  function renderMembers(g) {
    var html = '<form class="card add-member" data-form="add-member">' +
      '<label for="new-member" class="sr-only">Name</label>' +
      '<input id="new-member" name="name" class="input" placeholder="Add a roommate by name" autocomplete="off" maxlength="40">' +
      '<button class="btn btn-primary" type="submit">Add</button></form>';

    if (g.members.length) {
      html += '<ul class="list card">';
      g.members.forEach(function (m) {
        var used = isMemberUsed(g, m.id);
        html += '<li class="row">' + avatar(g, m.id) +
          '<span class="row-main"><span class="row-title">' + esc(m.name) + '</span></span>' +
          '<button class="btn btn-ghost btn-icon" data-action="rename-member" data-id="' + esc(m.id) + '" title="Rename" aria-label="Rename ' + esc(m.name) + '">' + icon('edit') + '</button>' +
          '<button class="btn btn-ghost btn-icon" data-action="remove-member" data-id="' + esc(m.id) + '"' +
          (used ? ' data-used="1" title="Has expenses or payments"' : ' title="Remove"') + ' aria-label="Remove ' + esc(m.name) + '">' + icon('trash') + '</button>' +
          '</li>';
      });
      html += '</ul>';
    } else {
      html += '<p class="muted small center">No one here yet. Add everyone who shares costs.</p>';
    }

    html += '<div class="section-head"><h2>Group</h2></div>' +
      '<div class="card group-card">' +
      '<div><div class="row-title">' + esc(g.name) + '</div><div class="row-sub">' + esc(g.currency) + ' · ' +
      g.members.length + ' people · ' + g.expenses.length + ' expenses</div></div>' +
      '<div class="btn-row"><button class="btn btn-ghost btn-sm" data-action="edit-group">Edit</button>' +
      '<button class="btn btn-danger-ghost btn-sm" data-action="delete-group">Delete group</button></div>' +
      '</div>';
    return html;
  }

  function emptyCard(title, text, action, cta) {
    var parts = action.split(':'); // "go-tab:members" -> action + tab
    return '<section class="card empty"><h2>' + esc(title) + '</h2><p class="muted">' + esc(text) + '</p>' +
      '<button class="btn btn-primary" data-action="' + parts[0] + '"' + (parts[1] ? ' data-tab="' + parts[1] + '"' : '') + '>' + esc(cta) + '</button></section>';
  }

  // ---------------------------------------------------------------- icons

  function icon(name, cls) {
    var paths = {
      plus: '<path d="M12 5v14M5 12h14"/>',
      check: '<path d="M20 6 9 17l-5-5"/>',
      arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
      trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
      edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
      x: '<path d="M18 6 6 18M6 6l12 12"/>'
    };
    return '<svg class="icon ' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths[name] + '</svg>';
  }

  // ---------------------------------------------------------------- modal

  var modal = document.getElementById('modal');
  var modalCleanup = null;

  function openModal(html, mount) {
    modal.innerHTML = html;
    if (!modal.open) modal.showModal();
    modalCleanup = mount ? mount(modal) : null;
    var first = modal.querySelector('[autofocus]');
    if (first) first.focus();
  }
  function closeModal() {
    if (modal.open) modal.close();
  }
  modal.addEventListener('close', function () {
    if (typeof modalCleanup === 'function') modalCleanup();
    modalCleanup = null;
    modal.innerHTML = '';
  });
  // Click on the backdrop closes.
  modal.addEventListener('mousedown', function (e) { if (e.target === modal) closeModal(); });

  function modalHead(title) {
    return '<div class="modal-head"><h2 id="modal-title">' + esc(title) + '</h2>' +
      '<button type="button" class="btn btn-ghost btn-icon" data-close aria-label="Close">' + icon('x') + '</button></div>';
  }
  modal.addEventListener('click', function (e) { if (e.target.closest('[data-close]')) closeModal(); });

  function confirmDialog(opts) {
    openModal(
      '<form method="dialog" class="modal-body confirm">' + modalHead(opts.title) +
      '<p class="muted">' + esc(opts.text) + '</p>' +
      '<div class="modal-foot"><span></span><div class="btn-row">' +
      '<button type="button" class="btn btn-ghost" data-close>Cancel</button>' +
      '<button type="submit" class="btn ' + (opts.danger ? 'btn-danger' : 'btn-primary') + '" autofocus>' + esc(opts.confirm || 'OK') + '</button>' +
      '</div></div></form>',
      function (root) {
        root.querySelector('form').addEventListener('submit', function (e) { e.preventDefault(); closeModal(); opts.onConfirm(); });
      }
    );
  }

  function alertDialog(title, text) {
    openModal('<div class="modal-body confirm">' + modalHead(title) + '<p class="muted">' + esc(text) + '</p>' +
      '<div class="modal-foot"><span></span><button class="btn btn-primary" data-close autofocus>OK</button></div></div>');
  }

  // ---------------------------------------------------------------- toast

  var toastEl = document.getElementById('toast');
  var toastTimer = null;
  function toast(msg, action) {
    clearTimeout(toastTimer);
    toastEl.innerHTML = '<span>' + esc(msg) + '</span>' + (action ? '<button class="toast-btn">' + esc(action.label) + '</button>' : '');
    toastEl.hidden = false;
    requestAnimationFrame(function () { toastEl.classList.add('show'); });
    if (action) toastEl.querySelector('.toast-btn').onclick = function () { hideToast(); action.run(); };
    toastTimer = setTimeout(hideToast, action ? 6000 : 3000);
  }
  function hideToast() {
    toastEl.classList.remove('show');
    setTimeout(function () { if (!toastEl.classList.contains('show')) toastEl.hidden = true; }, 200);
  }

  // ---------------------------------------------------------------- group dialog

  function groupDialog(existing) {
    var isNew = !existing;
    var names = isNew ? [] : null;
    openModal(
      '<form class="modal-body" novalidate>' + modalHead(isNew ? 'New group' : 'Edit group') +
      '<label class="field"><span>Group name</span><input class="input" name="name" maxlength="40" placeholder="e.g. 42 Elm St" value="' + esc(existing ? existing.name : '') + '" autofocus></label>' +
      '<label class="field"><span>Currency</span><select class="input" name="currency">' +
      CURRENCIES.map(function (c) { return '<option' + ((existing ? existing.currency : 'USD') === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') +
      '</select></label>' +
      (isNew ? '<div class="field"><span>Roommates</span><div class="chip-input"><div class="chips"></div>' +
        '<input class="input" name="member" maxlength="40" placeholder="Type a name, press Enter" autocomplete="off"></div>' +
        '<small class="muted">You can add more people later.</small></div>' : '') +
      '<p class="form-error" hidden></p>' +
      '<div class="modal-foot"><span></span><div class="btn-row"><button type="button" class="btn btn-ghost" data-close>Cancel</button>' +
      '<button type="submit" class="btn btn-primary">' + (isNew ? 'Create group' : 'Save') + '</button></div></div></form>',
      function (root) {
        var form = root.querySelector('form');
        var err = root.querySelector('.form-error');
        var memberInput = form.elements.member;
        var chips = root.querySelector('.chips');

        function drawChips() {
          chips.innerHTML = names.map(function (n, i) {
            return '<span class="chip">' + esc(n) + '<button type="button" data-i="' + i + '" aria-label="Remove ' + esc(n) + '">' + icon('x') + '</button></span>';
          }).join('');
        }
        function addName() {
          var v = memberInput.value.trim();
          if (!v) return false;
          if (names.some(function (n) { return n.toLowerCase() === v.toLowerCase(); })) { showErr('“' + v + '” is already in the list.'); return true; }
          names.push(v);
          memberInput.value = '';
          err.hidden = true;
          drawChips();
          return true;
        }
        function showErr(msg) { err.textContent = msg; err.hidden = false; }

        if (isNew) {
          memberInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addName(); }
            else if (e.key === 'Backspace' && !memberInput.value && names.length) { names.pop(); drawChips(); }
          });
          chips.addEventListener('click', function (e) {
            var b = e.target.closest('button[data-i]');
            if (b) { names.splice(Number(b.dataset.i), 1); drawChips(); memberInput.focus(); }
          });
        }

        form.addEventListener('submit', function (e) {
          e.preventDefault();
          err.hidden = true;
          var name = form.elements.name.value.trim();
          if (!name) { showErr('Give the group a name.'); form.elements.name.focus(); return; }
          if (isNew && memberInput.value.trim()) addName();
          if (!err.hidden) return;
          if (isNew) {
            var g = {
              id: uid(), name: name, currency: form.elements.currency.value,
              members: names.map(function (n) { return { id: uid(), name: n }; }),
              expenses: [], payments: [], createdAt: Date.now()
            };
            state.groups.push(g);
            state.activeGroupId = g.id;
            ui.tab = g.members.length ? 'expenses' : 'members';
          } else {
            existing.name = name;
            existing.currency = form.elements.currency.value;
          }
          save();
          closeModal();
          render();
        });
      }
    );
  }

  // ---------------------------------------------------------------- expense dialog

  function expenseDialog(g, existing) {
    var ids = memberIds(g);
    var draft = {
      mode: existing ? existing.split.mode : 'even',
      included: {},
      amountVals: {},
      percentVals: {}
    };
    var existingParticipants = existing ? existing.split.participants : ids;
    ids.forEach(function (id) {
      draft.included[id] = existingParticipants.indexOf(id) !== -1;
      draft.amountVals[id] = '';
      draft.percentVals[id] = '';
    });
    if (existing && existing.split.mode === 'amount') {
      existing.split.participants.forEach(function (id) { draft.amountVals[id] = M.centsToInput(existing.split.values[id] || 0); });
    }
    if (existing && existing.split.mode === 'percent') {
      existing.split.participants.forEach(function (id) { draft.percentVals[id] = M.bpToInput(existing.split.values[id] || 0); });
    }

    var payerDefault = existing ? existing.paidBy : ids[0];

    openModal(
      '<form class="modal-body" novalidate>' + modalHead(existing ? 'Edit expense' : 'Add expense') +
      '<label class="field"><span>Description</span><input class="input" name="description" maxlength="80" placeholder="Groceries, rent, internet…" value="' + esc(existing ? existing.description : '') + '"' + (existing ? '' : ' autofocus') + '></label>' +
      '<div class="field-row">' +
      '<label class="field"><span>Amount</span><div class="money-input"><span class="prefix">' + esc(currencySymbol(g.currency)) + '</span>' +
      '<input class="input" name="amount" inputmode="decimal" placeholder="0.00" autocomplete="off" value="' + (existing ? M.centsToInput(existing.amount) : '') + '"></div></label>' +
      '<label class="field"><span>Date</span><input class="input" type="date" name="date" value="' + esc(existing ? existing.date : todayISO()) + '"></label>' +
      '</div>' +
      '<label class="field"><span>Paid by</span><select class="input" name="paidBy">' +
      g.members.map(function (m) { return '<option value="' + esc(m.id) + '"' + (m.id === payerDefault ? ' selected' : '') + '>' + esc(m.name) + '</option>'; }).join('') +
      '</select></label>' +
      '<div class="field"><div class="split-head"><span>Split</span>' +
      '<div class="segmented" role="radiogroup" aria-label="Split type">' +
      [['even', 'Evenly'], ['amount', 'Amounts'], ['percent', 'Percent']].map(function (o) {
        return '<button type="button" role="radio" data-mode="' + o[0] + '">' + o[1] + '</button>';
      }).join('') + '</div></div>' +
      '<div class="split-tools"><button type="button" class="link" data-select="all">Everyone</button> · <button type="button" class="link" data-select="none">No one</button></div>' +
      '<ul class="split-list">' + g.members.map(function (m) {
        return '<li class="split-row" data-id="' + esc(m.id) + '">' +
          '<label class="split-check"><input type="checkbox" data-id="' + esc(m.id) + '">' + avatar(g, m.id, 'sm') + '<span>' + esc(m.name) + '</span></label>' +
          '<span class="split-input"><input class="input input-sm" data-id="' + esc(m.id) + '" inputmode="decimal" autocomplete="off" aria-label="' + esc(m.name) + ' share"><span class="unit"></span></span>' +
          '<span class="split-share"></span></li>';
      }).join('') + '</ul>' +
      '<div class="split-summary"></div></div>' +
      '<ul class="form-error" hidden></ul>' +
      '<div class="modal-foot">' +
      (existing ? '<button type="button" class="btn btn-danger-ghost" data-delete>' + icon('trash') + '<span>Delete</span></button>' : '<span></span>') +
      '<div class="btn-row"><button type="button" class="btn btn-ghost" data-close>Cancel</button>' +
      '<button type="submit" class="btn btn-primary">' + (existing ? 'Save changes' : 'Add expense') + '</button></div></div>' +
      '</form>',
      function (root) {
        var form = root.querySelector('form');
        var summary = root.querySelector('.split-summary');
        var errBox = root.querySelector('.form-error');

        function totalCents() { return M.parseAmount(form.elements.amount.value); }
        function includedIds() { return ids.filter(function (id) { return draft.included[id]; }); }
        function vals() { return draft.mode === 'amount' ? draft.amountVals : draft.percentVals; }

        // Pre-fill custom values with an even split the first time a mode is opened.
        function prefill() {
          var inc = includedIds();
          if (!inc.length || draft.mode === 'even') return;
          var v = vals();
          if (inc.some(function (id) { return v[id] !== ''; })) return;
          if (draft.mode === 'amount') {
            var t = totalCents();
            if (t === null || t === 0) return;
            var s = M.splitEven(t, inc);
            inc.forEach(function (id) { v[id] = M.centsToInput(s[id]); });
          } else {
            var p = M.evenPercents(inc);
            inc.forEach(function (id) { v[id] = M.bpToInput(p[id]); });
          }
        }

        function buildSplit() {
          var inc = includedIds();
          var split = { mode: draft.mode, participants: inc };
          if (draft.mode !== 'even') {
            split.values = {};
            var bad = false;
            inc.forEach(function (id) {
              var raw = vals()[id];
              var parsed = raw.trim() === '' ? 0 : (draft.mode === 'amount' ? M.parseAmount(raw) : M.parsePercent(raw));
              if (parsed === null) { bad = true; parsed = NaN; }
              split.values[id] = parsed;
            });
            split.invalidInput = bad;
          }
          return split;
        }

        function refresh() {
          if (!form.isConnected) return; // dialog already closed
          root.querySelectorAll('.segmented button').forEach(function (b) {
            var on = b.dataset.mode === draft.mode;
            b.classList.toggle('active', on);
            b.setAttribute('aria-checked', on);
          });
          form.classList.toggle('mode-even', draft.mode === 'even');
          form.classList.toggle('mode-amount', draft.mode === 'amount');

          var total = totalCents();
          var split = buildSplit();
          var shares = null;
          var ok = total !== null && total > 0 && split.participants.length && !split.invalidInput;
          if (ok && draft.mode === 'percent') {
            var bpSum = split.participants.reduce(function (s, id) { return s + split.values[id]; }, 0);
            if (bpSum === M.FULL_BP) shares = M.splitByPercent(total, split.participants, split.values);
          } else if (ok && draft.mode === 'even') {
            shares = M.splitEven(total, split.participants);
          }

          ids.forEach(function (id) {
            var row = root.querySelector('.split-row[data-id="' + cssEsc(id) + '"]');
            var on = draft.included[id];
            row.classList.toggle('off', !on);
            row.querySelector('input[type=checkbox]').checked = on;
            var inp = row.querySelector('.split-input input');
            inp.disabled = !on || draft.mode === 'even';
            if (document.activeElement !== inp) inp.value = draft.mode === 'even' ? '' : vals()[id];
            inp.placeholder = draft.mode === 'percent' ? '0' : '0.00';
            row.querySelector('.unit').textContent = draft.mode === 'percent' ? '%' : '';
            var shareEl = row.querySelector('.split-share');
            shareEl.textContent = on && shares && draft.mode !== 'amount' ? money(shares[id], g.currency) : '';
          });

          summary.className = 'split-summary';
          if (!split.participants.length) {
            summary.textContent = 'Pick who this is split between.';
            summary.classList.add('warn');
          } else if (draft.mode === 'even') {
            summary.textContent = total ? split.participants.length + ' ' + (split.participants.length === 1 ? 'person' : 'people') +
              (total % split.participants.length ? ' · leftover cents go to the first in the list' : '') : '';
          } else if (split.invalidInput) {
            summary.textContent = draft.mode === 'amount' ? 'Amounts can have at most 2 decimal places.' : 'Percentages must be between 0 and 100, up to 2 decimals.';
            summary.classList.add('warn');
          } else if (draft.mode === 'amount') {
            var sum = split.participants.reduce(function (s, id) { return s + split.values[id]; }, 0);
            if (total === null) { summary.textContent = 'Assigned ' + money(sum, g.currency); }
            else {
              var left = total - sum;
              summary.textContent = left === 0 ? 'Adds up to ' + money(total, g.currency) + ' ✓' :
                left > 0 ? money(left, g.currency) + ' left to assign' : 'Over by ' + money(-left, g.currency);
              summary.classList.add(left === 0 ? 'good' : 'warn');
            }
          } else {
            var bp = split.participants.reduce(function (s, id) { return s + split.values[id]; }, 0);
            var leftBp = M.FULL_BP - bp;
            summary.textContent = leftBp === 0 ? '100% assigned ✓' : leftBp > 0 ? M.bpToInput(leftBp) + '% left to assign' : 'Over by ' + M.bpToInput(-leftBp) + '%';
            summary.classList.add(leftBp === 0 ? 'good' : 'warn');
          }
        }

        root.querySelectorAll('.segmented button').forEach(function (b) {
          b.addEventListener('click', function () { draft.mode = b.dataset.mode; prefill(); refresh(); });
        });
        root.querySelectorAll('[data-select]').forEach(function (b) {
          b.addEventListener('click', function () {
            var on = b.dataset.select === 'all';
            ids.forEach(function (id) { draft.included[id] = on; });
            refresh();
          });
        });
        root.querySelector('.split-list').addEventListener('change', function (e) {
          if (e.target.type === 'checkbox') { draft.included[e.target.dataset.id] = e.target.checked; refresh(); }
        });
        root.querySelector('.split-list').addEventListener('input', function (e) {
          if (e.target.classList.contains('input')) { vals()[e.target.dataset.id] = e.target.value; refresh(); }
        });
        form.elements.amount.addEventListener('input', refresh);
        form.addEventListener('focusout', function () { setTimeout(refresh, 0); });

        var del = root.querySelector('[data-delete]');
        if (del) del.addEventListener('click', function () {
          confirmDialog({
            title: 'Delete expense?', danger: true, confirm: 'Delete',
            text: '“' + existing.description + '” (' + money(existing.amount, g.currency) + ') will be removed and balances recalculated.',
            onConfirm: function () {
              var idx = g.expenses.indexOf(existing);
              g.expenses.splice(idx, 1);
              save(); render();
              toast('Expense deleted', { label: 'Undo', run: function () { g.expenses.splice(idx, 0, existing); save(); render(); } });
            }
          });
        });

        form.addEventListener('submit', function (e) {
          e.preventDefault();
          var split = buildSplit();
          var errors = [];
          var amount = totalCents();
          if (split.invalidInput) errors.push(draft.mode === 'amount' ? 'Fix the custom amounts (max 2 decimals).' : 'Fix the percentages (0–100, max 2 decimals).');
          delete split.invalidInput;
          if (form.elements.amount.value.trim() && amount === null) errors.push('The amount should be a number like 12.50.');
          var exp = {
            id: existing ? existing.id : uid(),
            description: form.elements.description.value.trim(),
            amount: amount === null ? 0 : amount,
            date: form.elements.date.value,
            paidBy: form.elements.paidBy.value,
            split: split,
            createdAt: existing ? existing.createdAt : Date.now()
          };
          if (!errors.length) errors = M.validateExpense(exp, ids);
          if (errors.length) {
            errBox.innerHTML = errors.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('');
            errBox.hidden = false;
            errBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            return;
          }
          if (existing) g.expenses[g.expenses.indexOf(existing)] = exp;
          else g.expenses.push(exp);
          save();
          closeModal();
          render();
          toast(existing ? 'Expense updated' : 'Expense added');
        });

        prefill();
        refresh();
      }
    );
  }

  function currencySymbol(c) {
    try {
      var parts = new Intl.NumberFormat(undefined, { style: 'currency', currency: c, currencyDisplay: 'narrowSymbol' }).formatToParts(0);
      for (var i = 0; i < parts.length; i++) if (parts[i].type === 'currency') return parts[i].value;
    } catch (e) { /* fall through */ }
    return c;
  }

  function cssEsc(s) { return window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/"/g, '\\"'); }

  // ---------------------------------------------------------------- payment dialog

  function paymentDialog(g, preset) {
    var p = preset || {};
    var opts = function (sel) {
      return g.members.map(function (m) { return '<option value="' + esc(m.id) + '"' + (m.id === sel ? ' selected' : '') + '>' + esc(m.name) + '</option>'; }).join('');
    };
    openModal(
      '<form class="modal-body" novalidate>' + modalHead('Record a payment') +
      '<div class="field-row">' +
      '<label class="field"><span>From</span><select class="input" name="from">' + opts(p.from || g.members[0].id) + '</select></label>' +
      '<label class="field"><span>To</span><select class="input" name="to">' + opts(p.to || g.members[1].id) + '</select></label>' +
      '</div><div class="field-row">' +
      '<label class="field"><span>Amount</span><div class="money-input"><span class="prefix">' + esc(currencySymbol(g.currency)) + '</span>' +
      '<input class="input" name="amount" inputmode="decimal" placeholder="0.00" autocomplete="off" value="' + (p.amount ? M.centsToInput(p.amount) : '') + '" autofocus></div></label>' +
      '<label class="field"><span>Date</span><input class="input" type="date" name="date" value="' + todayISO() + '"></label>' +
      '</div><p class="form-error" hidden></p>' +
      '<div class="modal-foot"><span></span><div class="btn-row"><button type="button" class="btn btn-ghost" data-close>Cancel</button>' +
      '<button type="submit" class="btn btn-primary">Save payment</button></div></div></form>',
      function (root) {
        var form = root.querySelector('form');
        var err = root.querySelector('.form-error');
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          var amount = M.parseAmount(form.elements.amount.value);
          var msg = null;
          if (form.elements.from.value === form.elements.to.value) msg = 'Pick two different people.';
          else if (amount === null || amount <= 0) msg = 'Enter an amount greater than zero, like 25.00.';
          else if (!form.elements.date.value) msg = 'Pick a date.';
          if (msg) { err.textContent = msg; err.hidden = false; return; }
          addPayment(g, { from: form.elements.from.value, to: form.elements.to.value, amount: amount, date: form.elements.date.value });
          closeModal();
        });
      }
    );
  }

  function addPayment(g, p) {
    var payment = { id: uid(), from: p.from, to: p.to, amount: p.amount, date: p.date || todayISO(), createdAt: Date.now() };
    g.payments.push(payment);
    save();
    render();
    toast(memberName(g, p.from) + ' paid ' + memberName(g, p.to) + ' ' + money(p.amount, g.currency), {
      label: 'Undo',
      run: function () {
        var i = g.payments.indexOf(payment);
        if (i !== -1) { g.payments.splice(i, 1); save(); render(); }
      }
    });
  }

  // ---------------------------------------------------------------- events

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]');
    if (!el || el.tagName === 'SELECT' || modal.contains(el)) return;
    var g = group();
    var action = el.dataset.action;

    if (action === 'go-tab') { e.preventDefault(); if (g) { ui.tab = el.dataset.tab; render(); window.scrollTo({ top: 0 }); } return; }
    if (action === 'new-group') return groupDialog(null);
    if (!g) return;

    switch (action) {
      case 'add-expense': return expenseDialog(g, null);
      case 'edit-expense': {
        var exp = g.expenses.filter(function (x) { return x.id === el.dataset.id; })[0];
        if (exp) expenseDialog(g, exp);
        return;
      }
      case 'mark-paid':
        return addPayment(g, { from: el.dataset.from, to: el.dataset.to, amount: Number(el.dataset.amount) });
      case 'record-payment': return paymentDialog(g, null);
      case 'delete-payment': {
        var pay = g.payments.filter(function (x) { return x.id === el.dataset.id; })[0];
        if (!pay) return;
        return confirmDialog({
          title: 'Remove payment?', danger: true, confirm: 'Remove',
          text: memberName(g, pay.from) + ' → ' + memberName(g, pay.to) + ' for ' + money(pay.amount) + '. Balances will go back to what they were before it.',
          onConfirm: function () { g.payments.splice(g.payments.indexOf(pay), 1); save(); render(); toast('Payment removed'); }
        });
      }
      case 'rename-member': return renameMember(g, el.dataset.id);
      case 'remove-member': {
        var id = el.dataset.id;
        if (isMemberUsed(g, id)) {
          return alertDialog('Can’t remove ' + memberName(g, id),
            'They’re part of existing expenses or payments. Delete or edit those first so balances stay correct.');
        }
        return confirmDialog({
          title: 'Remove ' + memberName(g, id) + '?', danger: true, confirm: 'Remove', text: 'They’ll be removed from this group.',
          onConfirm: function () { g.members = g.members.filter(function (m) { return m.id !== id; }); save(); render(); }
        });
      }
      case 'edit-group': return groupDialog(g);
      case 'delete-group':
        return confirmDialog({
          title: 'Delete “' + g.name + '”?', danger: true, confirm: 'Delete group',
          text: 'This permanently removes the group, its ' + g.expenses.length + ' expenses and ' + g.payments.length + ' payments.',
          onConfirm: function () {
            state.groups = state.groups.filter(function (x) { return x.id !== g.id; });
            state.activeGroupId = state.groups.length ? state.groups[0].id : null;
            ui.tab = 'expenses';
            save(); render();
          }
        });
    }
  });

  document.addEventListener('change', function (e) {
    if (e.target.dataset && e.target.dataset.action === 'switch-group') {
      state.activeGroupId = e.target.value;
      save();
      render();
    }
  });

  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (form.dataset.form !== 'add-member') return;
    e.preventDefault();
    var g = group();
    var input = form.elements.name;
    var name = input.value.trim();
    if (!name) return input.focus();
    if (g.members.some(function (m) { return m.name.toLowerCase() === name.toLowerCase(); })) {
      toast(name + ' is already in the group');
      return;
    }
    g.members.push({ id: uid(), name: name });
    save();
    render();
    var next = document.getElementById('new-member');
    if (next) next.focus();
  });

  function renameMember(g, id) {
    var m = g.members.filter(function (x) { return x.id === id; })[0];
    if (!m) return;
    openModal(
      '<form class="modal-body" novalidate>' + modalHead('Rename') +
      '<label class="field"><span>Name</span><input class="input" name="name" maxlength="40" value="' + esc(m.name) + '" autofocus></label>' +
      '<p class="form-error" hidden></p>' +
      '<div class="modal-foot"><span></span><div class="btn-row"><button type="button" class="btn btn-ghost" data-close>Cancel</button>' +
      '<button type="submit" class="btn btn-primary">Save</button></div></div></form>',
      function (root) {
        var form = root.querySelector('form');
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          var name = form.elements.name.value.trim();
          var err = root.querySelector('.form-error');
          if (!name) { err.textContent = 'Name can’t be empty.'; err.hidden = false; return; }
          if (g.members.some(function (x) { return x.id !== id && x.name.toLowerCase() === name.toLowerCase(); })) {
            err.textContent = 'Someone already has that name.'; err.hidden = false; return;
          }
          m.name = name;
          save(); closeModal(); render();
        });
      }
    );
  }

  render();
})();
