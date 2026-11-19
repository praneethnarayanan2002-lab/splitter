'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../js/money.js');

const sumValues = (o) => Object.values(o).reduce((a, b) => a + b, 0);

test('parseAmount handles common inputs without float error', () => {
  assert.equal(M.parseAmount('12.34'), 1234);
  assert.equal(M.parseAmount('0.1'), 10);
  assert.equal(M.parseAmount('.5'), 50);
  assert.equal(M.parseAmount('5.'), 500);
  assert.equal(M.parseAmount('1,200.07'), 120007);
  assert.equal(M.parseAmount('19.99'), 1999); // 19.99 * 100 = 1998.9999... in floats
  assert.equal(M.parseAmount('0'), 0);
  for (const bad of ['', '.', 'abc', '1.234', '-5', '1e3', '1.2.3', null, undefined]) {
    assert.equal(M.parseAmount(bad), null, `expected null for ${bad}`);
  }
});

test('parsePercent and formatting round-trip', () => {
  assert.equal(M.parsePercent('33.33'), 3333);
  assert.equal(M.parsePercent('50%'), 5000);
  assert.equal(M.parsePercent('100'), 10000);
  assert.equal(M.parsePercent('100.01'), null);
  assert.equal(M.parsePercent('12.345'), null);
  assert.equal(M.bpToInput(3333), '33.33');
  assert.equal(M.bpToInput(5000), '50');
  assert.equal(M.bpToInput(1250), '12.5');
  assert.equal(M.bpToInput(1205), '12.05');
  assert.equal(M.centsToInput(1230), '12.30');
  assert.equal(M.centsToInput(5), '0.05');
  assert.equal(M.centsToInput(-705), '-7.05');
});

test('even split distributes leftover cents and sums exactly', () => {
  assert.deepEqual(M.splitEven(1000, ['a', 'b', 'c']), { a: 334, b: 333, c: 333 });
  assert.deepEqual(M.splitEven(1001, ['a', 'b', 'c']), { a: 334, b: 334, c: 333 });
  assert.deepEqual(M.splitEven(1, ['a', 'b']), { a: 1, b: 0 });
  for (let total = 0; total < 500; total++) {
    for (let n = 1; n <= 7; n++) {
      const ids = Array.from({ length: n }, (_, i) => 'p' + i);
      const s = M.splitEven(total, ids);
      assert.equal(sumValues(s), total);
      const vals = Object.values(s);
      assert.ok(Math.max(...vals) - Math.min(...vals) <= 1);
    }
  }
});

test('percent split uses largest remainder and sums exactly', () => {
  assert.deepEqual(
    M.splitByPercent(10000, ['a', 'b', 'c'], { a: 3334, b: 3333, c: 3333 }),
    { a: 3334, b: 3333, c: 3333 }
  );
  // $10.00 at 33.33/33.33/33.34 -> 333.3, 333.3, 333.4 -> one leftover cent to the largest remainder (c)
  assert.deepEqual(
    M.splitByPercent(1000, ['a', 'b', 'c'], { a: 3333, b: 3333, c: 3334 }),
    { a: 333, b: 333, c: 334 }
  );
  assert.deepEqual(M.splitByPercent(999, ['a', 'b'], { a: 7000, b: 3000 }), { a: 699, b: 300 }); // 699.3 / 299.7
  // Randomised: always sums to the total and each share is within 1 cent of exact.
  let seed = 42;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let t = 0; t < 2000; t++) {
    const n = 1 + Math.floor(rnd() * 6);
    const ids = Array.from({ length: n }, (_, i) => 'p' + i);
    const cuts = Array.from({ length: n - 1 }, () => Math.floor(rnd() * 10001)).sort((a, b) => a - b);
    const bp = {};
    let prev = 0;
    ids.forEach((id, i) => { const c = i < n - 1 ? cuts[i] : 10000; bp[id] = c - prev; prev = c; });
    const total = Math.floor(rnd() * 1000000);
    const s = M.splitByPercent(total, ids, bp);
    assert.equal(sumValues(s), total);
    ids.forEach((id) => assert.ok(Math.abs(s[id] - (total * bp[id]) / 10000) < 1));
  }
});

