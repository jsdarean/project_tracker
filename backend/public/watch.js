const API_BASE = window.location.origin;

let currentPage = 1;
const pageSize = 10;
let total = 0;
let currentRows = [];
let watchTags = [];
let sortField = 'approval_date';
let sortOrder = 'asc';

const sortableKeys = new Set(['project_code', 'project_name', 'approval_date', 'project_set', 'project_subset', 'investment_person', 'maintenance_person']);

const columns = [
  { key: '_watch_type', label: '关注类型' },
  { key: 'project_code', label: '项目编码' },
  { key: 'project_name', label: '项目名称' },
  { key: 'approval_date', label: '立项批复日期' },
  { key: 'project_set', label: '项目集' },
  { key: 'project_subset', label: '项目子集' },
  { key: 'investment_person', label: '项目投资责任人' },
  { key: 'maintenance_person', label: '项目维护责任人' },
  { key: '_progress', label: '关注原因及进展' },
  { key: '_action', label: '操作' },
];

const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error');
const tableHeadRow = document.getElementById('headerRow');
const tableBody = document.querySelector('#watchTable tbody');
const searchInput = document.getElementById('searchInput');
const addBtn = document.getElementById('addBtn');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const pageInfo = document.getElementById('pageInfo');

// 添加关注弹窗
const addModal = document.getElementById('addModal');
const addModalClose = document.getElementById('addModalClose');
const projectSearchInput = document.getElementById('projectSearchInput');
const projectSearchResult = document.getElementById('projectSearchResult');
const addModalStatus = document.getElementById('addModalStatus');

// 进展弹窗
const progressModal = document.getElementById('progressModal');
const progressModalClose = document.getElementById('progressModalClose');
const progressModalTitle = document.getElementById('progressModalTitle');
const progressModalStatus = document.getElementById('progressModalStatus');
const newProgressText = document.getElementById('newProgressText');
const addProgressBtn = document.getElementById('addProgressBtn');
const progressList = document.getElementById('progressList');

let currentWatchId = null;
let currentTagWatchId = null;

// 变更关注类型弹窗
const tagModal = document.getElementById('tagModal');
const tagModalTitle = document.getElementById('tagModalTitle');
const tagModalClose = document.getElementById('tagModalClose');
const tagModalStatus = document.getElementById('tagModalStatus');
const editTagSelect = document.getElementById('editTagSelect');
const saveTagBtn = document.getElementById('saveTagBtn');
const cancelTagBtn = document.getElementById('cancelTagBtn');

function openTagModal(watchId) {
  currentTagWatchId = watchId;
  const row = currentRows.find(r => String(r.id) === String(watchId));
  tagModalTitle.textContent = `变更关注类型 - ${row ? (row.project_name || '') : ''}`;
  tagModalStatus.textContent = '';
  const selected = String(row && row.watch_type || '').split(',').map(s => s.trim()).filter(Boolean);
  renderTagSelect(editTagSelect, selected);
  tagModal.style.display = 'flex';
}

function closeTagModal() {
  tagModal.style.display = 'none';
  currentTagWatchId = null;
}

