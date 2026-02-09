const IDB_CONFIG = {
  DB_NAME: 'linkedinJobTrackerDB',
  STORE_NAME: 'handles',
  HANDLE_KEY: 'trackerCsvHandle',
  TXT_OUTPUT_DIR_HANDLE_KEY: 'txtOutputDirHandle'
};

const PENDING_DRAFT_KEY = 'trackerPendingDraft';
const MESSAGE_TIMEOUT_MS = 15000;

let activeTab = null;
let currentJobInfo = null;
let currentBindingState = null;
let currentOutputBindingState = null;
let dbPromise = null;

function setStatus(message, type) {
  const status = document.getElementById('status');
  status.textContent = message;
  status.className = 'status';
  if (type === 'error') status.classList.add('error');
  if (type === 'success') status.classList.add('success');
}

function mapErrorMessage(responseOrError) {
  const code = responseOrError?.errorCode || responseOrError?.code;
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
  if (code === 'NO_OUTPUT_DIR_BOUND') {
    return '尚未设置 TXT 保存文件夹，请先绑定。';
  }
  if (code === 'OUTPUT_DIR_PERMISSION_DENIED') {
    return 'TXT 保存文件夹权限不足，请重新设置。';
  }
  if (code === 'OUTPUT_DIR_NOT_FOUND') {
    return 'TXT 保存文件夹不可用，请重新设置。';
  }
  if (code === 'OUTPUT_WRITE_FAILED') {
    return '写入 TXT 失败，请稍后重试。';
  }
  if (code === 'TRACKER_UPSERT_FAILED') {
    return 'TXT 已导出，但 CSV 同步失败，请检查 CSV 绑定与权限。';
  }
  if (code === 'MESSAGE_TIMEOUT') {
    return '请求超时，请重试。';
  }
  if (code === 'MESSAGE_NO_RESPONSE') {
    return '扩展未返回结果，请刷新页面后重试。';
  }
  if (code === 'CSV_BINDING_MISMATCH') {
    return 'CSV 绑定校验失败，请重新绑定后重试。';
  }
  if (code === 'OUTPUT_BINDING_MISMATCH') {
    return 'TXT 输出目录绑定校验失败，请重新设置后重试。';
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
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(createMappedError('MESSAGE_TIMEOUT', '扩展后台请求超时，请重试。'));
    }, MESSAGE_TIMEOUT_MS);

    chrome.runtime.sendMessage(message, (response) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (response === undefined) {
        reject(createMappedError('MESSAGE_NO_RESPONSE', '扩展后台没有返回结果。'));
        return;
      }
      resolve(response);
    });
  });
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(createMappedError('MESSAGE_TIMEOUT', '页面通信超时，请重试。'));
    }, MESSAGE_TIMEOUT_MS);

    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (response === undefined) {
        reject(createMappedError('MESSAGE_NO_RESPONSE', '页面脚本没有返回结果。'));
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
    let settled = false;
    const settleResolve = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const settleReject = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    request.onerror = () => settleReject(request.error || new Error('Failed to store CSV handle.'));
    transaction.oncomplete = () => settleResolve();
    transaction.onerror = () => settleReject(transaction.error || request.error || new Error('Failed to store CSV handle.'));
    transaction.onabort = () => settleReject(transaction.error || new Error('Storing CSV handle was aborted.'));
  });
}

async function getStoredHandle() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(IDB_CONFIG.STORE_NAME, 'readonly');
    const store = transaction.objectStore(IDB_CONFIG.STORE_NAME);
    const request = store.get(IDB_CONFIG.HANDLE_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function setStoredTxtOutputDirHandle(handle) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(IDB_CONFIG.STORE_NAME, 'readwrite');
    const store = transaction.objectStore(IDB_CONFIG.STORE_NAME);
    const request = store.put(handle, IDB_CONFIG.TXT_OUTPUT_DIR_HANDLE_KEY);
    let settled = false;
    const settleResolve = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const settleReject = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    request.onerror = () => settleReject(request.error || new Error('Failed to store TXT output handle.'));
    transaction.oncomplete = () => settleResolve();
    transaction.onerror = () => settleReject(transaction.error || request.error || new Error('Failed to store TXT output handle.'));
    transaction.onabort = () => settleReject(transaction.error || new Error('Storing TXT output handle was aborted.'));
  });
}

