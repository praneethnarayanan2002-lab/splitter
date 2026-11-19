/*
 * Money math for the splitter. Pure functions, no DOM.
 *
 * Every amount is an integer number of cents and every percentage is an
 * integer number of basis points (1/100 of a percent, so 100% = 10000).
 * No floating point is used for money anywhere, so shares always add up
 * to exactly the expense total and balances always add up to exactly zero.
 *
 * Loaded as a plain <script> in the browser (exposes window.SplitMath)
 * and via require() in the Node tests.
 */
(function (root) {
  'use strict';

  var MAX_CENTS = 100000000000; // 1,000,000,000.00 — keeps every product well under 2^53
  var FULL_BP = 10000;

  // ---------- parsing & formatting ----------

  /** "12.3" -> 1230, "1,200" -> 120000, ".5" -> 50. Returns null if not a valid non-negative amount. */
  function parseAmount(input) {
    if (input === null || input === undefined) return null;
    var s = String(input).trim().replace(/[,\s]/g, '');
    if (s === '') return null;
    var m = /^(\d*)(?:\.(\d{0,2}))?$/.exec(s);
    if (!m || (m[1] === '' && (m[2] === undefined || m[2] === ''))) return null;
    var whole = m[1] === '' ? 0 : Number(m[1]);
    var frac = m[2] === undefined ? 0 : Number((m[2] + '00').slice(0, 2));
    var cents = whole * 100 + frac;
    if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) return null;
    return cents;
  }

  /** "33.33" -> 3333, "50" -> 5000. Returns null if invalid or above 100%. */
  function parsePercent(input) {
    if (input === null || input === undefined) return null;
    var s = String(input).trim().replace(/%$/, '').trim();
    if (s === '') return null;
    var m = /^(\d*)(?:\.(\d{0,2}))?$/.exec(s);
    if (!m || (m[1] === '' && (m[2] === undefined || m[2] === ''))) return null;
    var whole = m[1] === '' ? 0 : Number(m[1]);
    var frac = m[2] === undefined ? 0 : Number((m[2] + '00').slice(0, 2));
    var bp = whole * 100 + frac;
    if (bp > FULL_BP) return null;
    return bp;
  }

  /** 1230 -> "12.30" (for putting back into an input). */
  function centsToInput(cents) {
    var sign = cents < 0 ? '-' : '';
    var abs = Math.abs(cents);
    var frac = String(abs % 100);
    return sign + Math.floor(abs / 100) + '.' + (frac.length < 2 ? '0' + frac : frac);
  }

  /** 3333 -> "33.33", 5000 -> "50". */
  function bpToInput(bp) {
    var whole = Math.floor(bp / 100);
    var frac = bp % 100;
    if (frac === 0) return String(whole);
    return whole + '.' + (frac < 10 ? '0' + frac : String(frac)).replace(/0$/, '');
  }

  // ---------- splitting ----------

  /**
   * Split `total` cents evenly across `ids`. Leftover cents (when the total
   * doesn't divide evenly) go one each to the first people in the list.
   */
  function splitEven(total, ids) {
    var out = {};
    var n = ids.length;
    if (n === 0) return out;
    var base = Math.floor(total / n);
    var extra = total - base * n;
    for (var i = 0; i < n; i++) out[ids[i]] = base + (i < extra ? 1 : 0);
    return out;
  }

  /** Even split of 100% in basis points, same leftover rule as splitEven. */
  function evenPercents(ids) {
    return splitEven(FULL_BP, ids);
  }

  /**
   * Split `total` cents by basis-point weights that sum to 10000, using the
   * largest-remainder method so the shares sum to exactly `total`.
   * Ties are broken by position in `ids`.
   */
  function splitByPercent(total, ids, bpById) {
    var out = {};
    var rows = [];
    var allocated = 0;
    for (var i = 0; i < ids.length; i++) {
      var raw = total * (bpById[ids[i]] || 0); // exact integer: total * bp
      var floor = Math.floor(raw / FULL_BP);
      rows.push({ id: ids[i], idx: i, rem: raw - floor * FULL_BP });
      out[ids[i]] = floor;
      allocated += floor;
    }
    var leftover = total - allocated; // always < ids.length
    rows.sort(function (a, b) { return b.rem - a.rem || a.idx - b.idx; });
    for (var j = 0; j < leftover; j++) out[rows[j].id] += 1;
    return out;
  }

  /**
   * Validate an expense against the current member list.
   * Returns an array of human-readable error strings (empty = valid).
   */
  function validateExpense(exp, memberIds) {
    var errors = [];
    var members = {};
    memberIds.forEach(function (id) { members[id] = true; });

    if (!exp.description || !String(exp.description).trim()) errors.push('Add a description.');
    if (!Number.isSafeInteger(exp.amount) || exp.amount <= 0) errors.push('Enter an amount greater than zero.');
    else if (exp.amount > MAX_CENTS) errors.push('That amount is too large.');
    if (!exp.date || !/^\d{4}-\d{2}-\d{2}$/.test(exp.date)) errors.push('Pick a date.');
    if (!members[exp.paidBy]) errors.push('Choose who paid.');

    var split = exp.split || {};
    var ids = split.participants || [];
    if (ids.length === 0) {
      errors.push('Pick at least one person to split with.');
      return errors;
    }
    var seen = {};
    for (var i = 0; i < ids.length; i++) {
      if (!members[ids[i]]) { errors.push('Split includes someone who is no longer in the group.'); return errors; }
      if (seen[ids[i]]) { errors.push('Someone is listed twice in the split.'); return errors; }
      seen[ids[i]] = true;
    }

    var values = split.values || {};
    if (split.mode === 'amount') {
      var sum = 0;
      for (var a = 0; a < ids.length; a++) {
        var v = values[ids[a]];
        if (!Number.isSafeInteger(v) || v < 0) { errors.push('Every custom amount must be zero or more.'); return errors; }
        sum += v;
      }
      if (Number.isSafeInteger(exp.amount) && sum !== exp.amount) {
        errors.push('Custom amounts add up to ' + centsToInput(sum) + ' but the total is ' + centsToInput(exp.amount) + '.');
      }
    } else if (split.mode === 'percent') {
      var bpSum = 0;
      for (var p = 0; p < ids.length; p++) {
        var b = values[ids[p]];
        if (!Number.isSafeInteger(b) || b < 0) { errors.push('Every percentage must be zero or more.'); return errors; }
        bpSum += b;
      }
      if (bpSum !== FULL_BP) errors.push('Percentages add up to ' + bpToInput(bpSum) + '% — they need to total 100%.');
    } else if (split.mode !== 'even') {
      errors.push('Unknown split type.');
    }
    return errors;
  }

  /** Map of memberId -> cents owed for one (valid) expense. Always sums to exp.amount. */
  function computeShares(exp) {
    var split = exp.split;
    var ids = split.participants;
    if (split.mode === 'even') return splitEven(exp.amount, ids);
    if (split.mode === 'percent') return splitByPercent(exp.amount, ids, split.values);
    var out = {};
    ids.forEach(function (id) { out[id] = split.values[id] || 0; });
    return out;
  }

  // ---------- balances ----------

  /**
   * Net balance per member in cents. Positive = is owed money, negative = owes money.
   * Payments ({from, to, amount}) move money from a debtor to a creditor.
   */
  function computeBalances(memberIds, expenses, payments) {
    var bal = {};
    memberIds.forEach(function (id) { bal[id] = 0; });
    function add(id, v) { if (!(id in bal)) bal[id] = 0; bal[id] += v; }

    (expenses || []).forEach(function (exp) {
      add(exp.paidBy, exp.amount);
      var shares = computeShares(exp);
      Object.keys(shares).forEach(function (id) { add(id, -shares[id]); });
    });
    (payments || []).forEach(function (p) {
      add(p.from, p.amount);
      add(p.to, -p.amount);
    });
    return bal;
  }

  // ---------- settle up ----------

  /** Greedy settlement within a set that sums to zero: at most (n - 1) payments. */
  function greedySettle(entries) {
    var debtors = [], creditors = [];
    entries.forEach(function (e, idx) {
      if (e.amount < 0) debtors.push({ id: e.id, left: -e.amount, idx: e.order });
      else if (e.amount > 0) creditors.push({ id: e.id, left: e.amount, idx: e.order });
    });
    var byLargest = function (a, b) { return b.left - a.left || a.idx - b.idx; };
    var out = [];
    while (debtors.length && creditors.length) {
      debtors.sort(byLargest);
      creditors.sort(byLargest);
      var d = debtors[0], c = creditors[0];
      var amt = Math.min(d.left, c.left);
      out.push({ from: d.id, to: c.id, amount: amt });
      d.left -= amt;
      c.left -= amt;
      if (d.left === 0) debtors.shift();
      if (c.left === 0) creditors.shift();
    }
    return out;
  }

  var EXACT_LIMIT = 18; // 2^18 subsets — instant. Beyond that, fall back to greedy.

  /**
   * Fewest payments that bring every balance to zero.
   *
   * The minimum equals (number of people with a non-zero balance) minus
   * (the most groups they can be split into where each group nets to zero),
   * because a zero-sum group of k people can always be settled in k - 1
   * payments and never fewer. We find that partition exactly with a subset
   * DP, then settle each group greedily.
   */
  function settleUp(balances, order) {
    var ids = order || Object.keys(balances);
    var entries = [];
    ids.forEach(function (id, i) {
      if (balances[id]) entries.push({ id: id, amount: balances[id], order: i });
    });
    var n = entries.length;
    if (n === 0) return [];

    var total = entries.reduce(function (s, e) { return s + e.amount; }, 0);
    if (total !== 0 || n > EXACT_LIMIT) return greedySettle(entries);

    var size = 1 << n;
    var full = size - 1;
    var sum = new Float64Array(size); // exact for integers below 2^53
    var dp = new Int8Array(size);
    for (var mask = 1; mask < size; mask++) {
      var low = mask & -mask;
      var bit = 31 - Math.clz32(low);
      sum[mask] = sum[mask ^ low] + entries[bit].amount;
      var best = 0;
      for (var i = 0; i < n; i++) {
        if (mask & (1 << i)) {
          var v = dp[mask ^ (1 << i)];
          if (v > best) best = v;
        }
      }
      dp[mask] = best + (sum[mask] === 0 ? 1 : 0);
    }

    // Walk back from the full set, removing one person at a time along an
    // optimal path. Every time what's left sums to zero, the people removed
    // since the last cut form one zero-sum group.
    var groups = [];
    var current = [];
    var m = full;
    while (m) {
      var target = dp[m] - (sum[m] === 0 ? 1 : 0);
      for (var k = 0; k < n; k++) {
        if ((m & (1 << k)) && dp[m ^ (1 << k)] === target) {
          current.push(entries[k]);
          m ^= 1 << k;
          break;
        }
      }
      if (sum[m] === 0) { groups.push(current); current = []; }
    }

    var out = [];
    groups.forEach(function (g) {
      g.sort(function (a, b) { return a.order - b.order; });
      out = out.concat(greedySettle(g));
    });
    return out;
  }

  var api = {
    MAX_CENTS: MAX_CENTS,
    FULL_BP: FULL_BP,
    parseAmount: parseAmount,
    parsePercent: parsePercent,
    centsToInput: centsToInput,
    bpToInput: bpToInput,
    splitEven: splitEven,
    evenPercents: evenPercents,
    splitByPercent: splitByPercent,
    validateExpense: validateExpense,
    computeShares: computeShares,
    computeBalances: computeBalances,
    settleUp: settleUp,
    greedySettle: greedySettle
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SplitMath = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