test('validateExpense catches bad splits', () => {
  const members = ['a', 'b', 'c'];
  const base = { description: 'Rent', amount: 3000, date: '2026-11-01', paidBy: 'a' };
  assert.deepEqual(M.validateExpense({ ...base, split: { mode: 'even', participants: members } }, members), []);
  assert.equal(M.validateExpense({ ...base, split: { mode: 'even', participants: [] } }, members).length, 1);
  assert.match(
    M.validateExpense({ ...base, split: { mode: 'amount', participants: ['a', 'b'], values: { a: 1000, b: 1000 } } }, members)[0],
    /add up to 20.00/
  );
  assert.deepEqual(
    M.validateExpense({ ...base, split: { mode: 'amount', participants: ['a', 'b'], values: { a: 1000, b: 2000 } } }, members),
    []
  );
  assert.match(
    M.validateExpense({ ...base, split: { mode: 'percent', participants: ['a', 'b'], values: { a: 5000, b: 4000 } } }, members)[0],
    /90%/
  );
  assert.ok(M.validateExpense({ ...base, paidBy: 'zzz', split: { mode: 'even', participants: members } }, members).length);
  assert.ok(M.validateExpense({ ...base, amount: 0, split: { mode: 'even', participants: members } }, members).length);
});

test('balances: payer is owed, participants owe, payments clear debts', () => {
  const members = ['a', 'b', 'c'];
  const expenses = [
    { amount: 9000, paidBy: 'a', split: { mode: 'even', participants: members } }, // each 30
    { amount: 3000, paidBy: 'b', split: { mode: 'amount', participants: ['b', 'c'], values: { b: 1000, c: 2000 } } },
  ];
  let bal = M.computeBalances(members, expenses, []);
  assert.deepEqual(bal, { a: 6000, b: -1000, c: -5000 });
  assert.equal(sumValues(bal), 0);

  const plan = M.settleUp(bal, members);
  assert.equal(plan.length, 2);
  bal = M.computeBalances(members, expenses, plan);
  assert.deepEqual(bal, { a: 0, b: 0, c: 0 });
});

// Brute force: try every possible sequence of "pay off one pair" moves is
// too big, so instead compute the true minimum via exhaustive partition search.
function bruteMinPayments(amounts) {
  const vals = amounts.filter((v) => v !== 0);
  const n = vals.length;
  let best = 0;
  // max number of disjoint zero-sum groups via recursion over subsets
  function rec(remaining) {
    if (remaining.length === 0) return 0;
    const [first, ...rest] = remaining;
    let bestHere = 0;
    const m = rest.length;
    for (let mask = 0; mask < 1 << m; mask++) {
      let s = first;
      const inG = [], outG = [];
      for (let i = 0; i < m; i++) (mask & (1 << i) ? inG : outG).push(rest[i]);
      inG.forEach((v) => (s += v));
      if (s === 0) bestHere = Math.max(bestHere, 1 + rec(outG));
    }
    return bestHere;
  }
  best = rec(vals);
  return n - best;
}

test('settleUp finds the true minimum number of payments', () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let t = 0; t < 400; t++) {
    const n = 2 + Math.floor(rnd() * 7);
    const ids = Array.from({ length: n }, (_, i) => 'p' + i);
    // small value pool makes zero-sum subgroups common, which is where greedy fails
    const vals = ids.map(() => (Math.floor(rnd() * 9) - 4) * 500);
    const drift = vals.reduce((a, b) => a + b, 0);
    vals[n - 1] -= drift;
    const bal = {};
    ids.forEach((id, i) => (bal[id] = vals[i]));

    const plan = M.settleUp(bal, ids);
    assert.equal(plan.length, bruteMinPayments(vals), `balances ${JSON.stringify(vals)}`);

    // applying the plan zeroes everyone, and all amounts are positive integers
    const after = { ...bal };
    plan.forEach((p) => {
      assert.ok(Number.isSafeInteger(p.amount) && p.amount > 0);
      after[p.from] += p.amount;
      after[p.to] -= p.amount;
    });
    ids.forEach((id) => assert.equal(after[id], 0));
  }
});

test('settleUp beats naive greedy on a known case', () => {
  // Greedy (largest-to-largest) needs 4 payments; optimum is 3 because {a,c} and {b,d,e} each net to zero.
  const bal = { a: 500, b: 400, c: -500, d: -300, e: -100 };
  const plan = M.settleUp(bal, Object.keys(bal));
  assert.equal(plan.length, 3);
});

test('settleUp with all-zero balances returns nothing', () => {
  assert.deepEqual(M.settleUp({ a: 0, b: 0 }, ['a', 'b']), []);
});
