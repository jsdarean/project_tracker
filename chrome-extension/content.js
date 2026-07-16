// 内容脚本：辅助 background 与页面交互
// 实际的文本提取由 background.js 通过 scripting.executeScript 直接执行，
// 这里预留扩展点，方便后续支持 PDF、iframe 等场景。

console.log('[项目信息一键提取] 内容脚本已加载');

function findElementByText(text) {
  // 兼容普通 div/span 样式的可点击元素（如 collapse-text）
  const candidates = Array.from(document.querySelectorAll('button, a, div, span, i, label, [class*="collapse"]'));
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
  console.log('[content.js] 点击元素:', clickable.outerHTML?.slice(0, 200));

  // 模拟完整鼠标事件序列，提高对 Vue/React 等框架的兼容性
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

// 带重试的查找，适应 Vue 等异步渲染
async function findElementByTextWithRetry(text, maxAttempts = 12, interval = 300) {
  for (let i = 0; i < maxAttempts; i++) {
    const el = findElementByText(text);
    if (el) {
      console.log(`[content.js] 找到“${text}”元素（第 ${i + 1} 次尝试）`);
      return el;
    }
    await wait(interval);
  }
  console.log(`[content.js] 未找到“${text}”元素，共尝试 ${maxAttempts} 次`);
  return null;
}

// 查找展开/折叠容器：优先匹配 .collapse 容器本身，或包含文本的子元素
function findCollapseContainer(text) {
  // 1. 直接查找文本完全匹配且可见的 .collapse 容器
  const collapses = Array.from(document.querySelectorAll('.collapse, [class*="collapse-text"], [class*="collapse_btn"], [class*="collapse-btn"]'));
  for (const el of collapses) {
    if ((el.textContent || '').trim() === text && isVisible(el)) {
      return el;
    }
  }
  // 2. 如果子元素包含文本，返回其最近的 .collapse 祖先
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

// 等待页面展开完成：直到可见的“展开/查看更多信息”全部消失
async function waitForExpansionComplete(maxAttempts = 30, interval = 300) {
  for (let i = 0; i < maxAttempts; i++) {
    const stillCollapsed = findElementByText('展开') || findElementByText('查看更多信息');
    if (!stillCollapsed) {
      console.log('[content.js] 页面已全部展开');
      return true;
    }
    await wait(interval);
  }
  console.log('[content.js] 等待页面展开完成超时');
  return false;
}

// 打印前点击“展开”、“查看更多信息”等按钮，确保网页内容完整
async function clickExpandButtons() {
  const labels = ['展开', '查看更多信息'];
  const clicked = [];
  for (const text of labels) {
    let el = findCollapseContainer(text);
    if (!el) {
      el = await findElementByTextWithRetry(text);
    }
    if (el) {
      console.log(`[content.js] 准备点击“${text}”容器:`, el.outerHTML?.slice(0, 200));
      clickElement(el);
      clicked.push(text);
    }
  }

  // 等待展开动画/异步渲染完成
  if (clicked.length > 0) {
    console.log('[content.js] 等待页面展开完成...');
    await waitForExpansionComplete();
    // 再多等 1 秒，确保 Vue 异步内容渲染完毕
    await wait(1000);
  }

  console.log('[content.js] 已点击展开按钮:', clicked);
  return clicked;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'CLICK_DOWNLOAD_BUTTON') {
    (async () => {
      try {
        const el = await findElementByTextWithRetry('表单下载', 12, 300);
        if (!el) {
          sendResponse({ success: false, error: '未找到“表单下载”按钮' });
          return;
        }
        const clicked = clickElement(el);
        sendResponse({ success: clicked, clickedText: el.textContent?.trim() });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (request.type === 'EXPAND_PAGE') {
    (async () => {
      try {
        const clicked = await clickExpandButtons();
        sendResponse({ success: true, clicked });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
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
