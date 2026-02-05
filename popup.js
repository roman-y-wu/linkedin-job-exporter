const IDB_CONFIG = {
  DB_NAME: 'linkedinJobTrackerDB',
  STORE_NAME: 'handles',
  HANDLE_KEY: 'trackerCsvHandle'
};

const PENDING_DRAFT_KEY = 'trackerPendingDraft';

let activeTab = null;
let currentJobInfo = null;
let currentBindingState = null;
let dbPromise = null;

function setStatus(message, type) {
  const status = document.getElementById('status');
  status.textContent = message;
  status.className = 'status';
  if (type === 'error') status.classList.add('error');
  if (type === 'success') status.classList.add('success');
}

function mapErrorMessage(responseOrError) {
  const code = responseOrError?.errorCode;
  if (code === 'SCHEMA_MISMATCH') {
    return 'CSV 表头不匹配。请使用“创建标准模板 CSV”。';
  }
  if (code === 'PERMISSION_DENIED') {
    return 'CSV 文件读写权限不足，请重新绑定。';
  }
  if (code === 'FILE_NOT_FOUND') {
    return '绑定的 CSV 文件找不到，请重新绑定。';
  }
  if (code === 'NO_BOUND_FILE') {
    return '尚未绑定 CSV 文件。';
  }
  return responseOrError?.message || '操作失败。';
}

