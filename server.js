const path = require('path');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = 3000;

// Path to the existing SQLite database file
const DB_PATH = path.join(__dirname, 'model_portfolio.db');

// Create SQLite connection
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Failed to connect to SQLite database:', err.message);
  } else {
    console.log('Connected to SQLite database at', DB_PATH);
  }
});

app.use(express.json());

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

const CLIENT_ID = 'C001';
const CLIENT_NAME = 'Amit Sharma';

/**
 * Helper to run a SELECT query and return all rows as a Promise.
 */
function allAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        return reject(err);
      }
      resolve(rows);
    });
  });
}

/**
 * Helper to run an INSERT/UPDATE/DELETE and resolve with lastID/changes.
 */
function runAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) {
        return reject(err);
      }
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

/**
 * Core calculation for portfolio rebalance for a given client.
 * Returns an object with funds, totals, and cashNeeded.
 */
async function calculateRebalance(clientId) {
  console.log('--- Rebalance calculation started for client:', clientId, '---');

  // 1. Fetch client holdings
  console.log('Step 1: Fetching client holdings from client_holdings table...');
  const holdingsSql = `
    SELECT fund_id, fund_name, current_value
    FROM client_holdings
    WHERE client_id = ?
  `;
  const holdings = await allAsync(holdingsSql, [clientId]);
  console.log('Fetched holdings:', holdings);

  if (!holdings || holdings.length === 0) {
    console.log('No holdings found for client. Returning empty results.');
    return {
      clientId,
      clientName: CLIENT_NAME,
      funds: [],
      totalPortfolio: 0,
      totalBuy: 0,
      totalSell: 0,
      cashNeeded: 0,
    };
  }

  // 2. Fetch model portfolio
  console.log('Step 2: Fetching model portfolio from model_funds table...');
  const modelSql = `
    SELECT fund_id, fund_name, allocation_pct
    FROM model_funds
  `;
  const modelFunds = await allAsync(modelSql);
  console.log('Fetched model funds:', modelFunds);

  const modelByFundId = new Map();
  for (const mf of modelFunds) {
    modelByFundId.set(mf.fund_id, mf);
  }

  // 3. Calculate total portfolio value
  console.log('Step 3: Calculating total portfolio value...');
  let totalPortfolio = 0;
  for (const h of holdings) {
    totalPortfolio += Number(h.current_value) || 0;
  }
  console.log('Total portfolio value:', totalPortfolio);

  if (totalPortfolio === 0) {
    console.log('Total portfolio is zero. Returning zeroed results.');
    return {
      clientId,
      clientName: CLIENT_NAME,
      funds: holdings.map((h) => ({
        fundId: h.fund_id,
        fundName: h.fund_name,
        currentValue: Number(h.current_value) || 0,
        currentPct: 0,
        targetPct: null,
        drift: null,
        action: 'REVIEW',
        amount: Number(h.current_value) || 0,
      })),
      totalPortfolio: 0,
      totalBuy: 0,
      totalSell: 0,
      cashNeeded: 0,
    };
  }

  // 4 & 5 & 6. Calculate per-fund metrics and actions
  console.log('Step 4/5/6: Calculating per-fund current %, target %, drift, and action...');
  const funds = [];
  let totalBuy = 0;
  let totalSell = 0;

  for (const h of holdings) {
    const currentValue = Number(h.current_value) || 0;
    const currentPct = (currentValue / totalPortfolio) * 100;
    const modelFund = modelByFundId.get(h.fund_id);

    let targetPct = null;
    let drift = null;
    let action = 'REVIEW';
    let amount = currentValue;

    if (modelFund) {
      // Fund exists in model_funds
      targetPct = Number(modelFund.allocation_pct) || 0;
      drift = targetPct - currentPct;
      amount = (drift * totalPortfolio) / 100;

      if (amount > 0) {
        action = 'BUY';
        totalBuy += amount;
      } else if (amount < 0) {
        action = 'SELL';
        totalSell += Math.abs(amount);
      } else {
        action = 'HOLD';
      }
    } else {
      // Fund NOT in model_funds
      action = 'REVIEW';
      amount = currentValue;
    }

    console.log(
      `Fund ${h.fund_id} | currentValue=${currentValue} | currentPct=${currentPct.toFixed(
        2
      )} | targetPct=${targetPct} | drift=${drift} | action=${action} | amount=${amount}`
    );

    funds.push({
      fundId: h.fund_id,
      fundName: h.fund_name,
      currentValue,
      currentPct,
      targetPct,
      drift,
      action,
      amount,
    });
  }

  // 7. Calculate cash needed
  console.log('Step 7: Calculating totals and cash needed...');
  const cashNeeded = totalBuy - totalSell;

  // Round values to 2 decimal places for output consistency
  const round2 = (v) => Math.round(v * 100) / 100;

  const result = {
    clientId,
    clientName: CLIENT_NAME,
    funds: funds.map((f) => ({
      ...f,
      currentPct: round2(f.currentPct),
      targetPct: f.targetPct != null ? round2(f.targetPct) : null,
      drift: f.drift != null ? round2(f.drift) : null,
      amount: round2(f.amount),
    })),
    totalPortfolio: round2(totalPortfolio),
    totalBuy: round2(totalBuy),
    totalSell: round2(totalSell),
    cashNeeded: round2(cashNeeded),
  };

  console.log('Rebalance calculation result:', result);
  console.log('--- Rebalance calculation finished ---');

  return result;
}