async function getStoredTxtOutputDirHandle() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(IDB_CONFIG.STORE_NAME, 'readonly');
    const store = transaction.objectStore(IDB_CONFIG.STORE_NAME);
    const request = store.get(IDB_CONFIG.TXT_OUTPUT_DIR_HANDLE_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

function createMappedError(errorCode, message, cause) {
  const error = new Error(message);
  error.errorCode = errorCode;
  if (cause) {
    error.cause = cause;
  }
  return error;
}

async function ensureHandlePermission(handle, permissionLabel = '文件') {
  let permission = await handle.queryPermission({ mode: 'readwrite' });
  if (permission !== 'granted') {
    permission = await handle.requestPermission({ mode: 'readwrite' });
  }
  if (permission !== 'granted') {
    throw new Error(`未授予${permissionLabel}读写权限。`);
  }
}

async function ensureStoredHandlePermission(handle, options) {
  const permissionDeniedCode = options.permissionDeniedCode;
  const notFoundCode = options.notFoundCode;
  const notFoundMessage = options.notFoundMessage;
  if (!handle || typeof handle.queryPermission !== 'function') {
    throw createMappedError(permissionDeniedCode, options.unavailableMessage);
  }

  let permission = 'prompt';
  try {
    permission = await handle.queryPermission({ mode: 'readwrite' });
  } catch (error) {
    if (error?.name === 'NotFoundError' && notFoundCode) {
      throw createMappedError(notFoundCode, notFoundMessage, error);
    }
    throw createMappedError(permissionDeniedCode, options.deniedMessage, error);
  }

  if (permission !== 'granted') {
    try {
      permission = await handle.requestPermission({ mode: 'readwrite' });
    } catch (error) {
      if (error?.name === 'NotFoundError' && notFoundCode) {
        throw createMappedError(notFoundCode, notFoundMessage, error);
      }
      throw createMappedError(permissionDeniedCode, options.deniedMessage, error);
    }
  }

  if (permission !== 'granted') {
    throw createMappedError(permissionDeniedCode, options.deniedMessage);
  }
}

async function ensureStoredCsvWritePermission() {
  const handle = await getStoredHandle();
  if (!handle) {
    try {
      const remoteState = await sendRuntimeMessage({ type: 'TRACKER_GET_BINDING_STATE' });
      if (remoteState?.ok && remoteState.isBound) {
        return;
      }
    } catch (_error) {
      // Ignore fallback read errors; surface the original NO_BOUND_FILE below.
    }
    throw createMappedError('NO_BOUND_FILE', '尚未绑定 CSV 文件。');
  }
  await ensureStoredHandlePermission(handle, {
    permissionDeniedCode: 'PERMISSION_DENIED',
    notFoundCode: 'FILE_NOT_FOUND',
    unavailableMessage: 'CSV 文件句柄不可用，请重新绑定。',
    deniedMessage: 'CSV 文件读写权限不足，请重新绑定。',
    notFoundMessage: '绑定的 CSV 文件找不到，请重新绑定。'
  });
}

async function ensureStoredTxtOutputWritePermission() {
  const handle = await getStoredTxtOutputDirHandle();
  if (!handle) {
    try {
      const remoteState = await sendRuntimeMessage({ type: 'TXT_GET_OUTPUT_STATE' });
      if (remoteState?.ok && remoteState.isBound) {
        return;
      }
    } catch (_error) {
      // Ignore fallback read errors; surface the original NO_OUTPUT_DIR_BOUND below.
    }
    throw createMappedError('NO_OUTPUT_DIR_BOUND', '尚未设置 TXT 保存文件夹。');
  }
  await ensureStoredHandlePermission(handle, {
    permissionDeniedCode: 'OUTPUT_DIR_PERMISSION_DENIED',
    notFoundCode: 'OUTPUT_DIR_NOT_FOUND',
    unavailableMessage: 'TXT 保存文件夹句柄不可用，请重新设置。',
    deniedMessage: 'TXT 保存文件夹权限不足，请重新设置。',
    notFoundMessage: 'TXT 保存文件夹不可用，请重新设置。'
  });
}

function setTrackingEnabled(enabled) {
  const ids = ['status-select', 'round1-pass', 'round2-pass', 'round3-pass', 'notes-input', 'save-track-btn', 'export-btn'];
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
  if (state.lastError && (state.needsRebind || state.lastError !== 'UNKNOWN_ERROR')) {
    parts.push(`Error: ${state.lastError}`);
  }
  detail.textContent = parts.join(' | ');
}

function updateTxtOutputBindingUi(state) {
  const summary = document.getElementById('txt-output-summary');
  const detail = document.getElementById('txt-output-detail');
  if (!summary || !detail) return;

  if (!state?.isBound) {
    summary.textContent = '未绑定 TXT 保存文件夹';
    detail.textContent = state?.lastError ? `错误: ${state.lastError}` : '请先设置 TXT 保存文件夹。';
    return;
  }

  summary.textContent = `已绑定: ${state.directoryName || '输出文件夹'}`;
  const parts = [];
  if (state.boundAt) parts.push(`Bound: ${new Date(state.boundAt).toLocaleString()}`);
  if (state.lastWriteAt) parts.push(`Last Write: ${new Date(state.lastWriteAt).toLocaleString()}`);
  if (state.needsRebind) parts.push('需要重新绑定');
  if (state.lastError && (state.needsRebind || state.lastError !== 'UNKNOWN_ERROR')) {
    parts.push(`Error: ${state.lastError}`);
  }
  detail.textContent = parts.join(' | ');
}

async function refreshBindingState(options = {}) {
  const throwOnError = Boolean(options.throwOnError);
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
    if (throwOnError) throw error;
    return null;
  }
}