function isLinkedInJobsPage(url) {
  if (!url) return false;
  return /^https?:\/\/([a-z0-9-]+\.)?linkedin\.com\/jobs\//i.test(url);
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs?.[0] || null;
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
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

async function ensureScriptInjected(tabId) {
  try {
    const pingResponse = await sendTabMessage(tabId, { type: 'PING' });
    if (pingResponse?.ok) return;
  } catch (_error) {
    // No-op, continue with injection.
  }

  await chrome.scripting.insertCSS({ target: { tabId }, files: ['styles.css'] });
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
}

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_CONFIG.DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IDB_CONFIG.STORE_NAME)) {
        db.createObjectStore(IDB_CONFIG.STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function setStoredHandle(handle) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(IDB_CONFIG.STORE_NAME, 'readwrite');
    const store = transaction.objectStore(IDB_CONFIG.STORE_NAME);
    const request = store.put(handle, IDB_CONFIG.HANDLE_KEY);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function ensureHandlePermission(handle) {
  let permission = await handle.queryPermission({ mode: 'readwrite' });
  if (permission !== 'granted') {
    permission = await handle.requestPermission({ mode: 'readwrite' });
  }
  if (permission !== 'granted') {
    throw new Error('未授予 CSV 读写权限。');
  }
}

function setTrackingEnabled(enabled) {
  const ids = ['status-select', 'round1-pass', 'round2-pass', 'round3-pass', 'notes-input', 'save-track-btn', 'export-btn', 'inject-btn'];
  for (const id of ids) {
    const element = document.getElementById(id);
    if (element) {
      element.disabled = !enabled;
    }
  }
}

function setJobSummary(message) {
  const summary = document.getElementById('job-summary');
  summary.textContent = message;
}

function normalizeRound(value) {
  return value === true || value === 1 || String(value || '') === '1' ? 1 : 0;
}

function readFormState() {
  return {
    status: document.getElementById('status-select').value,
    round1_pass: document.getElementById('round1-pass').checked ? 1 : 0,
    round2_pass: document.getElementById('round2-pass').checked ? 1 : 0,
    round3_pass: document.getElementById('round3-pass').checked ? 1 : 0,
    notes: document.getElementById('notes-input').value
  };
}

function setFormState(record) {
  const statusSelect = document.getElementById('status-select');
  const round1 = document.getElementById('round1-pass');
  const round2 = document.getElementById('round2-pass');
  const round3 = document.getElementById('round3-pass');
  const notes = document.getElementById('notes-input');

  statusSelect.value = ['Saved', 'Applied', 'Interview', 'Rejected', 'Ghosted'].includes(record.status) ? record.status : 'Saved';
  round1.checked = normalizeRound(record.round1_pass) === 1;
  round2.checked = normalizeRound(record.round2_pass) === 1;
  round3.checked = normalizeRound(record.round3_pass) === 1;
  notes.value = record.notes || '';
}

function setDefaultFormState() {
  setFormState({
    status: 'Saved',
    round1_pass: 0,
    round2_pass: 0,
    round3_pass: 0,
    notes: ''
  });
}

async function savePendingDraft() {
  if (!currentJobInfo?.jobKey) return;
  const formState = readFormState();
  await chrome.storage.local.set({
    [PENDING_DRAFT_KEY]: {
      job_key: currentJobInfo.jobKey,
      ...formState
    }
  });
}

async function clearPendingDraft() {
  await chrome.storage.local.remove(PENDING_DRAFT_KEY);
}

async function loadPendingDraft() {
  if (!currentJobInfo?.jobKey) return null;
  const result = await chrome.storage.local.get(PENDING_DRAFT_KEY);
  const pending = result?.[PENDING_DRAFT_KEY];
  if (!pending || pending.job_key !== currentJobInfo.jobKey) return null;
  return pending;
}

function updateBindingUi(state) {
  const summary = document.getElementById('binding-summary');
  const detail = document.getElementById('binding-detail');
  if (!state?.isBound) {
    summary.textContent = '未绑定 CSV';
    detail.textContent = state?.lastError ? `错误: ${state.lastError}` : '请先绑定 CSV 文件。';
    return;
  }

  summary.textContent = `已绑定: ${state.fileName || 'tracker.csv'}`;
  const parts = [];
  if (state.boundAt) parts.push(`Bound: ${new Date(state.boundAt).toLocaleString()}`);
  if (state.lastSyncAt) parts.push(`Last Sync: ${new Date(state.lastSyncAt).toLocaleString()}`);
  if (state.needsRebind) parts.push('需要重新绑定');
  if (state.lastError) parts.push(`Error: ${state.lastError}`);
  detail.textContent = parts.join(' | ');
}

async function refreshBindingState() {
  try {
    const response = await sendRuntimeMessage({ type: 'TRACKER_GET_BINDING_STATE' });
    if (!response?.ok) {
      throw new Error(mapErrorMessage(response));
    }
    currentBindingState = response;
    updateBindingUi(response);
    return response;
  } catch (error) {
    setStatus(error.message || '获取绑定状态失败。', 'error');
    return null;
  }
}

function getCsvPickerType() {
  return [
    {
      description: 'CSV files',
      accept: {
        'text/csv': ['.csv']
      }
    }
  ];
}

async function bindExistingCsv() {
  if (!window.showOpenFilePicker) {
    throw new Error('当前环境不支持本地文件选择器。');
  }

  const handles = await window.showOpenFilePicker({
    types: getCsvPickerType(),
    multiple: false
  });
  const handle = handles[0];
  await ensureHandlePermission(handle);
  await setStoredHandle(handle);
  const response = await sendRuntimeMessage({
    type: 'TRACKER_BIND_CSV',
    fileName: handle.name,
    boundAt: new Date().toISOString()
  });
  if (!response?.ok) {
    throw new Error(mapErrorMessage(response));
  }
}

async function createTemplateCsvAndBind() {
  if (!window.showSaveFilePicker) {
    throw new Error('当前环境不支持创建本地文件。');
  }

  const now = new Date();
  const suggestedName = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_linkedin_job_tracker.csv`;
  const handle = await window.showSaveFilePicker({
    suggestedName,
    types: getCsvPickerType()
  });

  await ensureHandlePermission(handle);
  const templateText = TrackerCsv.serializeObjects([], TrackerCsv.CSV_HEADERS, true);
  const writable = await handle.createWritable();
  await writable.write(templateText);
  await writable.close();

  await setStoredHandle(handle);
  const response = await sendRuntimeMessage({
    type: 'TRACKER_BIND_CSV',
    fileName: handle.name,
    boundAt: new Date().toISOString()
  });
  if (!response?.ok) {
    throw new Error(mapErrorMessage(response));
  }
}

async function refreshCurrentJobInfo() {
  activeTab = await getActiveTab();
  const isLinkedIn = isLinkedInJobsPage(activeTab?.url);
  setTrackingEnabled(Boolean(activeTab?.id && isLinkedIn));

  if (!activeTab?.id || !isLinkedIn) {
    currentJobInfo = null;
    setJobSummary('请打开 LinkedIn 职位详情页（URL 包含 /jobs/）。');
    return;
  }

  await ensureScriptInjected(activeTab.id);
  const response = await sendTabMessage(activeTab.id, { type: 'GET_CURRENT_JOB_INFO' });
  if (!response?.ok || !response.jobInfo) {
    throw new Error('无法读取当前职位信息。');
  }

  currentJobInfo = response.jobInfo;
  setJobSummary(`${currentJobInfo.companyName} | ${currentJobInfo.jobTitle}`);
}

async function loadRecordIntoForm() {
  setDefaultFormState();
  if (!currentJobInfo?.jobKey) return;

  if (currentBindingState?.isBound) {
    const existing = await sendRuntimeMessage({
      type: 'TRACKER_GET_BY_JOB_KEY',
      jobKey: currentJobInfo.jobKey
    });
    if (existing?.ok && existing.record) {
      setFormState(existing.record);
    }
  }

  const pending = await loadPendingDraft();
  if (pending) {
    setFormState(pending);
    setStatus('已恢复未提交草稿。', 'success');
  }
}

function withLoading(button, loadingText, task) {
  return async () => {
    const original = button.textContent;
    button.disabled = true;
    button.textContent = loadingText;
    try {
      await task();
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  };
}

async function saveTracking() {
  if (!currentJobInfo?.jobKey) {
    throw new Error('未检测到当前职位信息。');
  }

  if (!currentBindingState?.isBound || currentBindingState?.needsRebind) {
    throw new Error('CSV 未绑定或需要重新绑定。');
  }

  const form = readFormState();
  const payload = {
    job_key: currentJobInfo.jobKey,
    job_id: currentJobInfo.jobId,
    company: currentJobInfo.companyName,
    position: currentJobInfo.jobTitle,
    location: currentJobInfo.location,
    job_url: currentJobInfo.jobUrl,
    status: form.status,
    round1_pass: form.round1_pass,
    round2_pass: form.round2_pass,
    round3_pass: form.round3_pass,
    notes: form.notes
  };

  const response = await sendRuntimeMessage({
    type: 'TRACKER_UPSERT',
    recordDraft: payload,
    source: 'popup'
  });

  if (!response?.ok) {
    throw new Error(mapErrorMessage(response));
  }

  await clearPendingDraft();
  await refreshBindingState();
}

async function exportTxtFromPopup() {
  if (!activeTab?.id || !isLinkedInJobsPage(activeTab?.url)) {
    throw new Error('请先打开 LinkedIn 职位详情页。');
  }

  await ensureScriptInjected(activeTab.id);
  const response = await sendTabMessage(activeTab.id, { type: 'EXPORT_TXT' });
  if (!response?.ok) {
    throw new Error(mapErrorMessage(response));
  }

  await refreshBindingState();
  if (response.trackerResult && response.trackerResult.ok === false) {
    throw new Error(mapErrorMessage(response.trackerResult));
  }
}

async function injectButtonsFromPopup() {
  if (!activeTab?.id || !isLinkedInJobsPage(activeTab?.url)) {
    throw new Error('请先打开 LinkedIn 职位详情页。');
  }

  await ensureScriptInjected(activeTab.id);
  const response = await sendTabMessage(activeTab.id, { type: 'INJECT_BUTTON' });
  if (!response?.ok) {
    throw new Error('按钮注入失败。');
  }
}

function registerFormPersistenceListeners() {
  const ids = ['status-select', 'round1-pass', 'round2-pass', 'round3-pass', 'notes-input'];
  for (const id of ids) {
    const element = document.getElementById(id);
    element.addEventListener('change', () => {
      savePendingDraft().catch(() => {
        // Ignore draft persistence failures.
      });
    });
    element.addEventListener('input', () => {
      savePendingDraft().catch(() => {
        // Ignore draft persistence failures.
      });
    });
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const bindExistingButton = document.getElementById('bind-existing-btn');
  const createTemplateButton = document.getElementById('create-template-btn');
  const saveTrackButton = document.getElementById('save-track-btn');
  const exportButton = document.getElementById('export-btn');
  const injectButton = document.getElementById('inject-btn');

  registerFormPersistenceListeners();

  bindExistingButton.addEventListener('click', () => {
    withLoading(bindExistingButton, '绑定中...', async () => {
      await bindExistingCsv();
      await refreshBindingState();
      setStatus('CSV 绑定成功。', 'success');
      await loadRecordIntoForm();
    })().catch((error) => {
      setStatus(error.message || 'CSV 绑定失败。', 'error');
    });
  });

  createTemplateButton.addEventListener('click', () => {
    withLoading(createTemplateButton, '创建中...', async () => {
      await createTemplateCsvAndBind();
      await refreshBindingState();
      setStatus('模板 CSV 已创建并绑定。', 'success');
      await loadRecordIntoForm();
    })().catch((error) => {
      setStatus(error.message || '模板创建失败。', 'error');
    });
  });

  saveTrackButton.addEventListener('click', () => {
    withLoading(saveTrackButton, '保存中...', async () => {
      await saveTracking();
      setStatus('追踪记录已保存。', 'success');
    })().catch((error) => {
      setStatus(error.message || '保存失败。', 'error');
    });
  });

  exportButton.addEventListener('click', () => {
    withLoading(exportButton, '导出中...', async () => {
      await exportTxtFromPopup();
      setStatus('导出完成，已同步追踪。', 'success');
      await loadRecordIntoForm();
    })().catch((error) => {
      setStatus(error.message || '导出失败。', 'error');
    });
  });

  injectButton.addEventListener('click', () => {
    withLoading(injectButton, '处理中...', async () => {
      await injectButtonsFromPopup();
      setStatus('已尝试注入页面按钮。', 'success');
    })().catch((error) => {
      setStatus(error.message || '注入失败。', 'error');
    });
  });

  try {
    await refreshBindingState();
    await refreshCurrentJobInfo();
    await loadRecordIntoForm();
    setStatus('准备就绪。', 'success');
  } catch (error) {
    setStatus(error.message || '初始化失败。', 'error');
  }
});
