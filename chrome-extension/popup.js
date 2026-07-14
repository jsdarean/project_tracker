document.getElementById('extractBtn').addEventListener('click', async () => {
  const statusEl = document.getElementById('status');
  statusEl.textContent = '正在提取...';
  statusEl.className = '';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('未找到当前标签页');
    await chrome.sidePanel.open({ windowId: tab.windowId });
    await chrome.sidePanel.setOptions({
      tabId: tab.id,
      path: 'sidepanel.html',
      enabled: true
    });
    const resp = await chrome.runtime.sendMessage({ type: 'EXTRACT_PAGE_TEXT', tabId: tab.id });
    if (!resp || !resp.success) {
      throw new Error(resp?.error || '未提取到正文，请使用右键“提取选中的立项批复正文”');
    }
    statusEl.textContent = '已打开侧边栏，请编辑后提交。';
    window.close();
  } catch (err) {
    statusEl.textContent = '失败：' + err.message;
    statusEl.className = 'error';
  }
});
