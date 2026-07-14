// 内容脚本：辅助 background 与页面交互
// 实际的文本提取由 background.js 通过 scripting.executeScript 直接执行，
// 这里预留扩展点，方便后续支持 PDF、iframe 等场景。

console.log('[项目信息一键提取] 内容脚本已加载');

function findElementByText(text) {
  const candidates = Array.from(document.querySelectorAll('button, a, div[role="button"], span, i, label'));
  // 优先精确匹配可见元素
  for (const el of candidates) {
    if ((el.textContent || '').trim() === text && isVisible(el)) return el;
  }
  // 模糊匹配
  for (const el of candidates) {
    if ((el.textContent || '').includes(text) && isVisible(el)) return el;
  }
  return null;
}

function isVisible(el) {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function clickElement(el) {
  if (!el) return false;
  // 对最内层可点击元素或自身触发一次点击，避免重复触发下载
  const clickable = el.closest('button, a, div[role="button"], span[role="button"]') || el;
  console.log('[content.js] 点击“表单下载”元素:', clickable.outerHTML?.slice(0, 200));
  if (typeof clickable.click === 'function') {
    clickable.click();
  } else {
    clickable.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }
  return true;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'CLICK_DOWNLOAD_BUTTON') {
    try {
      const el = findElementByText('表单下载');
      if (!el) {
        sendResponse({ success: false, error: '未找到“表单下载”按钮' });
        return true;
      }
      const clicked = clickElement(el);
      sendResponse({ success: clicked, clickedText: el.textContent?.trim() });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
    return true;
  }

  if (request.type === 'FIND_DOWNLOAD_URL') {
    try {
      const el = findElementByText('表单下载');
      const url = el?.getAttribute('href') || el?.closest('a')?.getAttribute('href') || '';
      sendResponse({ success: true, url });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
    return true;
  }
});
