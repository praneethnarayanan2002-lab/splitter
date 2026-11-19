# Splitter

Split shared expenses between roommates. Plain HTML/CSS/JS, no build step and no dependencies.

**Run it:** open `index.html` in a browser, or run `npm start` and visit http://localhost:8000.
Data is saved in the browser's `localStorage`, so it survives refreshes but stays on that device and browser.

**Test the money math:** `npm test`

## How the math works (`js/money.js`)

- Every amount is an **integer number of cents**. Percentages are integer **basis points** (100% = 10000). No floating-point money anywhere.
- **Even split:** leftover cents go one each to the first people in the list ($10 / 3 → 3.34, 3.33, 3.33).
- **Percent split:** largest-remainder rounding, so shares always add up to exactly the total.
- **Custom amounts:** must add up to exactly the total, or the form won't save.
- **Balance** = what you paid − your share of everything + payments you sent − payments you received. Balances always sum to zero.
- **Settle up** finds the true minimum number of payments: (people with a non-zero balance) − (the most groups they split into that each net to zero). This is solved exactly for up to 18 people with non-zero balances, with a greedy fallback above that. Tests check it against a brute-force search.
