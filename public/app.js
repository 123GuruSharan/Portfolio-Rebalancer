function formatCurrency(value) {
  if (value == null || isNaN(value)) return '-';
  return '₹' + Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPercent(value) {
  if (value == null || isNaN(value)) return '-';
  return Number(value).toFixed(2) + '%';
}

function setStatus(message, type = 'info') {
  const el = document.getElementById('status-message');
  if (!el) return;
  el.textContent = message;
  el.className = 'status-message ' + type;
}

let allocationChartInstance = null;
let valueTrendChartInstance = null;

function createOrUpdateAllocationChart(labels, data) {
  const canvas = document.getElementById('allocationChart');
  if (!canvas || typeof Chart === 'undefined') return;

  if (allocationChartInstance) {
    allocationChartInstance.destroy();
  }

  const ctx = canvas.getContext('2d');

  allocationChartInstance = new Chart(ctx, {
    type: 'pie',
    data: {
      labels,
      datasets: [
        {
          data,
          backgroundColor: [
            '#22c55e',
            '#38bdf8',
            '#a855f7',
            '#f97316',
            '#ef4444',
            '#eab308',
            '#14b8a6',
            '#3b82f6',
          ],
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: '#e5e7eb', font: { size: 11 } },
        },
      },
    },
  });
}

function createOrUpdateValueTrendChart(labels, values) {
  const canvas = document.getElementById('value-trend-chart');
  if (!canvas || typeof Chart === 'undefined') return;

  if (valueTrendChartInstance) {
    valueTrendChartInstance.destroy();
  }

  const ctx = canvas.getContext('2d');

  valueTrendChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Portfolio Value',
          data: values,
          borderColor: '#38bdf8',
          backgroundColor: 'rgba(56, 189, 248, 0.18)',
          tension: 0.25,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: '#e5e7eb', font: { size: 11 } },
        },
      },
      scales: {
        x: {
          ticks: { color: '#9ca3af', maxRotation: 45, minRotation: 0 },
          grid: { color: 'rgba(31,41,55,0.5)' },
        },
        y: {
          ticks: {
            color: '#9ca3af',
            callback: (v) => '₹' + Number(v).toLocaleString(),
          },
          grid: { color: 'rgba(31,41,55,0.5)' },
        },
      },
    },
  });
}

async function loadRebalance() {
  try {
    console.log('Fetching rebalance data...');
    setStatus('Loading rebalance recommendation...', 'info');
    const res = await fetch('/api/rebalance');
    if (!res.ok) {
      // Try to read error details from backend (JSON or text) for better debugging
      let backendMessage = '';
      try {
        const maybeJson = await res.json();
        if (maybeJson && (maybeJson.error || maybeJson.message)) {
          backendMessage = ` (${maybeJson.error || maybeJson.message})`;
        }
      } catch {
        try {
          const text = await res.text();
          backendMessage = text ? ` (${text})` : '';
        } catch {
          // ignore secondary failures reading the body
        }
      }
      throw new Error(
        `Failed to fetch rebalance recommendation. HTTP ${res.status}${backendMessage}`
      );
    }
    const data = await res.json();
    console.log('Rebalance data received:', data);

    const funds = Array.isArray(data.funds) ? data.funds : [];
    const tbody = document.getElementById('rebalance-body');
    tbody.innerHTML = '';

    if (!funds.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 6;
      td.textContent = 'No holdings found for this client.';
      td.className = 'empty-row';
      tr.appendChild(td);
      tbody.appendChild(tr);
    } else {
      funds.forEach((f) => {
        const tr = document.createElement('tr');

        const action = (f.action || '').toUpperCase();
        const rawDrift =
          f.drift != null ? Number(f.drift) : null;

        const fundCell = document.createElement('td');
        fundCell.textContent = `${f.fundName} (${f.fundId})`;
        tr.appendChild(fundCell);

        const currentPctCell = document.createElement('td');
        currentPctCell.textContent = formatPercent(f.currentPct);
        tr.appendChild(currentPctCell);

        const targetPctCell = document.createElement('td');
        // REVIEW funds (not in model) should show "-" for Target %
        if (action === 'REVIEW') {
          targetPctCell.textContent = '-';
        } else {
          targetPctCell.textContent =
            f.targetPct != null ? formatPercent(f.targetPct) : '-';
        }
        tr.appendChild(targetPctCell);

        const driftCell = document.createElement('td');
        // REVIEW funds or null drift show "-" in yellow
        if (action === 'REVIEW' || rawDrift === null || isNaN(rawDrift)) {
          driftCell.textContent = '-';
          driftCell.classList.add('drift-null');
        } else {
          driftCell.textContent = formatPercent(rawDrift);
          if (rawDrift > 0) {
            driftCell.classList.add('drift-positive');
          } else if (rawDrift < 0) {
            driftCell.classList.add('drift-negative');
          } else {
            driftCell.classList.add('drift-neutral');
          }
        }
        tr.appendChild(driftCell);

        const actionCell = document.createElement('td');
        const badge = document.createElement('span');
        badge.classList.add('badge');
        if (action === 'BUY') {
          badge.classList.add('badge-buy');
        } else if (action === 'SELL') {
          badge.classList.add('badge-sell');
        } else if (action === 'REVIEW') {
          badge.classList.add('badge-review');
        } else {
          badge.classList.add('badge-neutral');
        }
        badge.textContent = action || '-';
        actionCell.appendChild(badge);
        tr.appendChild(actionCell);

        const amountCell = document.createElement('td');
        amountCell.textContent = formatCurrency(f.amount);
        tr.appendChild(amountCell);

        // Row highlighting based on action
        if (action === 'BUY') {
          tr.classList.add('row-buy');
        } else if (action === 'SELL') {
          tr.classList.add('row-sell');
        } else if (action === 'REVIEW') {
          tr.classList.add('row-review');
        }

        tbody.appendChild(tr);
      });
    }

    // Update allocation (pie) chart
    if (funds.length) {
      const labels = funds.map((f) => f.fundName || f.fundId || '');
      const percentages = funds.map((f) =>
        Number.isFinite(Number(f.currentPct)) ? Number(f.currentPct) : 0
      );
      createOrUpdateAllocationChart(labels, percentages);
    }

    // Totals - ensure we read from the expected backend response shape
    document.getElementById('total-portfolio').textContent = formatCurrency(
      data.totalPortfolio
    );
    document.getElementById('total-buy').textContent = formatCurrency(
      data.totalBuy
    );
    document.getElementById('total-sell').textContent = formatCurrency(
      data.totalSell
    );
    document.getElementById('cash-needed').textContent = formatCurrency(
      data.cashNeeded
    );

    setStatus('Rebalance recommendation loaded.', 'success');

    // Also refresh the value trend chart and small holdings overview
    loadHistoryForChart();
    loadHoldingsOverview();
  } catch (err) {
    console.error('Error loading rebalance recommendation:', err);
    setStatus('Error loading rebalance recommendation.', 'error');
  }
}

