const API_BASE = window.location.origin;

let currentPage = 1;
const pageSize = 20;
let total = 0;
let currentRows = [];
let editingId = null;
let modalDraft = {};
let sortField = '';
let sortOrder = 'asc';

const fields = [
  { key: 'city', label: '地市' },
  { key: 'company', label: '公司' },
  { key: 'department', label: '部门' },
  { key: 'position', label: '职务' },
  { key: 'name', label: '姓名', required: true },
  { key: 'phone', label: '电话' },
  { key: 'email', label: '邮箱' },
  { key: 'remarks', label: '备注' },
  { key: 'related_project', label: '关联项目' },
];

const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error');
const tableHeadRow = document.getElementById('headerRow');
const tableBody = document.querySelector('#contactsTable tbody');
const searchInput = document.getElementById('searchInput');
const cityFilter = document.getElementById('cityFilter');
const companyFilter = document.getElementById('companyFilter');
const addBtn = document.getElementById('addBtn');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const pageInfo = document.getElementById('pageInfo');
const modalOverlay = document.getElementById('modalOverlay');
const modalTitle = document.getElementById('modalTitle');
const modalForm = document.getElementById('modalForm');
const modalClose = document.getElementById('modalClose');
const saveBtn = document.getElementById('saveBtn');
const cancelBtn = document.getElementById('cancelBtn');
const modalStatus = document.getElementById('modalStatus');

async function init() {
  renderHeader();
  buildModalForm();
  bindEvents();
  await loadFilterOptions();
  loadData();
}

function renderHeader() {
  tableHeadRow.innerHTML = fields.map(f => {
    if (f.key === 'city' || f.key === 'company') {
      const indicator = sortField === f.key ? (sortOrder === 'asc' ? ' ▲' : ' ▼') : '';
      return `<th class="sortable" data-sort="${f.key}">${escapeHtml(f.label)}${indicator}</th>`;
    }
    return `<th>${escapeHtml(f.label)}</th>`;
  }).join('') + '<th>操作</th>';
}

async function loadFilterOptions() {
  try {
    const resp = await fetch(`${API_BASE}/api/contacts/filters`);
    if (!resp.ok) return;
    const result = await resp.json();
    if (!result.success) return;
    const { cities = [], companies = [] } = result.data || {};
    for (const c of cities) {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      cityFilter.appendChild(opt);
    }
    for (const c of companies) {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      companyFilter.appendChild(opt);
    }
  } catch (err) {
    console.error('加载筛选项失败:', err);
  }
}

function buildModalForm() {
  modalForm.innerHTML = `
    <div class="form-group full-width oa-copy-block">
      <label for="oaSearchInput">从公司通讯录复制</label>
      <input type="text" id="oaSearchInput" placeholder="搜索姓名、电话、短号、邮箱，选中后自动填充…" autocomplete="off">
      <div id="oaSearchResults" class="oa-search-results"></div>
    </div>
  ` + fields.map(f => `
    <div class="form-group ${f.key === 'remarks' ? 'full-width' : ''}">
      <label for="field-${f.key}">${escapeHtml(f.label)}${f.required ? ' <span class="required">*</span>' : ''}</label>
      ${f.key === 'remarks'
        ? `<textarea id="field-${f.key}" rows="3"></textarea>`
        : `<input type="${f.key === 'email' ? 'email' : 'text'}" id="field-${f.key}">`}
    </div>
  `).join('');

  modalForm.addEventListener('input', (e) => {
    if (editingId) return; // 仅记录新增时的草稿
    const el = e.target;
    if (!el.id || !el.id.startsWith('field-')) return;
    const key = el.id.replace('field-', '');
    modalDraft[key] = el.value;
  });

  // 公司通讯录搜索（防抖）
  const oaInput = document.getElementById('oaSearchInput');
  let oaTimer = null;
  oaInput.addEventListener('input', () => {
    clearTimeout(oaTimer);
    oaTimer = setTimeout(searchOaContacts, 300);
  });
}

