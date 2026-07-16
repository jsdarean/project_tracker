const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1200 });
  await page.goto('http://localhost:3000/settings.html', { waitUntil: 'networkidle2' });

  // 等待导出字段区域渲染
  await page.waitForSelector('#exportFields .export-field-item', { timeout: 10000 });

  // 截图整个页面
  await page.screenshot({ path: 'debug_settings_full.png', fullPage: true });

  // 获取所有导出字段的 computed style
  const fields = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.export-field-item')).slice(0, 5).map(item => {
      const checkbox = item.querySelector('input[type="checkbox"]');
      const text = item.querySelector('span');
      const itemRect = item.getBoundingClientRect();
      const checkboxRect = checkbox.getBoundingClientRect();
      const textRect = text.getBoundingClientRect();
      const itemStyle = window.getComputedStyle(item);
      const checkboxStyle = window.getComputedStyle(checkbox);
      return {
        label: text.textContent,
        item: { width: itemRect.width, height: itemRect.height },
        checkbox: { width: checkboxRect.width, height: checkboxRect.height, left: checkboxRect.left, right: checkboxRect.right },
        text: { width: textRect.width, height: textRect.height, left: textRect.left, right: textRect.right },
        gap: textRect.left - checkboxRect.right,
        itemCss: { display: itemStyle.display, width: itemStyle.width },
        checkboxCss: { width: checkboxStyle.width, flex: checkboxStyle.flex }
      };
    });
  });

  console.log('前5个字段布局信息:', JSON.stringify(fields, null, 2));

  await browser.close();
})();