// GET /api/rebalance - Calculate portfolio rebalance recommendation
app.get('/api/rebalance', async (req, res) => {
  try {
    const data = await calculateRebalance(CLIENT_ID);
    res.json(data);
  } catch (err) {
    console.error('Error in /api/rebalance:', err);
    res.status(500).json({ error: 'Failed to calculate rebalance recommendation.' });
  }
});

// GET /api/holdings - Current holdings for the client
app.get('/api/holdings', async (req, res) => {
  try {
    const sql = `
      SELECT fund_id, fund_name, current_value
      FROM client_holdings
      WHERE client_id = ?
    `;
    const rows = await allAsync(sql, [CLIENT_ID]);

    let totalPortfolio = 0;
    const holdings = rows.map((r) => {
      const currentValue = Number(r.current_value) || 0;
      totalPortfolio += currentValue;
      return {
        fundId: r.fund_id,
        fundName: r.fund_name,
        currentValue,
      };
    });

    res.json({ holdings, totalPortfolio });
  } catch (err) {
    console.error('Error in /api/holdings:', err);
    res.status(500).json({ error: 'Failed to load holdings.' });
  }
});

// GET /api/history - Rebalance session history
app.get('/api/history', async (req, res) => {
  try {
    const sql = `
      SELECT session_id, created_at, portfolio_value, status
      FROM rebalance_sessions
      WHERE portfolio_value > 0
      ORDER BY datetime(created_at) DESC
    `;
    const sessions = await allAsync(sql);
    res.json({ sessions });
  } catch (err) {
    console.error('Error in /api/history:', err);
    res.status(500).json({ error: 'Failed to load history.' });
  }
});

// GET /api/model - Model portfolio allocations
app.get('/api/model', async (req, res) => {
  try {
    const sql = `
      SELECT fund_id, fund_name, allocation_pct
      FROM model_funds
    `;
    const rows = await allAsync(sql);
    const funds = rows.map((r) => ({
      fundId: r.fund_id,
      fundName: r.fund_name,
      allocationPct: Number(r.allocation_pct) || 0,
    }));
    res.json({ funds });
  } catch (err) {
    console.error('Error in /api/model:', err);
    res.status(500).json({ error: 'Failed to load model portfolio.' });
  }
});

// POST /api/model/update - Update model portfolio allocation percentages
app.post('/api/model/update', async (req, res) => {
  try {
    const body = req.body || {};
    const funds = Array.isArray(body.funds) ? body.funds : [];

    if (!funds.length) {
      return res.status(400).json({ error: 'No funds provided for update.' });
    }

    const totalAllocation = funds.reduce((sum, f) => {
      const v = Number(f.allocationPct ?? f.allocation_pct);
      return sum + (Number.isFinite(v) ? v : 0);
    }, 0);

    // Allow for small floating point rounding differences
    if (Math.abs(totalAllocation - 100) > 0.01) {
      return res
        .status(400)
        .json({ error: 'Total allocation must equal exactly 100%.' });
    }

    await runAsync('BEGIN TRANSACTION');

    for (const f of funds) {
      const fundId = f.fundId ?? f.fund_id;
      const allocation = Number(f.allocationPct ?? f.allocation_pct) || 0;
      await runAsync(
        'UPDATE model_funds SET allocation_pct = ? WHERE fund_id = ?',
        [allocation, fundId]
      );
    }

    await runAsync('COMMIT');

    res.json({ success: true });
  } catch (err) {
    console.error('Error in /api/model/update:', err);
    try {
      await runAsync('ROLLBACK');
    } catch (rollbackErr) {
      console.error('Error rolling back model update transaction:', rollbackErr);
    }
    res.status(500).json({ error: 'Failed to update model portfolio.' });
  }
});

