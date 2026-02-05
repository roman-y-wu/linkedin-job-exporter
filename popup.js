function setStatus(message, isError = false) {
  const status = document.getElementById('status');
  status.textContent = message;
  status.style.color = isError ? '#cf222e' : '#57606a';
}

function isLinkedInJobsPage(url) {
  if (!url) return false;
  return /^https?:\/\/([a-z0-9-]+\.)?linkedin\.com\/jobs\//i.test(url);
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs?.[0] || null;
}

async function ensureScriptInjected(tabId) {
  try {
    const pingResponse = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    if (pingResponse?.ok) return;
  } catch (_error) {
    // Ignore and fall through to script injection.
  }

  await chrome.scripting.insertCSS({ target: { tabId }, files: ['styles.css'] });
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
}

async function sendCommandToTab(commandType) {
  const tab = await getActiveTab();
  if (!tab?.id) {
    throw new Error('找不到当前标签页。');
  }

  if (!isLinkedInJobsPage(tab.url)) {
    throw new Error('请先打开 LinkedIn Jobs 职位详情页（链接包含 /jobs/）。');
  }

  await ensureScriptInjected(tab.id);
  const response = await chrome.tabs.sendMessage(tab.id, { type: commandType });
  if (!response?.ok) {
    throw new Error(response?.error || '执行失败。');
  }
}

function withLoading(button, loadingText, fn) {
  return async () => {
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = loadingText;
    try {
      await fn();
      button.textContent = originalText;
      button.disabled = false;
    } catch (error) {
      button.textContent = originalText;
      button.disabled = false;
      throw error;
    }
  };
}

document.addEventListener('DOMContentLoaded', async () => {
  const injectBtn = document.getElementById('inject-btn');
  const exportBtn = document.getElementById('export-btn');

  try {
    const tab = await getActiveTab();
    if (tab?.url && !isLinkedInJobsPage(tab.url)) {
      setStatus('当前不是 LinkedIn Jobs 页面，请先打开职位详情页。', true);
    }
  } catch (_error) {
    // Ignore initial status failures.
  }

  injectBtn.addEventListener('click', () => {
    withLoading(injectBtn, '处理中...', async () => {
      await sendCommandToTab('INJECT_BUTTON');
      setStatus('已尝试显示导出按钮，请查看职位页面右侧或右下角。');
    })().catch((error) => {
      setStatus(error?.message || '执行失败。', true);
    });
  });

  exportBtn.addEventListener('click', () => {
    withLoading(exportBtn, '导出中...', async () => {
      await sendCommandToTab('EXPORT_TXT');
      setStatus('导出完成。');
    })().catch((error) => {
      setStatus(error?.message || '导出失败。', true);
    });
  });
});
