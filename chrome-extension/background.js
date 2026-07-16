const API_BASE = 'http://localhost:3000';

// 自动归档任务状态
let pendingOrganize = null;

// 监听下载事件：用于捕获“表单下载”后的文件
chrome.downloads.onCreated.addListener((downloadItem) => {
  console.log('[background.js] 下载创建:', downloadItem.id, downloadItem.filename, downloadItem.state);
  if (!pendingOrganize) return;
  if (pendingOrganize.downloadId) return;
  if (downloadItem.state === 'interrupted') return;
  pendingOrganize.downloadId = downloadItem.id;
  console.log('[background.js] 已捕获归档下载 ID:', downloadItem.id);
});

chrome.downloads.onChanged.addListener((delta) => {
  if (!pendingOrganize || delta.id !== pendingOrganize.downloadId) return;
  console.log('[background.js] 下载变化:', delta);
  if (delta.state) {
    if (delta.state.current === 'complete') {
      finishOrganize();
    } else if (delta.state.current === 'interrupted') {
      const ctx = pendingOrganize;
      pendingOrganize = null;
      clearTimeout(ctx.timeout);
      ctx.reject(new Error('下载被中断'));
    }
  }
});

async function finishOrganize() {
  const ctx = pendingOrganize;
  if (!ctx) return;
  try {
    console.log('[background.js] 下载完成，准备归档，downloadId:', ctx.downloadId);
    const items = await chrome.downloads.search({ id: ctx.downloadId });
    console.log('[background.js] 下载记录:', items);
    const item = items[0];
    if (!item || !item.filename) throw new Error('未找到下载记录或文件名');
    console.log('[background.js] 调用后端归档，filename:', item.filename);

    const resp = await fetch(`${API_BASE}/api/organize-download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_code: ctx.project_code,
        project_name: ctx.project_name,
        source_relative_path: item.filename,
        fields: ctx.fields
      })
    });
    const json = await resp.json();
    console.log('[background.js] 后端归档响应:', json);
    if (!resp.ok || !json.success) throw new Error(json.error || '归档失败');

    clearTimeout(ctx.timeout);
    pendingOrganize = null;
    ctx.resolve({ success: true, data: json });
  } catch (err) {
    clearTimeout(ctx.timeout);
    pendingOrganize = null;
    ctx.reject(err);
  }
}

async function handleOrganizeDownload({ project_code, project_name, fields }) {
  console.log('[background.js] 开始自动归档:', project_code, project_name);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error('未找到当前活动标签页');

  // 优先尝试点击“表单下载”按钮；找不到、点击失败或未捕获到下载时，退回到 PDF 打印归档
  let clickResp = null;
  try {
    clickResp = await chrome.tabs.sendMessage(tab.id, { type: 'CLICK_DOWNLOAD_BUTTON' });
    console.log('[background.js] 表单下载点击结果:', clickResp);
  } catch (err) {
    clickResp = { success: false, error: err.message };
    console.warn('[background.js] 点击表单下载通信失败:', err.message);
  }
  if (clickResp && clickResp.success) {
    try {
      return await waitForDownloadAndOrganize({ project_code, project_name, fields });
    } catch (err) {
      console.warn('[background.js] 表单下载未捕获到文件，退回到 PDF 打印归档:', err.message);
      // 清理可能挂起的下载监听
      if (pendingOrganize) {
        clearTimeout(pendingOrganize.timeout);
        pendingOrganize = null;
      }
    }
  }

  // 退回到 PDF 打印归档
  console.log('[background.js] 走 PDF 打印归档');
  return printAndOrganizePdf(tab.id, project_code, project_name, fields);
}

function waitForDownloadAndOrganize({ project_code, project_name, fields }) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (pendingOrganize && pendingOrganize.resolve === resolve) {
        pendingOrganize = null;
      }
      reject(new Error('等待下载超时，未捕获到“表单下载”文件'));
    }, 30000);

    pendingOrganize = { project_code, project_name, fields, resolve, reject, timeout };
  });
}

// 使用 Chrome DevTools Protocol 将当前页面打印为 PDF
async function printTabToPdf(tabId) {
  await chrome.debugger.attach({ tabId }, '1.3');
  try {
    await chrome.debugger.sendCommand({ tabId }, 'Page.enable');
    const result = await chrome.debugger.sendCommand({ tabId }, 'Page.printToPDF', {
      printBackground: true,   // 对应“更多图形/背景图形”
      preferCSSPageSize: false,
      displayHeaderFooter: false,
      landscape: false,
      paperWidth: 8.27,        // A4
      paperHeight: 11.69
    });
    return result.data; // base64 字符串
  } finally {
    await chrome.debugger.detach({ tabId }).catch(() => {});
  }
}

function downloadPdfFromBase64(base64Data, filename) {
  const dataUrl = 'data:application/pdf;base64,' + base64Data;
  return new Promise((resolve, reject) => {
    chrome.downloads.download({ url: dataUrl, filename, saveAs: false }, (downloadId) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(downloadId);
      }
    });
  });
}

// 在页面上下文中执行：点击“展开”、“查看更多信息”，并等待展开完成
// 注意：此函数会被 chrome.scripting.executeScript 序列化到页面中运行，不能引用外部变量
function clickExpandButtonsInPage() {
  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function findElementByText(text) {
    const candidates = Array.from(document.querySelectorAll('button, a, div, span, i, label, [class*="collapse"]'));
    for (const el of candidates) {
      if ((el.textContent || '').trim() === text && isVisible(el)) return el;
    }
    for (const el of candidates) {
      if ((el.textContent || '').includes(text) && isVisible(el)) return el;
    }
    return null;
  }

  function findCollapseContainer(text) {
    const collapses = Array.from(document.querySelectorAll('.collapse, [class*="collapse-text"], [class*="collapse_btn"], [class*="collapse-btn"]'));
    for (const el of collapses) {
      if ((el.textContent || '').trim() === text && isVisible(el)) return el;
    }
    const all = Array.from(document.querySelectorAll('button, a, div, span, i, label, [class*="collapse"]'));
    for (const el of all) {
      if ((el.textContent || '').trim() === text && isVisible(el)) {
        const container = el.closest('.collapse, [class*="collapse-wrapper"], [class*="collapse-box"]');
        if (container) return container;
        return el;
      }
    }
    return null;
  }

  function clickElement(el) {
    if (!el) return false;
    const clickable = el.closest('button, a, div[role="button"], span[role="button"]') || el;
    const rect = clickable.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const eventInit = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
      screenX: x + window.screenX,
      screenY: y + window.screenY
    };
    clickable.dispatchEvent(new MouseEvent('mousedown', eventInit));
    clickable.dispatchEvent(new MouseEvent('mouseup', eventInit));
    if (typeof clickable.click === 'function') {
      clickable.click();
    } else {
      clickable.dispatchEvent(new MouseEvent('click', eventInit));
    }
    return true;
  }

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function waitForExpansionComplete(maxAttempts = 30, interval = 300) {
    for (let i = 0; i < maxAttempts; i++) {
      const stillCollapsed = findElementByText('展开') || findElementByText('查看更多信息');
      if (!stillCollapsed) {
        console.log('[page] 页面已全部展开');
        return true;
      }
      await wait(interval);
    }
    console.log('[page] 等待页面展开完成超时');
    return false;
  }

  return (async () => {
    const labels = ['展开', '查看更多信息'];
    const clicked = [];
    for (const text of labels) {
      let el = findCollapseContainer(text);
      if (!el) el = findElementByText(text);
      if (el) {
        console.log('[page] 点击“' + text + '”容器');
        clickElement(el);
        clicked.push(text);
      }
    }
    if (clicked.length > 0) {
      console.log('[page] 等待页面展开完成...');
      await waitForExpansionComplete();
      await wait(1000);
    }
    console.log('[page] 已点击展开按钮:', clicked);
    return { success: true, clicked };
  })();
}

async function printAndOrganizePdf(tabId, project_code, project_name, fields) {
  // 1. 先点击页面上的“展开”、“查看更多信息”等按钮（直接注入页面执行，避免 content script 消息丢失）
  let expandResp = { success: true, clicked: [] };
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: clickExpandButtonsInPage
    });
    expandResp = results[0]?.result || { success: true, clicked: [] };
    console.log('[background.js] 展开按钮点击结果:', expandResp);
  } catch (err) {
    console.warn('[background.js] 点击展开按钮失败:', err.message);
  }

  // 2. 等待页面展开/加载完成
  await new Promise(r => setTimeout(r, 1500));

  // 3. 打印为 PDF
  let pdfBase64;
  try {
    pdfBase64 = await printTabToPdf(tabId);
    console.log('[background.js] PDF 生成成功，大小:', Math.round(pdfBase64.length * 0.75 / 1024), 'KB');
  } catch (err) {
    throw new Error('打印 PDF 失败：' + err.message);
  }

  // 4. 将 PDF 下载到浏览器默认下载目录（临时文件名，后续由后端移动到归档目录）
  const safeName = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
  const safeCode = safeName(project_code);
  const safeName2 = safeName(project_name);
  const tempFileName = safeName2
    ? `${safeCode}-${safeName2}-立项批复（发文）-web-print.pdf`
    : `${safeCode}-立项批复（发文）-web-print.pdf`;

  const downloadId = await downloadPdfFromBase64(pdfBase64, tempFileName);
  console.log('[background.js] PDF 下载任务已创建:', downloadId);

  // 5. 等待下载完成并归档
  return waitForPdfDownloadAndOrganize({ project_code, project_name, fields, downloadId });
}

function waitForPdfDownloadAndOrganize({ project_code, project_name, fields, downloadId }) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (pendingOrganize && pendingOrganize.resolve === resolve) {
        pendingOrganize = null;
      }
      reject(new Error('等待 PDF 下载超时'));
    }, 30000);

    pendingOrganize = { project_code, project_name, fields, resolve, reject, timeout, downloadId };
  });
}

// 安装时创建右键菜单
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'extractSelectedText',
    title: '提取选中的立项批复正文',
    contexts: ['selection']
  });
});

// 右键菜单点击：提取选中文本
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'extractSelectedText') {
    try {
      await chrome.sidePanel.open({ windowId: tab.windowId });
      await chrome.sidePanel.setOptions({
        tabId: tab.id,
        path: 'sidepanel.html',
        enabled: true
      });
      const text = info.selectionText || '';
      await extractAndSend(text, tab.url, `选中了 ${text.length} 个字符`);
    } catch (err) {
      console.error('选区提取失败:', err);
    }
  }
});

// 点击扩展图标时打开侧边栏并触发页面自动提取
chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ windowId: tab.windowId });
  await chrome.sidePanel.setOptions({
    tabId: tab.id,
    path: 'sidepanel.html',
    enabled: true
  });
  setTimeout(() => extractFromTab(tab.id), 1500);
});

// 监听内容脚本和侧边栏的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'EXTRACT_PAGE_TEXT') {
    extractFromTab(request.tabId || sender.tab?.id)
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message, detail: err.detail }));
    return true;
  }

  if (request.type === 'EXTRACT_PASTED_TEXT') {
    extractAndSend(request.text, request.url || '', '粘贴文本')
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.type === 'CALL_BACKEND') {
    callBackend(request.endpoint, request.method, request.body)
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.type === 'ORGANIZE_DOWNLOAD') {
    handleOrganizeDownload(request)
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

async function extractFromTab(tabId) {
  if (!tabId) throw new Error('未找到当前标签页');

  // 等待页面关键内容渲染（CPMS 为 Vue 单页应用，异步加载）
  await waitForContent(tabId, 2000);

  // 先从页面 DOM 抓取责任部门/责任人（与正文独立，可能来自表单区域）
  let responsibilities = {};
  try {
    responsibilities = await extractResponsibilitiesFromTab(tabId);
  } catch (err) {
    console.warn('抓取责任部门/责任人失败:', err);
  }

  // 尝试多种策略获取页面文本
  const strategies = [
    { name: 'selectedText', fn: () => getSelectedText(tabId) },
    { name: 'mainContent', fn: () => executeInTab(tabId, findMainContentText) },
    { name: 'articleContent', fn: () => executeInTab(tabId, findArticleText) },
    { name: 'bodyText', fn: () => executeInTab(tabId, () => document.body?.innerText || '') },
  ];

  let lastError = '';
  for (const strategy of strategies) {
    try {
      const text = await strategy.fn();
      if (text && text.trim().length > 30) {
        return await extractAndSend(text, null, `策略：${strategy.name}`, responsibilities);
      }
    } catch (err) {
      lastError = err.message;
      console.warn(`提取策略 ${strategy.name} 失败:`, err.message);
    }
  }

  const err = new Error('页面未找到可提取的立项批复正文，请尝试选中正文后右键提取，或手动粘贴。');
  err.detail = lastError;
  throw err;
}

async function waitForContent(tabId, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const text = document.body?.innerText || '';
          return text.length > 200 && /责任部门|责任人|项目编码|项目名称/.test(text);
        }
      });
      if (results[0]?.result) return;
    } catch (e) {
      // ignore
    }
    await new Promise(r => setTimeout(r, 300));
  }
}

async function getSelectedText(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => window.getSelection()?.toString() || ''
  });
  return results[0]?.result || '';
}

async function executeInTab(tabId, func) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func
  });
  return results[0]?.result || '';
}

// 在页面中执行的函数：查找主要内容区
function findMainContentText() {
  const selectors = [
    'main',
    'article',
    '.reply-content',
    '.reply-detail',
    '.project-reply',
    '.detail-content',
    '.form-content',
    '.el-card__body',
    '.app-main',
    '.main-container',
    '.page-container',
    '.content-box',
    '[class*="content"]',
    '[class*="detail"]',
    '[class*="main"]',
    '[id*="content"]',
    '[id*="detail"]',
    '.el-main',
    '.ivu-layout-content',
    '.ant-layout-content'
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) {
      const text = el.innerText || '';
      if (text.length > 200) return text;
    }
  }
  return '';
}

// 在页面中执行的函数：查找 article 或最长文本块
function findArticleText() {
  const candidates = Array.from(document.querySelectorAll('article, .article, [class*="reply"], [class*="approve"], [class*="document"], [class*="text"]'));
  let best = '';
  for (const el of candidates) {
    const text = el.innerText || '';
    if (text.length > best.length) best = text;
  }
  return best;
}

// 在页面中执行的函数：抓取责任部门与责任人
// 适配常见中后台表单结构：Element UI / Ant Design / 普通 table / label:value 等
function extractResponsibilities() {
  const labelMap = {
    investment_dept: ['项目投资责任人单位', '项目投资责任部门', '投资责任部门'],
    investment_person: ['项目投资责任人', '投资责任人'],
    engineering_dept: ['项目工程建设单位', '工程管理责任部门', '项目管理责任部门', '工程建设单位'],
    engineering_person: ['项目工程管理责任人', '工程管理责任人'],
    software_dept: ['软件开发管理责任部门', '软件管理责任部门'],
    software_person: ['软件开发管理责任人', '软件管理责任人'],
    maintenance_dept: ['项目维护单位', '项目维护责任部门', '维护责任部门', '维护单位'],
    maintenance_person: ['项目维护责任人', '维护责任人'],
    procurement_dept: ['项目采购责任人单位', '项目合同采购责任部门', '合同采购责任部门', '项目采购责任部门'],
    procurement_person: ['项目合同采购责任人', '合同采购责任人', '项目采购责任人'],
  };

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function getTextFromEl(el) {
    if (!el) return '';
    const input = el.querySelector('input, select, textarea');
    if (input) return (input.value || '').trim();
    return (el.textContent || '').trim();
  }

  function splitDeptPerson(raw) {
    if (!raw) return { dept: '', person: '' };
    // 去掉常见的“单位为/部门为/为”前缀
    const cleaned = raw.replace(/^(?:单位|部门)?\s*为\s*/, '').trim();
    const m = cleaned.match(/^(.*[部中心局处科司])([^部中心局处科司，。；\n]+)$/);
    if (m) return { dept: m[1].trim(), person: m[2].trim() };
    // 如果整段看起来是部门（以部/中心/局/处/科/司结尾），则只有部门没有姓名
    if (/[部中心局处科司]$/.test(cleaned)) return { dept: cleaned, person: '' };
    return { dept: '', person: cleaned };
  }

  function extractAfterLabel(el, label) {
    const text = el.textContent || '';
    const idx = text.indexOf(label);
    if (idx < 0) return '';

    // 如果 label 后面紧跟“为”或冒号，则只取到第一个句读符号（，。；\n）为止，
    // 避免整个正文/页面 UI 都被当成值。
    const rest = text.slice(idx + label.length);
    const m = rest.match(/^[\s为:：]*([^，。；\n]+)/);
    if (m) {
      // 去掉“单位为”“部门为”等前缀，避免把部门描述填到责任人字段
      const val = m[1].trim().replace(/^(单位|部门)\s*为\s*/, '').trim();
      if (val) return val;
    }

    // 兜底：取 label 之后全部文本（去除前导空格和冒号）
    const after = rest.replace(/^[\s为:：]+/, '').trim();
    return after && after !== text.trim() ? after : '';
  }

  function findValueByLabel(label) {
    const xpath = `//*[contains(text(), '${label}')]`;
    const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);

    for (let i = 0; i < result.snapshotLength; i++) {
      const el = result.snapshotItem(i);

      // 1. 同一元素内 label 后面紧跟值（如 <div>项目投资责任人：宗红昌</div>）
      const direct = extractAfterLabel(el, label);
      if (direct) return direct;

      // 2. 兄弟元素
      let valueEl = el.nextElementSibling;
      if (valueEl) {
        const v = getTextFromEl(valueEl);
        if (v && !v.includes(label)) return v;
      }

      // 3. 父元素的兄弟元素（如 <label>xx</label><div>value</div>）
      const parent = el.parentElement;
      if (parent) {
        valueEl = parent.nextElementSibling;
        if (valueEl) {
          const v = getTextFromEl(valueEl);
          if (v && !v.includes(label)) return v;
        }
      }

      // 4. 同一表格行中的下一个单元格
      const row = el.closest('tr');
      if (row) {
        const cells = Array.from(row.querySelectorAll('td, th'));
        const idx = cells.findIndex(c => (c.textContent || '').includes(label));
        if (idx >= 0 && cells[idx + 1]) {
          const v = getTextFromEl(cells[idx + 1]);
          if (v && !v.includes(label)) return v;
        }
      }

      // 5. Element UI / Ant Design 等表单结构
      const formItem = el.closest('.el-form-item, .ant-form-item, [class*="form-item"], .form-group, .row, .el-descriptions-item');
      if (formItem) {
        const content = formItem.querySelector('.el-form-item__content, .ant-form-item-control-input-content, .el-descriptions-item__content, [class*="content"]');
        if (content && content !== el && !content.contains(el)) {
          const v = getTextFromEl(content);
          if (v && !v.includes(label)) return v;
        }
      }
    }

    return '';
  }

  function getFirstValue(labels) {
    for (const label of labels) {
      const v = findValueByLabel(label);
      if (v) return v;
    }
    return '';
  }

  const result = {};
  for (const [key, labels] of Object.entries(labelMap)) {
    result[key] = getFirstValue(labels);
  }

  // 对于 *_person 字段，如果值里同时包含部门和姓名，则拆分并把部门回填 *_dept；
  // 如果值实际只是部门描述（如“单位为省公司供应链管理部”），则回填 *_dept 并清空 *_person
  const personKeys = ['investment_person', 'engineering_person', 'software_person', 'maintenance_person', 'procurement_person'];
  for (const personKey of personKeys) {
    const raw = result[personKey];
    if (!raw) continue;
    const split = splitDeptPerson(raw);
    const deptKey = personKey.replace('_person', '_dept');
    if (split.person) {
      result[personKey] = split.person;
      if (!result[deptKey] && split.dept) result[deptKey] = split.dept;
    } else if (split.dept) {
      if (!result[deptKey]) result[deptKey] = split.dept;
      result[personKey] = '';
    }
  }

  return result;
}

async function extractResponsibilitiesFromTab(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: extractResponsibilities
  });
  return results[0]?.result || {};
}

async function extractAndSend(text, url, sourceNote, extraData = {}) {
  if (!text || text.trim().length === 0) {
    throw new Error('未获取到页面文本');
  }

  // 获取当前标签页 URL（如果未传入）
  let pageUrl = url;
  if (!pageUrl) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      pageUrl = tab?.url || '';
    } catch (e) {
      pageUrl = '';
    }
  }

  const resp = await fetch(`${API_BASE}/api/extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `后端错误: ${resp.status}`);
  }
  const json = await resp.json();
  json.data.source_url = pageUrl;
  // DOM 抓取到的字段优先；文本提取到的字段作为兜底
  Object.assign(json.data, extraData);

  // 广播给侧边栏
  await chrome.runtime.sendMessage({
    type: 'EXTRACTION_RESULT',
    data: json.data,
    note: sourceNote
  }).catch(() => {});

  return json.data;
}

async function callBackend(endpoint, method = 'GET', body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(`${API_BASE}${endpoint}`, opts);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `后端错误: ${resp.status}`);
  }
  return resp.json();
}