// POST /api/save - Save rebalance recommendation to database
// Expects JSON body:
// {
//   funds: [],
//   totalPortfolio,
//   totalBuy,
//   totalSell,
//   cashNeeded
// }
app.post('/api/save', async (req, res) => {
  console.log('--- Save recommendation (from client payload) triggered for client:', CLIENT_ID, '---');

  // Helper to safely coerce potentially null/undefined values to numbers without crashing
  const toNumberOrZero = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  };

  try {
    const body = req.body || {};
    const funds = Array.isArray(body.funds) ? body.funds : [];

    const totalPortfolio = toNumberOrZero(body.totalPortfolio);
    const totalBuy = toNumberOrZero(body.totalBuy);
    const totalSell = toNumberOrZero(body.totalSell);
    const cashNeeded = toNumberOrZero(body.cashNeeded);

    console.log('Incoming /api/save payload totals:', {
      totalPortfolio,
      totalBuy,
      totalSell,
      cashNeeded,
      fundsCount: funds.length,
    });

    // Basic validation to prevent saving sessions with invalid portfolio values.
    console.log('Saving rebalance session:', totalPortfolio);
    if (!totalPortfolio || totalPortfolio <= 0) {
      return res.status(400).json({ error: 'Invalid portfolio value' });
    }

    // 1. Insert a new session into rebalance_sessions and capture the generated session_id.
    const sessionInsertSql = `
      INSERT INTO rebalance_sessions
      (client_id, created_at, portfolio_value, total_to_buy, total_to_sell, net_cash_needed, status)
      VALUES (?, datetime('now'), ?, ?, ?, ?, 'PENDING')
    `;

    const sessionId = await new Promise((resolve, reject) => {
      // Prepared statement for session insert; this allows SQLite to reuse the plan safely.
      const stmt = db.prepare(sessionInsertSql);

      stmt.run(
        CLIENT_ID,
        totalPortfolio,
        totalBuy,
        totalSell,
        cashNeeded,
        function (err) {
          if (err) {
            console.error('Error inserting into rebalance_sessions:', err);
            // Finalize before rejecting to avoid leaking the statement.
            return stmt.finalize(() => reject(err));
          }

          // this.lastID is how we capture the auto-incremented session_id from SQLite.
          const newSessionId = this.lastID;
          console.log('Created rebalance_session with session_id:', newSessionId);

          stmt.finalize((finalizeErr) => {
            if (finalizeErr) {
              console.error('Error finalizing rebalance_sessions statement:', finalizeErr);
            }
            resolve(newSessionId);
          });
        }
      );
    });

    // 2. If no funds were provided, we are done after creating the session.
    if (!funds.length) {
      console.log('No funds provided in /api/save payload; only rebalance_session inserted.');
      return res.json({ success: true });
    }

    // 3. Insert each rebalance item into rebalance_items using a prepared statement.
    const itemInsertSql = `
      INSERT INTO rebalance_items
      (session_id, fund_id, fund_name, action, amount, current_pct, target_pct, post_rebalance_pct, is_model_fund)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await new Promise((resolve) => {
      const stmt = db.prepare(itemInsertSql);

      let index = 0;

      const insertNext = () => {
        if (index >= funds.length) {
          // Once all items are processed, finalize the statement.
          return stmt.finalize((finalizeErr) => {
            if (finalizeErr) {
              console.error('Error finalizing rebalance_items statement:', finalizeErr);
            }
            resolve();
          });
        }

        const f = funds[index++] || {};

        // Gracefully handle missing/null fields; SQLite will accept null for nullable columns.
        const fundId = f.fundId ?? f.fund_id ?? null;
        const fundName = f.fundName ?? f.fund_name ?? null;
        const action = f.action ?? null;
        const amount = toNumberOrZero(f.amount);
        const currentPct = toNumberOrZero(f.currentPct ?? f.current_pct);
        const targetPct = toNumberOrZero(f.targetPct ?? f.target_pct);
        const postRebalancePct = toNumberOrZero(f.postRebalancePct ?? f.post_rebalance_pct);

        // Convert various truthy/falsy forms into 0/1; default to 1 if it looks like a model fund.
        let isModelFund = f.isModelFund ?? f.is_model_fund;
        if (isModelFund === true) isModelFund = 1;
        if (isModelFund === false || isModelFund == null) {
          isModelFund = targetPct !== 0 ? 1 : 0;
        }

        stmt.run(
          sessionId,
          fundId,
          fundName,
          action,
          amount,
          currentPct,
          targetPct,
          postRebalancePct,
          isModelFund,
          (err) => {
            if (err) {
              // We log the error but do NOT reject the whole promise so that
              // one bad row does not crash the API or prevent other items from saving.
              console.error(
                'Error inserting rebalance_item for fund',
                fundId,
                'with payload',
                f,
                err
              );
            } else {
              console.log(
                'Inserted rebalance_item for fund',
                fundId,
                'action',
                action,
                'amount',
                amount
              );
            }

            // Proceed to the next fund regardless of error on this one.
            insertNext();
          }
        );
      };

      insertNext();
    });

    console.log('--- Save recommendation (from client payload) completed successfully ---');
    res.json({ success: true });
  } catch (err) {
    // Top-level error handler for the route ensures the API never crashes.
    console.error('Error in /api/save:', err);
    res.status(500).json({ error: 'Failed to save rebalance recommendation.' });
  }
});

// Fallback route: serve index.html for root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Portfolio Rebalancer server running at http://localhost:${PORT}`);
  console.log(`Using client_id=${CLIENT_ID}, client_name=${CLIENT_NAME}`);
});