async function saveRecommendation() {
  try {
    setStatus('Saving recommendation...', 'info');

    // Build payload from the latest values rendered on the dashboard
    const totalPortfolioText =
      document.getElementById('total-portfolio')?.textContent || '0';
    const totalBuyText =
      document.getElementById('total-buy')?.textContent || '0';
    const totalSellText =
      document.getElementById('total-sell')?.textContent || '0';
    const cashNeededText =
      document.getElementById('cash-needed')?.textContent || '0';

    const parseMoney = (txt) =>
      Number(String(txt).replace(/[₹,\s]/g, '')) || 0;

    const totalPortfolio = parseMoney(totalPortfolioText);
    const totalBuy = parseMoney(totalBuyText);
    const totalSell = parseMoney(totalSellText);
    const cashNeeded = parseMoney(cashNeededText);

    // Collect funds from the current rebalance table
    const funds = [];
    const rows = document.querySelectorAll('#rebalance-body tr');
    rows.forEach((row) => {
      const cells = row.querySelectorAll('td');
      if (cells.length !== 6) return; // skip placeholder/empty rows

      const fundCellText = cells[0].textContent || '';
      const match = fundCellText.match(/^(.*)\((.*)\)$/);
      const fundName = match ? match[1].trim() : fundCellText.trim();
      const fundId = match ? match[2].trim() : null;

      const currentPct = (cells[1].textContent || '').replace('%', '').trim();
      const targetPct = (cells[2].textContent || '').replace('%', '').trim();
      const drift = (cells[3].textContent || '').replace('%', '').trim();

      const badge = cells[4].querySelector('.badge');
      const action = badge ? badge.textContent.trim().toUpperCase() : null;

      const amount = (cells[5].textContent || '').replace(/[₹,\s]/g, '');

      // Skip non-data rows
      if (!fundName && !fundId) return;

      funds.push({
        fundName,
        fundId,
        currentPct,
        targetPct,
        drift,
        action,
        amount,
      });
    });

    const payload = {
      totalPortfolio,
      totalBuy,
      totalSell,
      cashNeeded,
      funds,
    };

    console.log('Sending /api/save payload:', payload);

    const res = await fetch('/api/save', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      throw new Error('Failed to save recommendation');
    }
    const data = await res.json();
    if (data && data.success) {
      setStatus(`Recommendation saved successfully. Session ID: ${data.sessionId}`, 'success');
    } else {
      setStatus('Recommendation save response was not successful.', 'error');
    }
  } catch (err) {
    console.error(err);
    setStatus('Error saving recommendation.', 'error');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const refreshBtn = document.getElementById('refresh-btn');
  const saveBtn = document.getElementById('save-btn');
  const navTabs = document.querySelectorAll('.nav-tab');
  const modelSaveBtn = document.getElementById('model-save-btn');

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      loadRebalance();
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      saveRecommendation();
    });
  }

  // Navigation between views
  navTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const targetView = tab.getAttribute('data-view');

      // Toggle active tab
      navTabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');

      // Toggle views
      document.querySelectorAll('.view').forEach((section) => {
        if (section.id === `view-${targetView}`) {
          section.classList.remove('hidden');
        } else {
          section.classList.add('hidden');
        }
      });

      // Lazy-load data per screen
      if (targetView === 'dashboard') {
        loadRebalance();
      } else if (targetView === 'holdings') {
        loadHoldings();
      } else if (targetView === 'history') {
        loadHistory();
      } else if (targetView === 'model') {
        loadModel();
      }
    });
  });

  if (modelSaveBtn) {
    modelSaveBtn.addEventListener('click', () => {
      saveModel();
    });
  }

  // Initial load
  loadRebalance();
});