async function saveTag() {
  if (!currentTagWatchId) return;
  const names = getSelectedTagNames(editTagSelect);
  saveTagBtn.disabled = true;
  try {
    const resp = await fetch(`${API_BASE}/api/watch-projects/${currentTagWatchId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ watch_type: names.join(',') }),
    });
    const result = await resp.json();
    if (!resp.ok || !result.success) throw new Error(result.error || '保存失败');
    tagModalStatus.textContent = '✅ 已保存';
    tagModalStatus.className = 'settings-status ok';
    setTimeout(() => {
      closeTagModal();
      loadData();
    }, 400);
  } catch (err) {
    tagModalStatus.textContent = '❌ ' + err.message;
    tagModalStatus.className = 'settings-status error';
  } finally {
    saveTagBtn.disabled = false;
  }
}

async function init() {
  renderHeader();
  bindEvents();
  await loadWatchTags();
  renderTagSelect(document.getElementById('addTagSelect'), []);
  loadData();
}

async function loadWatchTags() {
  try {
    const resp = await fetch(`${API_BASE}/api/settings`);
    if (!resp.ok) return;
    const result = await resp.json();
    if (result.success && Array.isArray(result.data.watch_tags)) {
      watchTags = result.data.watch_tags;
    }
  } catch (err) {
    console.error('加载关注标签配置失败:', err);
  }
}

function getTagColor(name) {
  const tag = watchTags.find(t => t.name === name);
  return tag ? tag.color : '#533afd';
}

function renderTagSelect(container, selectedNames) {
  container.innerHTML = '';
  if (watchTags.length === 0) {
    container.innerHTML = '<span style="color: var(--ink-mute); font-size: 13px;">暂无标签，可先在设置页配置</span>';
    return;
  }
  for (const tag of watchTags) {
    const el = document.createElement('span');
    el.className = 'watch-tag-option' + (selectedNames.includes(tag.name) ? ' selected' : '');
    el.dataset.name = tag.name;
    el.innerHTML = `<span class="watch-tag-dot" style="background:${tag.color}"></span>${escapeHtml(tag.name)}`;
    el.addEventListener('click', () => el.classList.toggle('selected'));
    container.appendChild(el);
  }
}

function getSelectedTagNames(container) {
  return Array.from(container.querySelectorAll('.watch-tag-option.selected')).map(el => el.dataset.name);
}

function renderHeader() {
  tableHeadRow.innerHTML = columns.map(c => {
    if (sortableKeys.has(c.key)) {
      const indicator = sortField === c.key ? (sortOrder === 'asc' ? ' ▲' : ' ▼') : '';
      return `<th class="sortable" data-sort="${c.key}">${escapeHtml(c.label)}${indicator}</th>`;
    }
    return `<th>${escapeHtml(c.label)}</th>`;
  }).join('');
}

function bindEvents() {
  addBtn.addEventListener('click', openAddModal);
  addModalClose.addEventListener('click', closeAddModal);
  addModal.addEventListener('click', (e) => {
    if (e.target === addModal) closeAddModal();
  });

  progressModalClose.addEventListener('click', closeProgressModal);
  progressModal.addEventListener('click', (e) => {
    if (e.target === progressModal) closeProgressModal();
  });
  addProgressBtn.addEventListener('click', addProgress);

  let searchTimer = null;
  projectSearchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(searchProjects, 300);
  });

  searchInput.addEventListener('input', () => {
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

  tableBody.addEventListener('click', async (e) => {
    const folderLink = e.target.closest('.open-folder');
    if (folderLink) {
      e.preventDefault();
      try {
        const resp = await fetch(`${API_BASE}/api/open-folder`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project_code: folderLink.dataset.code, project_name: folderLink.dataset.name }),
        });
        if (!resp.ok) {
          const result = await resp.json().catch(() => ({}));
          alert('打开文件夹失败：' + (result.error || resp.statusText));
        }
      } catch (err) {
        alert('打开文件夹失败：' + err.message);
      }
      return;
    }
    const link = e.target.closest('.progress-link');
    if (link) {
      e.preventDefault();
      const watchId = link.getAttribute('data-watch-id');
      const row = currentRows.find(r => String(r.id) === String(watchId));
      openProgressModal(watchId, row ? row.project_name : '');
      return;
    }
    const editTagBtn = e.target.closest('.btn-edit-tag');
    if (editTagBtn) {
      openTagModal(editTagBtn.getAttribute('data-watch-id'));
      return;
    }
    const btn = e.target.closest('.btn-unwatch');
    if (btn) {
      const watchId = btn.getAttribute('data-watch-id');
      if (!confirm('确定取消关注该项目吗？（相关进展记录会一并删除）')) return;
      unwatch(watchId);
    }
  });

  // 变更关注类型弹窗事件
  tagModalClose.addEventListener('click', closeTagModal);
  cancelTagBtn.addEventListener('click', closeTagModal);
  tagModal.addEventListener('click', (e) => {
    if (e.target === tagModal) closeTagModal();
  });
  saveTagBtn.addEventListener('click', saveTag);

  progressList.addEventListener('click', (e) => {
    const editBtn = e.target.closest('.btn-progress-edit');
    const saveBtn = e.target.closest('.btn-progress-save');
    const delBtn = e.target.closest('.btn-progress-del');
    if (editBtn) {
      startEditProgress(editBtn.getAttribute('data-id'));
    } else if (saveBtn) {
      saveEditProgress(saveBtn.getAttribute('data-id'));
    } else if (delBtn) {
      if (!confirm('确定删除该条记录吗？')) return;
      deleteProgress(delBtn.getAttribute('data-id'));
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
    if (sortField) {
      params.append('sort', sortField);
      params.append('order', sortOrder);
    }

    const resp = await fetch(`${API_BASE}/api/watch-projects?${params.toString()}`);
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
    tableBody.innerHTML = `<tr><td colspan="${columns.length}" class="empty">暂无关注项目</td></tr>`;
    return;
  }

  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = columns.map(c => {
      if (c.key === '_watch_type') {
        const names = String(row.watch_type || '').split(',').map(s => s.trim()).filter(Boolean);
        if (names.length === 0) return '<td></td>';
        const badges = names.map(n =>
          `<span class="watch-tag-badge" style="background:${getTagColor(n)}">${escapeHtml(n)}</span>`
        ).join('');
        return `<td>${badges}</td>`;
      }
      if (c.key === '_progress') {
        const count = row.progress_count || 0;
        const text = count > 0 ? `查看（${count} 条）` : '录入';
        return `<td><a href="#" class="progress-link" data-watch-id="${row.id}">${text}</a></td>`;
      }
      if (c.key === '_action') {
        return `<td><button class="btn-small btn-edit btn-edit-tag" data-watch-id="${row.id}">变更</button><button class="btn-small btn-unwatch" data-watch-id="${row.id}">取消关注</button></td>`;
      }
      if (c.key === 'project_code') {
        return `<td><a href="#" class="open-folder" data-code="${escapeHtml(row.project_code || '')}" data-name="${escapeHtml(row.project_name || '')}">${escapeHtml(row.project_code || '')}</a></td>`;
      }
      if (c.key === 'approval_date') {
        return `<td>${formatDate(row.approval_date)}</td>`;
      }
      return `<td title="${escapeHtml(row[c.key] ?? '')}">${escapeHtml(row[c.key] ?? '')}</td>`;
    }).join('');
    tableBody.appendChild(tr);
  }
}

function updatePagination() {
  const totalPages = Math.ceil(total / pageSize) || 1;
  pageInfo.textContent = `第 ${currentPage} / ${totalPages} 页，共 ${total} 条`;
  prevBtn.disabled = currentPage <= 1;
  nextBtn.disabled = currentPage >= totalPages;
}

async function unwatch(watchId) {
  try {
    const resp = await fetch(`${API_BASE}/api/watch-projects/${watchId}`, { method: 'DELETE' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    await loadData();
  } catch (err) {
    alert('取消关注失败：' + err.message);
  }
}

/* ---------- 添加关注项目 ---------- */

function openAddModal() {
  addModal.style.display = 'flex';
  addModalStatus.textContent = '';
  projectSearchInput.value = '';
  projectSearchResult.innerHTML = '<div class="empty">输入关键字搜索要关注的项目</div>';
  renderTagSelect(document.getElementById('addTagSelect'), []);
  projectSearchInput.focus();
}

function closeAddModal() {
  addModal.style.display = 'none';
}

async function searchProjects() {
  const keyword = projectSearchInput.value.trim();
  if (!keyword) {
    projectSearchResult.innerHTML = '<div class="empty">输入关键字搜索要关注的项目</div>';
    return;
  }
  projectSearchResult.innerHTML = '<div class="empty">搜索中…</div>';
  try {
    const params = new URLSearchParams({ page: 1, pageSize: 10, keyword });
    const resp = await fetch(`${API_BASE}/api/projects?${params.toString()}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const result = await resp.json();
    if (!result.success) throw new Error(result.error || '搜索失败');
    const rows = result.data || [];
    if (rows.length === 0) {
      projectSearchResult.innerHTML = '<div class="empty">未找到匹配的项目</div>';
      return;
    }
    projectSearchResult.innerHTML = rows.map(p => `
      <div class="project-search-item" data-project-id="${p.id}">
        <div class="project-search-info">
          <div class="project-search-code">${escapeHtml(p.project_code || '')}</div>
          <div class="project-search-name" title="${escapeHtml(p.project_name || '')}">${escapeHtml(p.project_name || '')}</div>
        </div>
        <button class="btn-secondary btn-add-watch" data-project-id="${p.id}">关注</button>
      </div>
    `).join('');
    projectSearchResult.querySelectorAll('.btn-add-watch').forEach(btn => {
      btn.addEventListener('click', () => addWatch(btn.getAttribute('data-project-id')));
    });
  } catch (err) {
    projectSearchResult.innerHTML = `<div class="empty">搜索失败：${escapeHtml(err.message)}</div>`;
  }
}

async function addWatch(projectId) {
  addModalStatus.textContent = '';
  const tagNames = getSelectedTagNames(document.getElementById('addTagSelect'));
  try {
    const resp = await fetch(`${API_BASE}/api/watch-projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: Number(projectId), watch_type: tagNames.join(',') }),
    });
    const result = await resp.json();
    if (!resp.ok || !result.success) throw new Error(result.error || `添加失败 (${resp.status})`);
    addModalStatus.textContent = '✅ 已添加关注';
    addModalStatus.className = 'settings-status ok';
    setTimeout(() => {
      closeAddModal();
      addModalStatus.className = 'settings-status';
      currentPage = 1;
      loadData();
    }, 400);
  } catch (err) {
    addModalStatus.textContent = '❌ ' + err.message;
    addModalStatus.className = 'settings-status error';
  }
}

/* ---------- 关注原因及进展 ---------- */

async function openProgressModal(watchId, projectName) {
  currentWatchId = watchId;
  progressModalTitle.textContent = `关注原因及进展 - ${projectName || ''}`;
  progressModalStatus.textContent = '';
  newProgressText.value = '';
  progressModal.style.display = 'flex';
  await loadProgress();
}

function closeProgressModal() {
  progressModal.style.display = 'none';
  currentWatchId = null;
  loadData(); // 刷新列表中的条数
}

async function loadProgress() {
  if (!currentWatchId) return;
  try {
    const resp = await fetch(`${API_BASE}/api/watch-projects/${currentWatchId}/progress`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const result = await resp.json();
    if (!result.success) throw new Error(result.error || '加载失败');
    renderProgressList(result.data || []);
  } catch (err) {
    progressList.innerHTML = `<tr><td colspan="3" class="empty">加载失败：${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderProgressList(rows) {
  if (rows.length === 0) {
    progressList.innerHTML = '<tr><td colspan="3" class="empty">暂无记录</td></tr>';
    return;
  }
  progressList.innerHTML = rows.map(r => `
    <tr data-id="${r.id}">
      <td class="progress-time">${formatDateTime(r.created_at)}</td>
      <td class="progress-desc">${escapeHtml(r.description || '')}</td>
      <td class="progress-actions">
        <button class="btn-small btn-edit btn-progress-edit" data-id="${r.id}">变更</button>
        <button class="btn-small btn-progress-del" data-id="${r.id}">删除</button>
      </td>
    </tr>
  `).join('');
}

function startEditProgress(id) {
  const tr = progressList.querySelector(`tr[data-id="${id}"]`);
  if (!tr) return;
  const descTd = tr.querySelector('.progress-desc');
  const actionsTd = tr.querySelector('.progress-actions');
  const oldText = descTd.textContent;
  descTd.innerHTML = `<textarea class="progress-edit-textarea" rows="3">${escapeHtml(oldText)}</textarea>`;
  actionsTd.innerHTML = `
    <button class="btn-small btn-edit btn-progress-save" data-id="${id}">保存</button>
    <button class="btn-small btn-progress-cancel" data-id="${id}">取消</button>
  `;
  const cancelBtn = actionsTd.querySelector('.btn-progress-cancel');
  cancelBtn.addEventListener('click', () => loadProgress());
}

async function saveEditProgress(id) {
  const tr = progressList.querySelector(`tr[data-id="${id}"]`);
  if (!tr) return;
  const textarea = tr.querySelector('.progress-edit-textarea');
  const description = textarea.value.trim();
  if (!description) {
    alert('说明不能为空');
    return;
  }
  try {
    const resp = await fetch(`${API_BASE}/api/watch-progress/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description }),
    });
    const result = await resp.json();
    if (!resp.ok || !result.success) throw new Error(result.error || '保存失败');
    await loadProgress();
  } catch (err) {
    alert('保存失败：' + err.message);
  }
}

async function deleteProgress(id) {
  try {
    const resp = await fetch(`${API_BASE}/api/watch-progress/${id}`, { method: 'DELETE' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    await loadProgress();
  } catch (err) {
    alert('删除失败：' + err.message);
  }
}

async function addProgress() {
  const description = newProgressText.value.trim();
  if (!description) {
    progressModalStatus.textContent = '请填写说明';
    progressModalStatus.className = 'settings-status error';
    return;
  }
  addProgressBtn.disabled = true;
  try {
    const resp = await fetch(`${API_BASE}/api/watch-projects/${currentWatchId}/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description }),
    });
    const result = await resp.json();
    if (!resp.ok || !result.success) throw new Error(result.error || '录入失败');
    newProgressText.value = '';
    progressModalStatus.textContent = '✅ 已录入';
    progressModalStatus.className = 'settings-status ok';
    await loadProgress();
  } catch (err) {
    progressModalStatus.textContent = '❌ ' + err.message;
    progressModalStatus.className = 'settings-status error';
  } finally {
    addProgressBtn.disabled = false;
  }
}

/* ---------- 工具函数 ---------- */

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

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toISOString().slice(0, 10);
}

function formatDateTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

init();
