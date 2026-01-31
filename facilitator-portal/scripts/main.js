/**
 * Wazabi x402 Facilitator Portal — Main Script
 *
 * API client, form handling, fee preview, tabs, copy-to-clipboard, scroll animations.
 */

// ============================================================================
// Config
// ============================================================================

const API_BASE = window.location.hostname === 'localhost'
  ? 'http://localhost:3000'
  : 'https://facilitator.wazabi.ai';

const FEE_RATE = 0.005; // 0.5%
const EST_GAS  = 0.02;

// ============================================================================
// API Client
// ============================================================================

async function api(path, opts = {}) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data?.error ?? data?.message ?? `Request failed (${res.status})`;
    throw new ApiError(msg, res.status, data);
  }
  return data;
}

class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

// ============================================================================
// DOM Helpers
// ============================================================================

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

function show(el) { el.hidden = false; }
function hide(el) { el.hidden = true; }

function toast(msg, type = 'info') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast toast-${type}`;
  show(t);
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => hide(t), 4000);
}

function setLoading(btn, loading) {
  if (loading) {
    btn.disabled = true;
    btn._origHTML = btn.innerHTML;
    btn.innerHTML = '<span class="spinner"></span> Processing...';
  } else {
    btn.disabled = false;
    if (btn._origHTML) btn.innerHTML = btn._origHTML;
  }
}

function truncAddr(addr) {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ============================================================================
// Navigation
// ============================================================================

const navToggle = $('#navToggle');
const navLinks  = $('#navLinks');
const nav       = $('#nav');

navToggle?.addEventListener('click', () => {
  navToggle.classList.toggle('active');
  navLinks.classList.toggle('open');
});

// Close mobile menu on link click
$$('.nav-links a').forEach(a => {
  a.addEventListener('click', () => {
    navToggle.classList.remove('active');
    navLinks.classList.remove('open');
  });
});

// Scroll shadow
window.addEventListener('scroll', () => {
  const y = window.scrollY;
  if (y > 20) {
    nav.style.background = 'rgba(240,242,245,.95)';
    nav.style.boxShadow = '0 2px 12px rgba(0,0,0,0.06)';
  } else {
    nav.style.background = 'rgba(240,242,245,.85)';
    nav.style.boxShadow = 'none';
  }
}, { passive: true });

// ============================================================================
// Register Form
// ============================================================================

$('#registerForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#registerBtn');
  const resultEl = $('#registerResult');
  const errorEl  = $('#registerError');

  hide(resultEl);
  hide(errorEl);
  setLoading(btn, true);

  try {
    const handle = $('#handleInput').value.trim().toLowerCase();
    const networks = $$('input[name="networks"]:checked').map(c => c.value);
    const owner = $('#ownerInput').value.trim() || undefined;

    if (networks.length === 0) {
      throw new Error('Select at least one network.');
    }

    const data = await api('/register', {
      method: 'POST',
      body: JSON.stringify({ handle, networks, owner_address: owner }),
    });

    // Populate result
    $('#resultHandle').textContent = data.handle;
    $('#resultWallet').textContent = data.wallet?.address ?? '--';
    $('#resultWalletType').textContent = data.wallet?.type ?? 'ERC-4337';
    $('#resultSessionKey').textContent = data.session_key?.private ?? '--';

    show(resultEl);
    toast('Handle registered successfully', 'success');

  } catch (err) {
    $('#registerErrorMsg').textContent = err.message;
    show(errorEl);
    toast('Registration failed', 'error');
  } finally {
    setLoading(btn, false);
  }
});

// ============================================================================
// Lookup Tabs
// ============================================================================

let activeTab = 'resolve';

$$('#lookupTabs .tab').forEach(tab => {
  tab.addEventListener('click', () => {
    $$('#lookupTabs .tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    activeTab = tab.dataset.tab;
    hide($('#lookupResult'));
    hide($('#lookupError'));
  });
});

$('#lookupForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#lookupBtn');
  const resultEl = $('#lookupResult');
  const errorEl  = $('#lookupError');

  hide(resultEl);
  hide(errorEl);
  setLoading(btn, true);

  try {
    const handle = $('#lookupHandle').value.trim();
    let endpoint;

    switch (activeTab) {
      case 'resolve': endpoint = `/resolve/${encodeURIComponent(handle)}`; break;
      case 'balance': endpoint = `/balance/${encodeURIComponent(handle)}`; break;
      case 'profile': endpoint = `/profile/${encodeURIComponent(handle)}`; break;
    }

    const data = await api(endpoint);
    resultEl.innerHTML = renderLookupResult(activeTab, data);
    show(resultEl);

  } catch (err) {
    $('#lookupErrorMsg').textContent = err.message;
    show(errorEl);
  } finally {
    setLoading(btn, false);
  }
});

function renderLookupResult(tab, data) {
  if (tab === 'resolve') {
    return `
      <div class="result-header">
        <span class="result-icon result-success">&#10003;</span>
        <h3 class="result-title">Resolved</h3>
      </div>
      <div class="result-body">
        <div class="result-field">
          <span class="result-label">Handle</span>
          <span class="result-value">${escapeHtml(data.handle ?? '--')}</span>
        </div>
        <div class="result-field">
          <span class="result-label">Wallet Address</span>
          <span class="result-value result-mono">${escapeHtml(data.address ?? '--')}</span>
        </div>
        <div class="result-field">
          <span class="result-label">Wallet Type</span>
          <span class="result-value">${escapeHtml(data.wallet_type ?? '--')}</span>
        </div>
      </div>`;
  }

  if (tab === 'balance') {
    const balances = data.balances ?? [];
    const rows = balances.map(b => `
      <div class="result-field">
        <span class="result-label">${escapeHtml(b.token)} (${escapeHtml(b.network)})</span>
        <span class="result-value result-mono">${escapeHtml(b.balance)}</span>
      </div>`).join('');
    return `
      <div class="result-header">
        <span class="result-icon result-success">&#10003;</span>
        <h3 class="result-title">Balances for ${escapeHtml(data.handle ?? data.address ?? '--')}</h3>
      </div>
      <div class="result-body">${rows || '<p style="color:var(--text-muted)">No balances found.</p>'}</div>`;
  }

  if (tab === 'profile') {
    const deployed = data.wallet?.deployed
      ? Object.entries(data.wallet.deployed).map(([n, d]) => `${n}: ${d ? 'Yes' : 'No'}`).join(', ')
      : '--';
    return `
      <div class="result-header">
        <span class="result-icon result-success">&#10003;</span>
        <h3 class="result-title">Profile</h3>
      </div>
      <div class="result-body">
        <div class="result-field">
          <span class="result-label">Handle</span>
          <span class="result-value">${escapeHtml(data.handle ?? '--')}</span>
        </div>
        <div class="result-field">
          <span class="result-label">Wallet</span>
          <span class="result-value result-mono">${escapeHtml(data.wallet?.address ?? '--')}</span>
        </div>
        <div class="result-field">
          <span class="result-label">Deployed</span>
          <span class="result-value">${escapeHtml(deployed)}</span>
        </div>
        <div class="result-field">
          <span class="result-label">Created</span>
          <span class="result-value">${escapeHtml(data.created_at ? new Date(data.created_at).toLocaleString() : '--')}</span>
        </div>
      </div>`;
  }

  return '<p style="color:var(--text-muted)">Unknown tab</p>';
}

// ============================================================================
// Settle Form + Fee Preview
// ============================================================================

const amountInput = $('#settleAmount');
amountInput?.addEventListener('input', updateFeePreview);

function updateFeePreview() {
  const raw = parseFloat(amountInput?.value);
  if (isNaN(raw) || raw <= 0) {
    $('#feeGross').textContent = '--';
    $('#feeFee').textContent   = '--';
    $('#feeGas').textContent   = '--';
    $('#feeNet').textContent   = '--';
    return;
  }
  const fee = (raw * FEE_RATE).toFixed(4);
  const net = (raw - parseFloat(fee) - EST_GAS).toFixed(4);
  $('#feeGross').textContent = `$${raw.toFixed(4)}`;
  $('#feeFee').textContent   = `$${fee}`;
  $('#feeGas').textContent   = `$${EST_GAS.toFixed(4)}`;
  $('#feeNet').textContent   = `$${parseFloat(net) > 0 ? net : '0.0000'}`;
}

$('#settleForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#settleBtn');
  const resultEl = $('#settleResult');
  const errorEl  = $('#settleError');

  hide(resultEl);
  hide(errorEl);
  setLoading(btn, true);

  try {
    const body = {
      from:    $('#settleFrom').value.trim(),
      to:      $('#settleTo').value.trim(),
      amount:  $('#settleAmount').value.trim(),
      token:   $('#settleToken').value,
      network: $('#settleNetwork').value,
    };

    const data = await api('/settle', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    resultEl.innerHTML = `
      <div class="result-header">
        <span class="result-icon result-success">&#10003;</span>
        <h3 class="result-title">Payment Settled</h3>
      </div>
      <div class="result-body">
        <div class="result-field">
          <span class="result-label">Tx Hash</span>
          <span class="result-value result-mono">${escapeHtml(data.tx_hash ?? '--')}</span>
        </div>
        <div class="result-field">
          <span class="result-label">From</span>
          <span class="result-value">${escapeHtml(data.from ?? '--')}</span>
        </div>
        <div class="result-field">
          <span class="result-label">To</span>
          <span class="result-value">${escapeHtml(data.to ?? '--')}</span>
        </div>
        <div class="result-field">
          <span class="result-label">Gross</span>
          <span class="result-value">$${escapeHtml(data.settlement?.gross ?? '--')}</span>
        </div>
        <div class="result-field">
          <span class="result-label">Fee</span>
          <span class="result-value">$${escapeHtml(data.settlement?.fee ?? '--')}</span>
        </div>
        <div class="result-field">
          <span class="result-label">Gas</span>
          <span class="result-value">$${escapeHtml(data.settlement?.gas ?? '--')}</span>
        </div>
        <div class="result-field">
          <span class="result-label">Net</span>
          <span class="result-value" style="color:var(--green)">$${escapeHtml(data.settlement?.net ?? '--')}</span>
        </div>
      </div>`;
    show(resultEl);
    toast('Payment settled successfully', 'success');

  } catch (err) {
    errorEl.innerHTML = `
      <div class="result-header">
        <span class="result-icon result-error">&#10007;</span>
        <h3 class="result-title">Settlement Failed</h3>
      </div>
      <p class="result-error-msg">${escapeHtml(err.message)}</p>`;
    show(errorEl);
    toast('Settlement failed', 'error');
  } finally {
    setLoading(btn, false);
  }
});

// ============================================================================
// History
// ============================================================================

let historyState = { handle: '', offset: 0, limit: 20, total: 0 };

$('#historyForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  historyState.handle = $('#historyHandle').value.trim();
  historyState.offset = 0;
  await loadHistory();
});

async function loadHistory() {
  const resultEl = $('#historyResult');
  const emptyEl  = $('#historyEmpty');
  const errorEl  = $('#historyError');

  hide(resultEl);
  hide(emptyEl);
  hide(errorEl);

  try {
    const { handle, offset, limit } = historyState;
    const data = await api(`/history/${encodeURIComponent(handle)}?limit=${limit}&offset=${offset}`);

    const txs = data.transactions ?? [];
    historyState.total = data.pagination?.total ?? txs.length;

    if (txs.length === 0) {
      show(emptyEl);
      return;
    }

    const tbody = $('#historyBody');
    tbody.innerHTML = txs.map(tx => {
      const isSent = tx.type === 'payment_sent';
      return `<tr>
        <td><span class="${isSent ? 'badge-sent' : 'badge-received'}">${isSent ? 'Sent' : 'Received'}</span></td>
        <td>$${escapeHtml(tx.amount)}</td>
        <td>$${escapeHtml(tx.fee)}</td>
        <td>${escapeHtml(tx.token)}</td>
        <td title="${escapeHtml(isSent ? tx.to : tx.from)}">${escapeHtml(truncAddr(isSent ? tx.to : tx.from))}</td>
        <td>${escapeHtml(tx.network)}</td>
        <td>${tx.timestamp ? new Date(tx.timestamp).toLocaleString() : '--'}</td>
      </tr>`;
    }).join('');

    // Pagination
    renderPagination();
    show(resultEl);

  } catch (err) {
    errorEl.innerHTML = `
      <div class="result-header">
        <span class="result-icon result-error">&#10007;</span>
        <h3 class="result-title">Error</h3>
      </div>
      <p class="result-error-msg">${escapeHtml(err.message)}</p>`;
    show(errorEl);
  }
}

function renderPagination() {
  const { offset, limit, total } = historyState;
  const pagEl = $('#historyPagination');
  const page  = Math.floor(offset / limit) + 1;
  const pages = Math.ceil(total / limit);

  if (pages <= 1) {
    pagEl.innerHTML = '';
    return;
  }

  pagEl.innerHTML = `
    <button id="prevPage" ${page <= 1 ? 'disabled' : ''}>Prev</button>
    <span class="page-info">Page ${page} of ${pages}</span>
    <button id="nextPage" ${page >= pages ? 'disabled' : ''}>Next</button>`;

  $('#prevPage')?.addEventListener('click', () => {
    historyState.offset = Math.max(0, offset - limit);
    loadHistory();
  });
  $('#nextPage')?.addEventListener('click', () => {
    historyState.offset = offset + limit;
    loadHistory();
  });
}

// ============================================================================
// Copy to Clipboard
// ============================================================================

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn-copy');
  if (!btn) return;

  const targetId = btn.dataset.copy;
  const el = document.getElementById(targetId);
  if (!el) return;

  navigator.clipboard.writeText(el.textContent).then(() => {
    toast('Copied to clipboard', 'success');
  }).catch(() => {
    toast('Copy failed', 'error');
  });
});

// ============================================================================
// Scroll Reveal Animations
// ============================================================================

function initReveal() {
  // Add reveal class to sections
  $$('.section, .hero').forEach(el => el.classList.add('reveal'));

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
      }
    });
  }, { threshold: 0.1 });

  $$('.reveal').forEach(el => observer.observe(el));
}

// ============================================================================
// Init
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  initReveal();
  updateFeePreview();
});