// --- Additional screens ---

async function loadHoldings() {
  try {
    setStatus('Loading holdings...', 'info');
    const res = await fetch('/api/holdings');
    if (!res.ok) {
      throw new Error(`Failed to load holdings. HTTP ${res.status}`);
    }
    const data = await res.json();

    const tbody = document.getElementById('holdings-body');
    tbody.innerHTML = '';

    const holdings = Array.isArray(data.holdings) ? data.holdings : [];
    if (!holdings.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 2;
      td.textContent = 'No holdings found.';
      td.className = 'empty-row';
      tr.appendChild(td);
      tbody.appendChild(tr);
    } else {
      holdings.forEach((h) => {
        const tr = document.createElement('tr');
        const nameCell = document.createElement('td');
        nameCell.textContent = `${h.fundName} (${h.fundId})`;
        const valueCell = document.createElement('td');
        valueCell.textContent = formatCurrency(h.currentValue);
        tr.appendChild(nameCell);
        tr.appendChild(valueCell);
        tbody.appendChild(tr);
      });
    }

    document.getElementById('holdings-total-portfolio').textContent =
      formatCurrency(data.totalPortfolio);

    setStatus('Holdings loaded.', 'success');
  } catch (err) {
    console.error('Error loading holdings:', err);
    setStatus('Error loading holdings.', 'error');
  }
}

async function loadHistory() {
  try {
    setStatus('Loading history...', 'info');
    const res = await fetch('/api/history');
    if (!res.ok) {
      throw new Error(`Failed to load history. HTTP ${res.status}`);
    }
    const data = await res.json();

    const tbody = document.getElementById('history-body');
    tbody.innerHTML = '';

    const sessions = Array.isArray(data.sessions) ? data.sessions : [];
    if (!sessions.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 3;
      td.textContent = 'No rebalance sessions yet.';
      td.className = 'empty-row';
      tr.appendChild(td);
      tbody.appendChild(tr);
    } else {
      sessions.forEach((s) => {
        const tr = document.createElement('tr');

        const dateCell = document.createElement('td');
        // created_at is stored as a SQLite datetime string; show as-is
        dateCell.textContent = s.created_at;

        const valueCell = document.createElement('td');
        valueCell.textContent = formatCurrency(s.portfolio_value);

        const statusCell = document.createElement('td');
        const span = document.createElement('span');
        const status = (s.status || '').toUpperCase();
        span.textContent = status;
        span.classList.add('status-badge');
        if (status === 'PENDING') {
          span.classList.add('pending');
        } else if (status === 'APPLIED') {
          span.classList.add('applied');
        } else if (status === 'DISMISSED') {
          span.classList.add('dismissed');
        }
        statusCell.appendChild(span);

        tr.appendChild(dateCell);
        tr.appendChild(valueCell);
        tr.appendChild(statusCell);
        tbody.appendChild(tr);
      });
    }

    setStatus('History loaded.', 'success');
  } catch (err) {
    console.error('Error loading history:', err);
    setStatus('Error loading history.', 'error');
  }
}

