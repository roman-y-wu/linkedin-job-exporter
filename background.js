const LINKEDIN_JOBS_URL_RE = /^https?:\/\/([a-z0-9-]+\.)?linkedin\.com\/jobs\//i;

function isLinkedInJobsPage(url) {
  return LINKEDIN_JOBS_URL_RE.test(String(url || ''));
}

function getDateStringYmd() {
  const now = new Date();
  const y = String(now.getFullYear());
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function sanitizeFilename(input) {
  return String(input || '')
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .trim();
}

function buildFilename(jobInfo) {
  const date = getDateStringYmd();
  const rawBaseName = `${date}_${jobInfo.companyName || 'Unknown Company'}_${jobInfo.jobTitle || 'Unknown Position'}_${jobInfo.location || 'Unknown Location'}`;
  return `${sanitizeFilename(rawBaseName)}.txt`;
}

function buildTxtContent(jobInfo) {
  const exportedAt = new Date().toLocaleString();
  return [
    `Job Title: ${jobInfo.jobTitle || 'Unknown Position'}`,
    `Company: ${jobInfo.companyName || 'Unknown Company'}`,
    `Location: ${jobInfo.location || 'Unknown Location'}`,
    `Job URL: ${jobInfo.jobUrl || ''}`,
    `Exported At: ${exportedAt}`,
    '',
    'Job Description:',
    jobInfo.jobDescriptionText || 'Job description not found'
  ].join('\n');
}

function encodeTextAsDataUrl(text) {
  return `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`;
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

async function ensureContentScript(tabId) {
  try {
    const ping = await sendTabMessage(tabId, { type: 'PING' });
    if (ping?.ok) return;
  } catch (_error) {
    // Ignore and inject below.
  }

  await chrome.scripting.insertCSS({ target: { tabId }, files: ['styles.css'] });
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
}

function setBadge(text, color) {
  chrome.action.setBadgeBackgroundColor({ color }).catch(() => { });
  chrome.action.setBadgeText({ text }).catch(() => { });
}

async function flashBadge(text, color) {
  setBadge(text, color);
  await new Promise((resolve) => setTimeout(resolve, 2200));
  setBadge('', '#000000');
}

async function notifyTab(tabId, message, isError) {
  try {
    await sendTabMessage(tabId, { type: 'SHOW_EXPORT_TOAST', message, isError: Boolean(isError) });
  } catch (_error) {
    // Non-blocking.
  }
}

async function exportCurrentJobFromTab(tab) {
  if (!tab?.id || !isLinkedInJobsPage(tab.url)) {
    await flashBadge('ERR', '#b91c1c');
    return;
  }

  try {
    await ensureContentScript(tab.id);
    const response = await sendTabMessage(tab.id, { type: 'GET_CURRENT_JOB_INFO' });

    if (!response?.ok || !response.jobInfo) {
      throw new Error('无法读取当前职位信息');
    }

    const fileName = buildFilename(response.jobInfo);
    const textContent = buildTxtContent(response.jobInfo);
    const pageDownloadResponse = await sendTabMessage(tab.id, {
      type: 'DOWNLOAD_TXT_FILE',
      fileName,
      textContent
    });

    if (!pageDownloadResponse?.ok) {
      await chrome.downloads.download({
        url: encodeTextAsDataUrl(textContent),
        filename: fileName,
        saveAs: false,
        conflictAction: 'uniquify'
      });
    }

    await notifyTab(tab.id, `已导出 JD: ${fileName}`, false);
    await flashBadge('OK', '#15803d');
  } catch (error) {
    await notifyTab(tab.id, error?.message || '导出失败', true);
    await flashBadge('ERR', '#b91c1c');
  }
}

// ---------------------------------------------------------------------------
// OneClick Job Tracker auto-trigger support
// ---------------------------------------------------------------------------

const ONECLICK_AUTO_STATE_KEY = 'oneclickAutoState';

async function updateOneClickAutoState(patch) {
  try {
    const result = await chrome.storage.local.get(ONECLICK_AUTO_STATE_KEY);
    const current = result?.[ONECLICK_AUTO_STATE_KEY] || {};
    const next = { ...current, ...patch };
    await chrome.storage.local.set({ [ONECLICK_AUTO_STATE_KEY]: next });
  } catch (_error) {
    // Non-blocking.
  }
}

async function handleOneClickTriggered(message, sender) {
  const tab = sender?.tab;
  if (!tab?.id || !isLinkedInJobsPage(tab.url)) {
    await updateOneClickAutoState({
      lastTriggeredAt: new Date().toISOString(),
      lastFailureAt: new Date().toISOString(),
      lastErrorCode: 'INVALID_TAB',
      lastErrorMessage: '无效标签页或非 LinkedIn 职位页。',
      lastJobKey: message?.jobKey || null,
      lastSource: 'oneclick_auto'
    });
    return;
  }

  await updateOneClickAutoState({
    lastTriggeredAt: new Date().toISOString(),
    lastJobKey: message?.jobKey || null,
    lastSource: 'oneclick_auto'
  });

  try {
    await ensureContentScript(tab.id);
    const response = await sendTabMessage(tab.id, { type: 'GET_CURRENT_JOB_INFO' });

    if (!response?.ok || !response.jobInfo) {
      throw new Error('无法读取当前职位信息');
    }

    const fileName = buildFilename(response.jobInfo);
    const textContent = buildTxtContent(response.jobInfo);
    const pageDownloadResponse = await sendTabMessage(tab.id, {
      type: 'DOWNLOAD_TXT_FILE',
      fileName,
      textContent
    });

    if (!pageDownloadResponse?.ok) {
      await chrome.downloads.download({
        url: encodeTextAsDataUrl(textContent),
        filename: fileName,
        saveAs: false,
        conflictAction: 'uniquify'
      });
    }

    await notifyTab(tab.id, `OneClick 联动已导出 JD: ${fileName}`, false);
    await flashBadge('OK', '#15803d');

    await updateOneClickAutoState({
      lastSuccessAt: new Date().toISOString(),
      lastWrittenFileName: fileName,
      lastErrorCode: null,
      lastErrorMessage: null,
      lastRetryCount: 0
    });
  } catch (error) {
    await notifyTab(tab.id, error?.message || 'OneClick 联动导出失败', true);
    await flashBadge('ERR', '#b91c1c');

    await updateOneClickAutoState({
      lastFailureAt: new Date().toISOString(),
      lastErrorCode: 'EXPORT_FAILED',
      lastErrorMessage: error?.message || '导出失败'
    });
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'ONECLICK_TRIGGERED') {
    handleOneClickTriggered(message, sender).then(() => {
      sendResponse({ ok: true });
    }).catch(() => {
      sendResponse({ ok: false });
    });
    return true;
  }
  return undefined;
});

chrome.action.onClicked.addListener((tab) => {
  exportCurrentJobFromTab(tab);
});