async function searchOaContacts() {
  const input = document.getElementById('oaSearchInput');
  const resultsEl = document.getElementById('oaSearchResults');
  const keyword = input.value.trim();
  if (!keyword) {
    resultsEl.innerHTML = '';
    return;
  }
  try {
    const resp = await fetch(`${API_BASE}/api/company-contacts/search?keyword=${encodeURIComponent(keyword)}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const result = await resp.json();
    if (!result.success) throw new Error(result.error || '搜索失败');
    const rows = result.data || [];
    if (rows.length === 0) {
      resultsEl.innerHTML = '<div class="empty">公司通讯录中未找到匹配人员</div>';
      return;
    }
    resultsEl.innerHTML = rows.map((p, i) => `
      <div class="project-search-item oa-search-item" data-idx="${i}">
        <div class="project-search-info">
          <div class="project-search-code">${escapeHtml(p.name || '')}${p.title ? '（' + escapeHtml(p.title) + '）' : ''}</div>
          <div class="project-search-name" title="${escapeHtml(p.dept_path || '')}">${escapeHtml(p.dept_path || '')} ${escapeHtml(p.mobile_phone || p.short_number || '')}</div>
        </div>
      </div>
    `).join('');
    resultsEl.querySelectorAll('.oa-search-item').forEach(item => {
      item.addEventListener('click', () => fillFromOa(rows[Number(item.dataset.idx)]));
    });
  } catch (err) {
    resultsEl.innerHTML = `<div class="empty">搜索失败：${escapeHtml(err.message)}</div>`;
  }
}

function fillFromOa(person) {
  // 公司统一为江苏移动；地市按部门第一级判断：XX分公司取地市名，其余为省本部
  const firstSeg = String(person.dept_path || '').split(' > ')[0].trim();
  const city = firstSeg.endsWith('分公司') ? firstSeg.replace(/分公司$/, '') : '省本部';
  const mapping = {
    name: person.name,
    phone: person.mobile_phone || person.short_number,
    email: person.email,
    department: person.dept_path,
    position: person.title,
    company: '江苏移动',
    city: city,
  };
  for (const key of Object.keys(mapping)) {
    const el = document.getElementById(`field-${key}`);
    if (!el) continue;
    el.value = mapping[key] || '';
    if (!editingId) modalDraft[key] = el.value;
  }
  document.getElementById('oaSearchResults').innerHTML = '';
  document.getElementById('oaSearchInput').value = '';
}

function bindEvents() {
  addBtn.addEventListener('click', () => openModal());
  modalClose.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
  });
  saveBtn.addEventListener('click', saveContact);

  searchInput.addEventListener('input', () => {
    currentPage = 1;
    loadData();
  });

  cityFilter.addEventListener('change', () => {
    currentPage = 1;
    loadData();
  });

  companyFilter.addEventListener('change', () => {
    currentPage = 1;
    loadData();
  });

  tableHeadRow.addEventListener('click', (e) => {
    const th = e.target.closest('th.sortable');
    if (!th) return;
    const field = th.getAttribute('data-sort');
    if (sortField === field) {
      sortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
    } else {
      sortField = field;
      sortOrder = 'asc';
    }
    currentPage = 1;
    renderHeader();
    loadData();
  });

  prevBtn.addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      loadData();
    }
  });

  nextBtn.addEventListener('click', () => {
    const totalPages = Math.ceil(total / pageSize) || 1;
    if (currentPage < totalPages) {
      currentPage++;
      loadData();
    }
  });

  tableBody.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const id = btn.getAttribute('data-id');
    if (btn.classList.contains('btn-edit')) {
      const row = currentRows.find(r => String(r.id) === id);
      openModal(row);
    } else if (btn.classList.contains('btn-delete')) {
      if (!confirm('确定删除该联系人吗？')) return;
      deleteContact(id);
    }
  });
}

async function loadData() {
  showLoading(true);
  hideError();
  try {
    const keyword = searchInput.value.trim();
    const params = new URLSearchParams({ page: currentPage, pageSize });
    if (keyword) params.append('keyword', keyword);
    if (cityFilter.value) params.append('city', cityFilter.value);
    if (companyFilter.value) params.append('company', companyFilter.value);
    if (sortField) {
      params.append('sort', sortField);
      params.append('order', sortOrder);
    }

    const resp = await fetch(`${API_BASE}/api/contacts?${params.toString()}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const result = await resp.json();
    if (!result.success) throw new Error(result.error || '加载失败');

    total = result.total || 0;
    renderTable(result.data || []);
    updatePagination();
  } catch (err) {
    showError('加载失败：' + err.message);
    tableBody.innerHTML = '';
  } finally {
    showLoading(false);
  }
}

function renderTable(rows) {
  currentRows = rows;
  tableBody.innerHTML = '';
  if (rows.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="${fields.length + 1}" class="empty">暂无数据</td></tr>`;
    return;
  }

  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = fields.map(f => `<td>${escapeHtml(row[f.key] ?? '')}</td>`).join('') +
      `<td>
        <button class="btn-small btn-edit" data-id="${row.id}">编辑</button>
        <button class="btn-small btn-delete" data-id="${row.id}">删除</button>
      </td>`;
    tableBody.appendChild(tr);
  }
}

function updatePagination() {
  const totalPages = Math.ceil(total / pageSize) || 1;
  pageInfo.textContent = `第 ${currentPage} / ${totalPages} 页，共 ${total} 条`;
  prevBtn.disabled = currentPage <= 1;
  nextBtn.disabled = currentPage >= totalPages;
}

function openModal(row = null) {
  editingId = row ? row.id : null;
  modalTitle.textContent = row ? '编辑联系人' : '新增联系人';
  modalStatus.textContent = '';
  modalStatus.className = 'settings-status';

  for (const f of fields) {
    const el = document.getElementById(`field-${f.key}`);
    if (!el) continue;
    if (row) {
      el.value = row[f.key] ?? '';
    } else {
      el.value = modalDraft[f.key] ?? '';
    }
  }

  modalOverlay.style.display = 'flex';
}

function closeModal() {
  modalOverlay.style.display = 'none';
  editingId = null;
}

async function saveContact() {
  const payload = {};
  for (const f of fields) {
    const el = document.getElementById(`field-${f.key}`);
    payload[f.key] = el ? el.value.trim() : '';
  }

  if (!payload.name) {
    showModalStatus('请填写姓名', 'error');
    return;
  }

  saveBtn.disabled = true;
  saveBtn.textContent = '保存中…';
  try {
    const url = editingId ? `${API_BASE}/api/contacts/${editingId}` : `${API_BASE}/api/contacts`;
    const method = editingId ? 'PUT' : 'POST';
    const resp = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await resp.json();
    if (!resp.ok || !result.success) throw new Error(result.error || `保存失败 (${resp.status})`);

    showModalStatus('✅ 保存成功', 'ok');
    modalDraft = {}; // 保存成功后清空草稿
    setTimeout(() => {
      closeModal();
      // 清空表单，避免下次新增时带出已保存的数据
      for (const f of fields) {
        const el = document.getElementById(`field-${f.key}`);
        if (el) el.value = '';
      }
      loadData();
    }, 500);
  } catch (err) {
    showModalStatus('❌ ' + err.message, 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = '保存';
  }
}

async function deleteContact(id) {
  try {
    const resp = await fetch(`${API_BASE}/api/contacts/${id}`, { method: 'DELETE' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    await loadData();
  } catch (err) {
    alert('删除失败：' + err.message);
  }
}

function showModalStatus(message, type) {
  modalStatus.textContent = message;
  modalStatus.className = 'settings-status ' + (type || '');
}

function showLoading(show) {
  loadingEl.style.display = show ? 'block' : 'none';
}

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.style.display = 'block';
}

function hideError() {
  errorEl.style.display = 'none';
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

init();
