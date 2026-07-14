const API_BASE = 'http://localhost:3000';
const form = document.getElementById('projectForm');
const statusEl = document.getElementById('status');
const toastEl = document.getElementById('toast');
const saveDraftBtn = document.getElementById('saveDraftBtn');
const submitBtn = document.getElementById('submitBtn');
let isSubmitting = false;
let toastTimer = null;

// 接收来自 background 的提取结果
chrome.runtime.onMessage.addListener((request) => {
  if (request.type === 'EXTRACTION_RESULT') {
    fillForm(request.data);
    showStatus('已自动填充提取结果，请核对后提交。', 'info');
  }
});

// 页面加载时尝试重新获取当前标签页内容
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      document.getElementById('source_url').value = tab.url || '';
    }
  } catch (err) {
    console.error('获取当前标签页失败:', err);
  }
});

document.getElementById('extractBtn').addEventListener('click', async () => {
  showStatus('正在提取...', 'info');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('未找到当前标签页');
    const resp = await chrome.runtime.sendMessage({ type: 'EXTRACT_PAGE_TEXT', tabId: tab.id });
    if (!resp || !resp.success) {
      throw new Error(resp?.error || '提取失败');
    }
    fillForm(resp.data);
    showStatus('已自动填充提取结果，请核对后提交。', 'info');
  } catch (err) {
    showStatus('提取失败：' + err.message, 'error');
  }
});

document.getElementById('manualExtractBtn').addEventListener('click', async () => {
  const text = document.getElementById('manualText').value.trim();
  if (!text) {
    showStatus('请先粘贴立项批复正文。', 'error');
    return;
  }
  showStatus('正在提取...', 'info');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const resp = await chrome.runtime.sendMessage({
      type: 'EXTRACT_PASTED_TEXT',
      text,
      url: tab?.url
    });
    if (!resp || !resp.success) {
      throw new Error(resp?.error || '提取失败');
    }
    fillForm(resp.data);
    showStatus('已从粘贴文本提取，请核对后提交。', 'info');
  } catch (err) {
    showStatus('提取失败：' + err.message, 'error');
  }
});

document.getElementById('saveDraftBtn').addEventListener('click', () => submitForm('draft'));
document.getElementById('submitBtn').addEventListener('click', () => submitForm('saved'));

function fillForm(data) {
  const fields = [
    'source_url', 'extracted_text', 'doc_number', 'category', 'project_code', 'project_name',
    'approval_date', 'design_date', 'completion_date', 'project_set', 'project_subset',
    'project_manager', 'planning_manager',
    'investment_dept', 'investment_person', 'engineering_dept', 'engineering_person',
    'software_dept', 'software_person', 'maintenance_dept', 'maintenance_person',
    'procurement_dept', 'procurement_person',
    'approval_amount', 'amount_note', 'change_status',
    'mid_year_budget', 'budget_increase', 'undecided_supplement', 'decided_budget',
    'decided_in_project', 'undecided_in_project', 'remarks', 'estimated_actual',
    'releasable_amount', 'design_amount', 'completion_amount', 'build_level', 'listed',
    'region', 'is_rnd', 'decision_method'
  ];
  fields.forEach(f => {
    const el = document.getElementById(f);
    if (el) {
      const val = data[f];
      el.value = val === null || val === undefined ? '' : val;
    }
  });
}

function collectFormData() {
  const formData = new FormData(form);
  const data = {};
  formData.forEach((value, key) => {
    data[key] = value;
  });
  // 数值字段处理
  ['approval_amount', 'estimated_actual', 'releasable_amount', 'design_amount', 'completion_amount'].forEach(k => {
    const v = data[k];
    data[k] = v === '' ? null : parseFloat(v);
  });
  return data;
}

function setSubmitting(value) {
  isSubmitting = value;
  saveDraftBtn.disabled = value;
  submitBtn.disabled = value;
  saveDraftBtn.textContent = value ? '保存中...' : '保存为草稿';
  submitBtn.textContent = value ? '提交中...' : '提交到数据库';
}

async function checkDuplicate(projectCode) {
  if (!projectCode) return { exists: false };
  const resp = await fetch(`${API_BASE}/api/projects/check?project_code=${encodeURIComponent(projectCode)}`);
  if (!resp.ok) throw new Error('检查项目编码失败');
  return await resp.json();
}

async function submitForm(status) {
  if (isSubmitting) return;
  setSubmitting(true);
  showStatus('正在保存...', 'info');
  try {
    const data = collectFormData();
    data.status = status;

    // 项目编码重复检查
    if (data.project_code) {
      const checkResult = await checkDuplicate(data.project_code);
      if (checkResult.exists) {
        const existing = checkResult.data || {};
        const confirmed = confirm(
          `项目编码 "${data.project_code}" 已存在：\n` +
          `项目名称：${existing.project_name || '（无）'}\n` +
          `文号：${existing.doc_number || '（无）'}\n\n` +
          `确认仍要新增一条记录吗？`
        );
        if (!confirmed) {
          setSubmitting(false);
          showStatus('已取消保存', 'info');
          return;
        }
      }
    }

    console.log('[提交数据]', data);
    const resp = await fetch(`${API_BASE}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    console.log('[响应状态]', resp.status);
    const json = await resp.json().catch(e => ({ error: '无法解析响应: ' + e.message }));
    console.log('[响应内容]', json);
    if (!resp.ok || !json.success) {
      throw new Error(json.error || `保存失败 (${resp.status})`);
    }
    const msg = status === 'saved'
      ? `已提交到数据库（记录 ID: ${json.id}）`
      : `已保存为草稿（记录 ID: ${json.id}）`;
    showStatus('✅ ' + msg, 'success');
    showToast(msg, 'success');

    // 仅“提交到数据库”时自动归档文件并关闭侧边栏
    if (status === 'saved') {
      // 后台归档不阻塞关闭，避免下载耗时导致侧边栏无法关闭
      chrome.runtime.sendMessage({
        type: 'ORGANIZE_DOWNLOAD',
        project_code: data.project_code,
        project_name: data.project_name,
        fields: data
      }).catch(err => console.error('[归档发送失败]', err));
      setTimeout(() => window.close(), 800);
    }

    // 3 秒后恢复按钮文字
    setTimeout(() => setSubmitting(false), 3000);
  } catch (err) {
    console.error('[保存异常]', err);
    showStatus('❌ 保存失败：' + err.message, 'error');
    setSubmitting(false);
  }
}

function showStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = 'status show ' + type;
  console.log(`[状态-${type}]`, message);
}

function showToast(message, type = 'success', duration = 3000) {
  if (toastTimer) {
    clearTimeout(toastTimer);
  }
  toastEl.textContent = message;
  toastEl.className = 'toast show ' + type;
  toastTimer = setTimeout(() => {
    toastEl.classList.remove('show');
  }, duration);
}