async function refreshOutputBindingState(options = {}) {
  const throwOnError = Boolean(options.throwOnError);
  try {
    const response = await sendRuntimeMessage({ type: 'TXT_GET_OUTPUT_STATE' });
    if (!response?.ok) {
      throw new Error(mapErrorMessage(response));
    }
    currentOutputBindingState = response;
    updateTxtOutputBindingUi(response);
    return response;
  } catch (error) {
    setStatus(error.message || '获取 TXT 输出目录状态失败。', 'error');
    if (throwOnError) throw error;
    return null;
  }
}

function assertBindingName(state, expectedName) {
  if (!state?.isBound) {
    throw createMappedError('NO_BOUND_FILE', 'CSV 未绑定。');
  }
  const actualName = String(state.fileName || '').trim();
  const wantedName = String(expectedName || '').trim();
  if (!actualName || !wantedName || actualName === wantedName) return;
  throw createMappedError('CSV_BINDING_MISMATCH', `CSV 绑定校验失败，当前为 ${actualName}，预期为 ${wantedName}。`);
}

function assertOutputDirectoryName(state, expectedName) {
  if (!state?.isBound) {
    throw createMappedError('NO_OUTPUT_DIR_BOUND', 'TXT 保存文件夹未绑定。');
  }
  const actualName = String(state.directoryName || '').trim();
  const wantedName = String(expectedName || '').trim();
  if (!actualName || !wantedName || actualName === wantedName) return;
  throw createMappedError('OUTPUT_BINDING_MISMATCH', `TXT 输出目录校验失败，当前为 ${actualName}，预期为 ${wantedName}。`);
}

async function validateBindingConsistency() {
  const storedCsvHandle = await getStoredHandle();
  if (storedCsvHandle?.name && currentBindingState?.isBound) {
    assertBindingName(currentBindingState, storedCsvHandle.name);
  }

  const storedOutputHandle = await getStoredTxtOutputDirHandle();
  if (storedOutputHandle?.name && currentOutputBindingState?.isBound) {
    assertOutputDirectoryName(currentOutputBindingState, storedOutputHandle.name);
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
    fileHandle: handle,
    fileName: handle.name,
    boundAt: new Date().toISOString()
  });
  if (!response?.ok) {
    throw new Error(mapErrorMessage(response));
  }
  const state = await refreshBindingState({ throwOnError: true });
  assertBindingName(state, handle.name);
  await refreshOutputBindingState({ throwOnError: true });
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
    fileHandle: handle,
    fileName: handle.name,
    boundAt: new Date().toISOString()
  });
  if (!response?.ok) {
    throw new Error(mapErrorMessage(response));
  }
  const state = await refreshBindingState({ throwOnError: true });
  assertBindingName(state, handle.name);
  await refreshOutputBindingState({ throwOnError: true });
}

