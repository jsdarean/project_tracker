const API_BASE = window.location.origin;

const archiveFolderInput = document.getElementById('archiveFolder');
const downloadDirInput = document.getElementById('downloadDir');
const dbHostInput = document.getElementById('dbHost');
const dbPortInput = document.getElementById('dbPort');
const dbUserInput = document.getElementById('dbUser');
const dbPasswordInput = document.getElementById('dbPassword');
const dbNameInput = document.getElementById('dbName');
const testDbBtn = document.getElementById('testDbBtn');
const dbTestStatusEl = document.getElementById('dbTestStatus');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const settingsStatusEl = document.getElementById('settingsStatus');
const exportFieldsEl = document.getElementById('exportFields');

let columnMeta = [];
let currentExportFields = [];

async function loadColumns() {
  try {
    const resp = await fetch(`${API_BASE}/api/projects/columns`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const result = await resp.json();
    if (!result.success) throw new Error(result.error || '加载字段注释失败');
    columnMeta = (result.data || []).filter(c =>
      !['id', 'created_at', 'updated_at', 'status'].includes(c.field)
    );
  } catch (err) {
    console.error('加载字段注释失败:', err);
  }
}

function renderExportFields() {
  exportFieldsEl.innerHTML = '';
  if (columnMeta.length === 0) {
    exportFieldsEl.textContent = '加载字段列表失败，请刷新页面重试。';
    return;
  }
  for (const col of columnMeta) {
    const wrapper = document.createElement('div');
    wrapper.className = 'export-field-wrapper';
    const text = document.createElement('span');
    text.className = 'export-field-text';
    text.textContent = col.comment || col.field;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `export-field-${col.field}`;
    checkbox.value = col.field;
    checkbox.checked = currentExportFields.includes(col.field);
    const label = document.createElement('label');
    label.htmlFor = checkbox.id;
    label.className = 'export-field-hit';
    wrapper.appendChild(checkbox);
    wrapper.appendChild(text);
    exportFieldsEl.appendChild(wrapper);
  }
}

function getSelectedExportFields() {
  const checkboxes = exportFieldsEl.querySelectorAll('input[type="checkbox"]:checked');
  return Array.from(checkboxes).map(cb => cb.value);
}

async function loadSettingsUI() {
  try {
    await loadColumns();
    const resp = await fetch(`${API_BASE}/api/settings`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const result = await resp.json();
    if (result.success && result.data) {
      archiveFolderInput.value = result.data.archive_folder || '';
      downloadDirInput.value = result.data.download_dir || '';
      dbHostInput.value = result.data.db_host || '';
      dbPortInput.value = result.data.db_port || '';
      dbUserInput.value = result.data.db_user || '';
      dbPasswordInput.value = result.data.db_password || '';
      dbNameInput.value = result.data.db_name || '';
      currentExportFields = Array.isArray(result.data.export_fields) ? result.data.export_fields : [];
    }
    renderExportFields();
  } catch (err) {
    console.error('加载设置失败:', err);
    showSettingsStatus('加载设置失败：' + err.message, 'error');
    renderExportFields();
  }
}

async function testDbConnection() {
  const payload = {
    db_host: dbHostInput.value.trim(),
    db_port: parseInt(dbPortInput.value, 10) || 3306,
    db_user: dbUserInput.value.trim(),
    db_password: dbPasswordInput.value,
    db_name: dbNameInput.value.trim(),
  };

  dbTestStatusEl.textContent = '测试中...';
  dbTestStatusEl.className = 'settings-status';

  try {
    const resp = await fetch(`${API_BASE}/api/db/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await resp.json();
    if (!resp.ok || !result.success) {
      throw new Error(result.error || '连接失败');
    }
    dbTestStatusEl.textContent = '✅ ' + result.message;
    dbTestStatusEl.className = 'settings-status ok';
  } catch (err) {
    dbTestStatusEl.textContent = '❌ ' + err.message;
    dbTestStatusEl.className = 'settings-status error';
  }
}

async function saveAllSettings() {
  const payload = {
    archive_folder: archiveFolderInput.value.trim(),
    download_dir: downloadDirInput.value.trim(),
    db_host: dbHostInput.value.trim(),
    db_port: parseInt(dbPortInput.value, 10) || 3306,
    db_user: dbUserInput.value.trim(),
    db_password: dbPasswordInput.value,
    db_name: dbNameInput.value.trim(),
    export_fields: getSelectedExportFields(),
  };

  if (!payload.archive_folder) {
    showSettingsStatus('请填写归档文件夹路径', 'error');
    return;
  }
  if (!payload.download_dir) {
    showSettingsStatus('请填写浏览器默认下载目录', 'error');
    return;
  }

  try {
    const resp = await fetch(`${API_BASE}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await resp.json();
    if (!resp.ok || !result.success) {
      throw new Error(result.error || `保存失败 (${resp.status})`);
    }
    showSettingsStatus('✅ 设置已保存', 'ok');
  } catch (err) {
    showSettingsStatus('❌ ' + err.message, 'error');
  }
}

function showSettingsStatus(message, type) {
  settingsStatusEl.textContent = message;
  settingsStatusEl.className = 'settings-status ' + (type || '');
}

saveSettingsBtn.addEventListener('click', saveAllSettings);
testDbBtn.addEventListener('click', testDbConnection);

loadSettingsUI();