async function loadHistoryForChart() {
  try {
    const res = await fetch('/api/history');
    if (!res.ok) {
      throw new Error(`Failed to load history for chart. HTTP ${res.status}`);
    }
    const data = await res.json();
    const sessions = Array.isArray(data.sessions) ? data.sessions : [];
    if (!sessions.length) return;

    const filtered = sessions.filter(
      (s) => s.portfolio_value && Number(s.portfolio_value) > 0
    );
    if (!filtered.length) return;

    const labels = filtered
      .slice()
      .reverse()
      .map((s) => s.created_at);
    const values = filtered
      .slice()
      .reverse()
      .map((s) => Number(s.portfolio_value) || 0);

    createOrUpdateValueTrendChart(labels, values);
  } catch (err) {
    console.error('Error loading history for chart:', err);
  }
}

async function loadHoldingsOverview() {
  try {
    const res = await fetch('/api/holdings');
    if (!res.ok) return;
    const data = await res.json();
    const tbody = document.getElementById('holdings-overview-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    const holdings = Array.isArray(data.holdings) ? data.holdings : [];
    const subset = holdings.slice(0, 5);

    if (!subset.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 2;
      td.textContent = 'No holdings found.';
      td.className = 'empty-row';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    subset.forEach((h) => {
      const tr = document.createElement('tr');
      const nameCell = document.createElement('td');
      nameCell.textContent = `${h.fundName} (${h.fundId})`;
      const valueCell = document.createElement('td');
      valueCell.textContent = formatCurrency(h.currentValue);
      tr.appendChild(nameCell);
      tr.appendChild(valueCell);
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error loading holdings overview:', err);
  }
}

async function loadModel() {
  try {
    setStatus('Loading model portfolio...', 'info');
    const res = await fetch('/api/model');
    if (!res.ok) {
      throw new Error(`Failed to load model portfolio. HTTP ${res.status}`);
    }
    const data = await res.json();

    const tbody = document.getElementById('model-body');
    tbody.innerHTML = '';

    const funds = Array.isArray(data.funds) ? data.funds : [];
    if (!funds.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 2;
      td.textContent = 'No model funds defined.';
      td.className = 'empty-row';
      tr.appendChild(td);
      tbody.appendChild(tr);
      document.getElementById('model-total-allocation').textContent = '0%';
      return;
    }

    funds.forEach((f) => {
      const tr = document.createElement('tr');

      const nameCell = document.createElement('td');
      nameCell.textContent = `${f.fundName} (${f.fundId})`;

      const targetCell = document.createElement('td');
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.max = '100';
      input.step = '0.01';
      input.value = f.allocationPct != null ? f.allocationPct : 0;
      input.className = 'model-input';
      input.dataset.fundId = f.fundId;
      input.addEventListener('input', updateModelTotal);

      targetCell.appendChild(input);

      tr.appendChild(nameCell);
      tr.appendChild(targetCell);
      tbody.appendChild(tr);
    });

    updateModelTotal();
    setStatus('Model portfolio loaded.', 'success');
  } catch (err) {
    console.error('Error loading model portfolio:', err);
    setStatus('Error loading model portfolio.', 'error');
  }
}

function updateModelTotal() {
  const inputs = document.querySelectorAll('.model-input');
  let total = 0;
  inputs.forEach((input) => {
    const v = Number(input.value);
    if (Number.isFinite(v)) {
      total += v;
    }
  });
  document.getElementById('model-total-allocation').textContent =
    total.toFixed(2) + '%';
}

async function saveModel() {
  try {
    const inputs = document.querySelectorAll('.model-input');
    const funds = [];
    let total = 0;

    inputs.forEach((input) => {
      const fundId = input.dataset.fundId;
      const v = Number(input.value);
      const allocationPct = Number.isFinite(v) ? v : 0;
      total += allocationPct;
      funds.push({ fundId, allocationPct });
    });

    const errorEl = document.getElementById('model-error');
    const totalDisplay = document.getElementById('model-total-allocation');
    totalDisplay.textContent = total.toFixed(2) + '%';

    if (Math.abs(total - 100) > 0.01) {
      errorEl.textContent = 'Total allocation must equal 100%';
      errorEl.classList.remove('hidden');
      setStatus('Model allocation invalid.', 'error');
      return;
    }

    errorEl.textContent = '';
    errorEl.classList.add('hidden');

    setStatus('Saving model portfolio...', 'info');
    const res = await fetch('/api/model/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ funds }),
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => null);
      const msg =
        (errJson && (errJson.error || errJson.message)) ||
        `Failed to save model. HTTP ${res.status}`;
      throw new Error(msg);
    }

    setStatus('Model portfolio updated. Recalculating rebalance...', 'success');
    // Refresh dashboard so new model allocations are reflected
    loadRebalance();
  } catch (err) {
    console.error('Error saving model portfolio:', err);
    setStatus('Error saving model portfolio.', 'error');
  }
}