async function bindTxtOutputDirectory() {
  if (!window.showDirectoryPicker) {
    throw new Error('当前环境不支持目录选择器。');
  }

  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  await ensureHandlePermission(handle, 'TXT 保存文件夹');
  await setStoredTxtOutputDirHandle(handle);
  const response = await sendRuntimeMessage({
    type: 'TXT_BIND_OUTPUT_DIR',
    directoryHandle: handle,
    directoryName: handle.name,
    boundAt: new Date().toISOString()
  });
  if (!response?.ok) {
    throw new Error(mapErrorMessage(response));
  }
  const outputState = await refreshOutputBindingState({ throwOnError: true });
  assertOutputDirectoryName(outputState, handle.name);
  await refreshBindingState({ throwOnError: true });
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

  if (!currentBindingState?.isBound) {
    throw new Error('CSV 未绑定。');
  }

  const form = readFormState();
  const payload = {
    job_id: '',
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
  activeTab = await getActiveTab();
  await refreshBindingState();
  await refreshOutputBindingState();
  await validateBindingConsistency();

  if (!activeTab?.id || !isLinkedInJobsPage(activeTab?.url)) {
    throw new Error('请先打开 LinkedIn 职位详情页。');
  }

  if (!currentBindingState?.isBound) {
    throw new Error('CSV 未绑定。');
  }

  // Re-check and request permission on user click to avoid stale handle permission.
  await ensureStoredCsvWritePermission();
  await ensureStoredTxtOutputWritePermission();

  await ensureScriptInjected(activeTab.id);
  const response = await sendTabMessage(activeTab.id, { type: 'EXPORT_TXT' });
  if (!response?.ok) {
    throw new Error(mapErrorMessage(response));
  }

  if (response.trackerResult && response.trackerResult.ok === false) {
    throw createMappedError(
      response.trackerResult.errorCode || 'TRACKER_UPSERT_FAILED',
      response.trackerResult.message || 'CSV 同步失败。'
    );
  }

  await refreshBindingState();
  await refreshOutputBindingState();
  return response;
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
  const bindTxtOutputButton = document.getElementById('bind-txt-output-btn');
  const saveTrackButton = document.getElementById('save-track-btn');
  const exportButton = document.getElementById('export-btn');

  registerFormPersistenceListeners();

  bindExistingButton.addEventListener('click', () => {
    withLoading(bindExistingButton, '绑定中...', async () => {
      await bindExistingCsv();
      setStatus('CSV 绑定成功。', 'success');
      await loadRecordIntoForm();
    })().catch((error) => {
      setStatus(mapErrorMessage(error) || 'CSV 绑定失败。', 'error');
    });
  });

  createTemplateButton.addEventListener('click', () => {
    withLoading(createTemplateButton, '创建中...', async () => {
      await createTemplateCsvAndBind();
      setStatus('模板 CSV 已创建并绑定。', 'success');
      await loadRecordIntoForm();
    })().catch((error) => {
      setStatus(mapErrorMessage(error) || '模板创建失败。', 'error');
    });
  });

  bindTxtOutputButton.addEventListener('click', () => {
    withLoading(bindTxtOutputButton, '设置中...', async () => {
      await bindTxtOutputDirectory();
      setStatus('TXT 保存文件夹设置成功。', 'success');
    })().catch((error) => {
      setStatus(mapErrorMessage(error) || 'TXT 保存文件夹设置失败。', 'error');
    });
  });

  saveTrackButton.addEventListener('click', () => {
    withLoading(saveTrackButton, '保存中...', async () => {
      await saveTracking();
      setStatus('追踪记录已保存。', 'success');
    })().catch((error) => {
      setStatus(mapErrorMessage(error) || '保存失败。', 'error');
    });
  });

  exportButton.addEventListener('click', () => {
    withLoading(exportButton, '导出中...', async () => {
      setStatus('导出中...', 'success');
      const result = await exportTxtFromPopup();
      const writtenFileName = String(result?.writtenFileName || '').trim();
      const successMessage = writtenFileName ? `导出完成：${writtenFileName}；CSV 已同步。` : '导出完成；CSV 已同步。';
      setStatus(successMessage, 'success');
      await loadRecordIntoForm();
    })().catch((error) => {
      setStatus(mapErrorMessage(error) || '导出失败。', 'error');
    });
  });

  try {
    await refreshBindingState();
    await refreshOutputBindingState();
    await refreshCurrentJobInfo();
    await loadRecordIntoForm();
    setStatus('准备就绪。', 'success');
  } catch (error) {
    setStatus(error.message || '初始化失败。', 'error');
  }
});
