importScripts('lib/tracker_csv.js');

const STORAGE_KEYS = {
  BINDING_META: 'trackerBindingMeta',
  TXT_OUTPUT_BINDING_META: 'txtOutputBindingMeta'
};

const IDB_CONFIG = {
  DB_NAME: 'linkedinJobTrackerDB',
  STORE_NAME: 'handles',
  HANDLE_KEY: 'trackerCsvHandle',
  TXT_OUTPUT_DIR_HANDLE_KEY: 'txtOutputDirHandle'
};

const ERROR_CODES = {
  NO_BOUND_FILE: 'NO_BOUND_FILE',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  SCHEMA_MISMATCH: 'SCHEMA_MISMATCH',
  NO_OUTPUT_DIR_BOUND: 'NO_OUTPUT_DIR_BOUND',
  OUTPUT_DIR_PERMISSION_DENIED: 'OUTPUT_DIR_PERMISSION_DENIED',
  OUTPUT_DIR_NOT_FOUND: 'OUTPUT_DIR_NOT_FOUND',
  OUTPUT_WRITE_FAILED: 'OUTPUT_WRITE_FAILED',
  INVALID_INPUT: 'INVALID_INPUT',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR'
};

const STATUS_TO_DATE_FIELD = {
  Saved: 'saved_at',
  Applied: 'applied_at',
  Interview: 'interview_at',
  Rejected: 'rejected_at',
  Ghosted: 'ghosted_at'
};

const TRACKER_NEEDS_REBIND_CODES = new Set([
  ERROR_CODES.NO_BOUND_FILE,
  ERROR_CODES.PERMISSION_DENIED,
  ERROR_CODES.FILE_NOT_FOUND,
  ERROR_CODES.SCHEMA_MISMATCH
]);

const TXT_OUTPUT_NEEDS_REBIND_CODES = new Set([
  ERROR_CODES.NO_OUTPUT_DIR_BOUND,
  ERROR_CODES.OUTPUT_DIR_PERMISSION_DENIED,
  ERROR_CODES.OUTPUT_DIR_NOT_FOUND
]);

const NEEDS_REBIND_CODES = new Set([...TRACKER_NEEDS_REBIND_CODES, ...TXT_OUTPUT_NEEDS_REBIND_CODES]);

let dbPromise = null;
let writeQueue = Promise.resolve();

function makeError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause) {
    error.cause = cause;
  }
  return error;
}

function isFileHandleLike(handle) {
  return Boolean(handle && typeof handle.getFile === 'function' && typeof handle.createWritable === 'function');
}

function isDirectoryHandleLike(handle) {
  return Boolean(handle && typeof handle.getFileHandle === 'function');
}

function getDefaultBindingMeta() {
  return {
    isBound: false,
    fileName: '',
    boundAt: null,
    lastSyncAt: null,
    lastError: null,
    needsRebind: false
  };
}

function getDefaultTxtOutputBindingMeta() {
  return {
    isBound: false,
    directoryName: '',
    boundAt: null,
    lastWriteAt: null,
    lastError: null,
    needsRebind: false
  };
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

async function getBindingMeta() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.BINDING_META);
  const meta = result?.[STORAGE_KEYS.BINDING_META];
  return { ...getDefaultBindingMeta(), ...(meta || {}) };
}

async function updateBindingMeta(patch) {
  const current = await getBindingMeta();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [STORAGE_KEYS.BINDING_META]: next });
  return next;
}

async function getTxtOutputBindingMeta() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.TXT_OUTPUT_BINDING_META);
  const meta = result?.[STORAGE_KEYS.TXT_OUTPUT_BINDING_META];
  return { ...getDefaultTxtOutputBindingMeta(), ...(meta || {}) };
}

async function updateTxtOutputBindingMeta(patch) {
  const current = await getTxtOutputBindingMeta();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [STORAGE_KEYS.TXT_OUTPUT_BINDING_META]: next });
  return next;
}

function normalizeStatus(status) {
  const candidate = String(status || '').trim();
  return TrackerCsv.STATUS_VALUES.includes(candidate) ? candidate : 'Saved';
}

function normalizeRoundValue(value) {
  if (value === true || value === 1) return '1';
  const candidate = String(value || '').trim().toLowerCase();
  if (candidate === '1' || candidate === 'true' || candidate === 'yes') return '1';
  return '0';
}

function inferErrorCode(error) {
  if (!error) return ERROR_CODES.UNKNOWN_ERROR;
  if (error.code) return error.code;
  const message = String(error?.message || '').toLowerCase();
  if (message.includes('getfile is not a function') || message.includes('createwritable is not a function')) {
    return ERROR_CODES.NO_BOUND_FILE;
  }
  if (message.includes('getfilehandle is not a function')) {
    return ERROR_CODES.NO_OUTPUT_DIR_BOUND;
  }
  if (error.name === 'NotFoundError') return ERROR_CODES.FILE_NOT_FOUND;
  if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return ERROR_CODES.PERMISSION_DENIED;
  return ERROR_CODES.UNKNOWN_ERROR;
}

function toErrorPayload(error) {
  const errorCode = inferErrorCode(error);
  return {
    ok: false,
    errorCode,
    message: error?.message || 'Unknown extension error',
    needsRebind: NEEDS_REBIND_CODES.has(errorCode)
  };
}

async function applyTrackerErrorState(errorPayload) {
  const patch = {
    lastError: errorPayload.errorCode || ERROR_CODES.UNKNOWN_ERROR
  };
  if (errorPayload.needsRebind) {
    patch.needsRebind = true;
  }
  await updateBindingMeta(patch);
}

async function applyTxtOutputErrorState(errorPayload) {
  const patch = {
    lastError: errorPayload.errorCode || ERROR_CODES.UNKNOWN_ERROR
  };
  if (errorPayload.needsRebind) {
    patch.needsRebind = true;
  }
  await updateTxtOutputBindingMeta(patch);
}

async function applyErrorStateByMessageType(messageType, errorPayload) {
  if (String(messageType || '').startsWith('TRACKER_')) {
    await applyTrackerErrorState(errorPayload);
    return;
  }
  if (String(messageType || '').startsWith('TXT_')) {
    await applyTxtOutputErrorState(errorPayload);
  }
}

async function resolveBindingState() {
  const meta = await getBindingMeta();
  const rawHandle = await getStoredHandle();
  const handle = isFileHandleLike(rawHandle) ? rawHandle : null;
  const hasKnownRebindError = Boolean(meta.lastError && TRACKER_NEEDS_REBIND_CODES.has(meta.lastError));

  let permission = 'unavailable';
  let needsRebind = false;
  let isBound = Boolean(handle);
  let fileName = meta.fileName || (handle?.name || rawHandle?.name || '');

  if (handle && typeof handle.queryPermission === 'function') {
    try {
      permission = await handle.queryPermission({ mode: 'readwrite' });
    } catch (_error) {
      permission = 'unknown';
    }
  }
  if (!handle && meta.isBound) {
    needsRebind = true;
  }

  if (rawHandle && !handle) {
    needsRebind = true;
  }

  if (hasKnownRebindError) {
    needsRebind = true;
  }

  if (permission === 'denied') {
    needsRebind = true;
  }

  if (!handle) {
    isBound = false;
  }

  return {
    isBound,
    fileName,
    boundAt: meta.boundAt,
    lastSyncAt: meta.lastSyncAt,
    lastError: meta.lastError,
    needsRebind,
    permission
  };
}

async function resolveTxtOutputState() {
  const meta = await getTxtOutputBindingMeta();
  const rawHandle = await getStoredTxtOutputDirHandle();
  const handle = isDirectoryHandleLike(rawHandle) ? rawHandle : null;
  const hasKnownRebindError = Boolean(meta.lastError && TXT_OUTPUT_NEEDS_REBIND_CODES.has(meta.lastError));

  let permission = 'unavailable';
  let needsRebind = false;
  let isBound = Boolean(handle);
  const directoryName = meta.directoryName || (handle?.name || rawHandle?.name || '');

  if (handle && typeof handle.queryPermission === 'function') {
    try {
      permission = await handle.queryPermission({ mode: 'readwrite' });
    } catch (_error) {
      permission = 'unknown';
    }
  }
  if (!handle && meta.isBound) {
    needsRebind = true;
  }

  if (rawHandle && !handle) {
    needsRebind = true;
  }

  if (hasKnownRebindError) {
    needsRebind = true;
  }

  if (permission === 'denied') {
    needsRebind = true;
  }

  if (!handle) {
    isBound = false;
  }

  return {
    isBound,
    directoryName,
    boundAt: meta.boundAt,
    lastWriteAt: meta.lastWriteAt,
    lastError: meta.lastError,
    needsRebind,
    permission
  };
}

function normalizeStoredRecord(input) {
  const record = {};
  for (const header of TrackerCsv.CSV_HEADERS) {
    record[header] = input?.[header] == null ? '' : String(input[header]);
  }
  record.status = normalizeStatus(record.status);
  record.round1_pass = normalizeRoundValue(record.round1_pass);
  record.round2_pass = normalizeRoundValue(record.round2_pass);
  record.round3_pass = normalizeRoundValue(record.round3_pass);
  return record;
}

async function readCsvRecords(handle) {
  if (!isFileHandleLike(handle)) {
    throw makeError(ERROR_CODES.NO_BOUND_FILE, 'No valid CSV file handle is currently bound. Please rebind CSV.');
  }
  let file;
  try {
    file = await handle.getFile();
  } catch (error) {
    if (error?.name === 'NotFoundError') {
      throw makeError(ERROR_CODES.FILE_NOT_FOUND, 'The bound CSV file can no longer be found.', error);
    }
    if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
      throw makeError(ERROR_CODES.PERMISSION_DENIED, 'Read/write permission is not granted for the bound CSV file.', error);
    }
    throw error;
  }

  const rawText = await file.text();
  if (!String(rawText || '').trim()) {
    return [];
  }

  const parsed = TrackerCsv.parseCsv(rawText);
  if (parsed.headers.length === 0) {
    return [];
  }
  if (!TrackerCsv.isHeaderMatch(parsed.headers)) {
    throw makeError(ERROR_CODES.SCHEMA_MISMATCH, 'CSV schema does not match the required tracker columns.');
  }

  return parsed.objects.map(normalizeStoredRecord);
}

async function writeCsvRecords(handle, records) {
  if (!isFileHandleLike(handle)) {
    throw makeError(ERROR_CODES.NO_BOUND_FILE, 'No valid CSV file handle is currently bound. Please rebind CSV.');
  }
  const text = TrackerCsv.serializeObjects(records, TrackerCsv.CSV_HEADERS, true);
  let writable = null;
  try {
    writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
  } catch (error) {
    if (writable && typeof writable.abort === 'function') {
      try {
        await writable.abort();
      } catch (_abortError) {
        // Ignore cleanup errors.
      }
    }

    if (error?.name === 'NotFoundError') {
      throw makeError(ERROR_CODES.FILE_NOT_FOUND, 'The bound CSV file can no longer be found.', error);
    }
    if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
      throw makeError(ERROR_CODES.PERMISSION_DENIED, 'Read/write permission is not granted for the bound CSV file.', error);
    }
    throw error;
  }
}

async function validateOrInitializeCsv(handle) {
  if (!isFileHandleLike(handle)) {
    throw makeError(ERROR_CODES.NO_BOUND_FILE, 'No valid CSV file handle is currently bound. Please rebind CSV.');
  }
  let file;
  try {
    file = await handle.getFile();
  } catch (error) {
    if (error?.name === 'NotFoundError') {
      throw makeError(ERROR_CODES.FILE_NOT_FOUND, 'The selected CSV file cannot be read.', error);
    }
    if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
      throw makeError(ERROR_CODES.PERMISSION_DENIED, 'Read/write permission is not granted for the selected CSV file.', error);
    }
    throw error;
  }

  const text = await file.text();
  if (!String(text || '').trim()) {
    await writeCsvRecords(handle, []);
    return;
  }

  const parsed = TrackerCsv.parseCsv(text);
  if (!TrackerCsv.isHeaderMatch(parsed.headers)) {
    throw makeError(ERROR_CODES.SCHEMA_MISMATCH, 'CSV header mismatch. Please use the standard template.');
  }
}

function normalizeTxtBaseName(input) {
  const candidate = String(input || '').trim().replace(/\.txt$/i, '');
  if (!candidate) {
    throw makeError(ERROR_CODES.INVALID_INPUT, 'fileBaseName is required.');
  }
  return candidate;
}

async function fileExistsInDirectory(directoryHandle, fileName) {
  try {
    await directoryHandle.getFileHandle(fileName, { create: false });
    return true;
  } catch (error) {
    if (error?.name === 'NotFoundError') {
      return false;
    }
    throw error;
  }
}

async function resolveUniqueTxtFileName(directoryHandle, fileBaseName) {
  let index = 0;
  while (index < 10000) {
    const suffix = index === 0 ? '' : `_${index}`;
    const candidate = `${fileBaseName}${suffix}.txt`;
    const exists = await fileExistsInDirectory(directoryHandle, candidate);
    if (!exists) return candidate;
    index += 1;
  }
  throw makeError(ERROR_CODES.OUTPUT_WRITE_FAILED, 'Could not resolve a unique file name in output directory.');
}

async function writeTxtToBoundDirectory(input) {
  const rawDirectoryHandle = await getStoredTxtOutputDirHandle();
  const directoryHandle = isDirectoryHandleLike(rawDirectoryHandle) ? rawDirectoryHandle : null;
  if (!directoryHandle) {
    throw makeError(ERROR_CODES.NO_OUTPUT_DIR_BOUND, 'No valid output directory is currently bound. Please rebind output folder.');
  }

  const fileBaseName = normalizeTxtBaseName(input?.fileBaseName);
  const content = String(input?.content ?? '');

  let targetFileName;
  try {
    targetFileName = await resolveUniqueTxtFileName(directoryHandle, fileBaseName);
    const fileHandle = await directoryHandle.getFileHandle(targetFileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
  } catch (error) {
    if (error?.code) {
      throw error;
    }
    if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
      throw makeError(ERROR_CODES.OUTPUT_DIR_PERMISSION_DENIED, 'Output directory write permission is denied.', error);
    }
    if (error?.name === 'NotFoundError') {
      throw makeError(ERROR_CODES.OUTPUT_DIR_NOT_FOUND, 'The bound output directory is no longer available.', error);
    }
    throw makeError(ERROR_CODES.OUTPUT_WRITE_FAILED, 'Failed to write TXT file to output directory.', error);
  }

  const writtenAt = new Date().toISOString();
  await updateTxtOutputBindingMeta({
    isBound: true,
    directoryName: directoryHandle.name || '',
    lastWriteAt: writtenAt,
    needsRebind: false,
    lastError: null
  });

  return {
    writtenFileName: targetFileName,
    writtenAt
  };
}

function normalizeDraft(recordDraft) {
  if (!recordDraft || typeof recordDraft !== 'object') {
    throw makeError(ERROR_CODES.INVALID_INPUT, 'recordDraft is required.');
  }

  const jobId = String(recordDraft.job_id || '').trim();
  const jobUrl = String(recordDraft.job_url || '').trim();
  const fallbackKey = String(recordDraft.job_key || '').trim();
  const recordKey = jobId || jobUrl || fallbackKey;
  if (!recordKey) {
    throw makeError(ERROR_CODES.INVALID_INPUT, 'Either job_id or job_url is required.');
  }

  return {
    record_key: recordKey,
    job_id: jobId,
    company: String(recordDraft.company || '').trim(),
    position: String(recordDraft.position || '').trim(),
    location: String(recordDraft.location || '').trim(),
    job_url: jobUrl,
    status: normalizeStatus(recordDraft.status),
    round1_pass: normalizeRoundValue(recordDraft.round1_pass),
    round2_pass: normalizeRoundValue(recordDraft.round2_pass),
    round3_pass: normalizeRoundValue(recordDraft.round3_pass),
    notes: String(recordDraft.notes || '')
  };
}

function applyStatusTimestamp(record, status, nowIso) {
  const statusField = STATUS_TO_DATE_FIELD[status];
  if (!statusField) return;
  if (!record[statusField]) {
    record[statusField] = nowIso;
  }
}

function mergeRecord(existingRecord, draft, nowIso) {
  const merged = {};
  for (const header of TrackerCsv.CSV_HEADERS) {
    merged[header] = existingRecord?.[header] == null ? '' : String(existingRecord[header]);
  }

  merged.job_id = draft.job_id;
  merged.company = draft.company || merged.company;
  merged.position = draft.position || merged.position;
  merged.location = draft.location || merged.location;
  merged.job_url = draft.job_url || merged.job_url;
  merged.status = normalizeStatus(draft.status || merged.status);
  merged.round1_pass = normalizeRoundValue(draft.round1_pass);
  merged.round2_pass = normalizeRoundValue(draft.round2_pass);
  merged.round3_pass = normalizeRoundValue(draft.round3_pass);
  merged.notes = draft.notes;
  merged.created_at = merged.created_at || nowIso;
  merged.updated_at = nowIso;
  applyStatusTimestamp(merged, merged.status, nowIso);

  return merged;
}

async function enqueueWrite(task) {
  writeQueue = writeQueue.then(task, task);
  return writeQueue;
}

function findLatestRecordIndexByJobKey(records, jobKey) {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const candidate = records[index] || {};
    const candidateKey = String(candidate.job_id || '').trim() || String(candidate.job_url || '').trim() || String(candidate.job_key || '').trim();
    if (candidateKey === jobKey) return index;
  }
  return -1;
}

async function upsertTrackerRecordWithMode(recordDraft, options) {
  const mode = options?.mode === 'append' ? 'append' : 'replace';
  return enqueueWrite(async () => {
    const draft = normalizeDraft(recordDraft);
    const rawHandle = await getStoredHandle();
    const handle = isFileHandleLike(rawHandle) ? rawHandle : null;
    if (!handle) {
      throw makeError(ERROR_CODES.NO_BOUND_FILE, 'No valid CSV file is currently bound.');
    }

    const nowIso = new Date().toISOString();
    const records = await readCsvRecords(handle);
    const existingIndex = findLatestRecordIndexByJobKey(records, draft.record_key);
    const merged = mergeRecord(existingIndex >= 0 ? records[existingIndex] : null, draft, nowIso);

    if (mode === 'append') {
      records.push(merged);
    } else if (existingIndex >= 0) {
      records[existingIndex] = merged;
    } else {
      records.push(merged);
    }

    await writeCsvRecords(handle, records);
    await updateBindingMeta({
      isBound: true,
      fileName: handle.name || '',
      lastSyncAt: nowIso,
      needsRebind: false,
      lastError: null
    });

    return merged;
  });
}

async function getRecordByJobKey(jobKey) {
  const normalizedKey = String(jobKey || '').trim();
  if (!normalizedKey) {
    throw makeError(ERROR_CODES.INVALID_INPUT, 'jobKey is required.');
  }

  const rawHandle = await getStoredHandle();
  const handle = isFileHandleLike(rawHandle) ? rawHandle : null;
  if (!handle) {
    return null;
  }

  const records = await readCsvRecords(handle);
  const latestIndex = findLatestRecordIndexByJobKey(records, normalizedKey);
  return latestIndex >= 0 ? records[latestIndex] : null;
}

async function handleBindCsv(message) {
  const explicitHandle = isFileHandleLike(message?.fileHandle) ? message.fileHandle : null;
  if (explicitHandle) {
    await setStoredHandle(explicitHandle);
  }

  const storedHandle = await getStoredHandle();
  const handle = explicitHandle || (isFileHandleLike(storedHandle) ? storedHandle : null);
  if (!handle) {
    throw makeError(ERROR_CODES.NO_BOUND_FILE, 'No valid file handle is available for CSV binding. Please rebind CSV.');
  }

  await validateOrInitializeCsv(handle);
  const boundAt = message?.boundAt || new Date().toISOString();
  const fileName = message?.fileName || handle.name || 'linkedin_job_tracker.csv';

  await updateBindingMeta({
    isBound: true,
    fileName,
    boundAt,
    needsRebind: false,
    lastError: null
  });

  return {
    ok: true,
    fileName,
    boundAt
  };
}

async function handleGetBindingState() {
  const state = await resolveBindingState();
  return {
    ok: true,
    ...state
  };
}

async function handleBindTxtOutputDir(message) {
  const explicitDirectoryHandle = isDirectoryHandleLike(message?.directoryHandle) ? message.directoryHandle : null;
  if (explicitDirectoryHandle) {
    await setStoredTxtOutputDirHandle(explicitDirectoryHandle);
  }

  const storedDirectoryHandle = await getStoredTxtOutputDirHandle();
  const directoryHandle = explicitDirectoryHandle || (isDirectoryHandleLike(storedDirectoryHandle) ? storedDirectoryHandle : null);
  if (!directoryHandle) {
    throw makeError(ERROR_CODES.NO_OUTPUT_DIR_BOUND, 'No valid output directory handle is available. Please rebind output folder.');
  }

  const boundAt = message?.boundAt || new Date().toISOString();
  const directoryName = message?.directoryName || directoryHandle.name || 'LinkedIn Exports';

  await updateTxtOutputBindingMeta({
    isBound: true,
    directoryName,
    boundAt,
    needsRebind: false,
    lastError: null
  });

  return {
    ok: true,
    directoryName,
    boundAt
  };
}

async function handleGetTxtOutputState() {
  const state = await resolveTxtOutputState();
  return {
    ok: true,
    ...state
  };
}

async function handleExportTxtToBoundDir(message) {
  const result = await writeTxtToBoundDirectory({
    fileBaseName: message?.fileBaseName,
    content: message?.content
  });
  const outputState = await resolveTxtOutputState();
  return {
    ok: true,
    ...result,
    outputState
  };
}

async function handleUpsert(message) {
  const mode = 'append';
  const record = await upsertTrackerRecordWithMode(message?.recordDraft, { mode });
  const syncState = await resolveBindingState();
  return {
    ok: true,
    record,
    syncState,
    mode
  };
}

async function handleGetByJobKey(message) {
  const record = await getRecordByJobKey(message?.jobKey);
  const syncState = await resolveBindingState();
  return {
    ok: true,
    record,
    syncState
  };
}

async function dispatchMessage(message) {
  switch (message?.type) {
    case 'TRACKER_BIND_CSV':
      return handleBindCsv(message);
    case 'TRACKER_GET_BINDING_STATE':
      return handleGetBindingState();
    case 'TRACKER_UPSERT':
      return handleUpsert(message);
    case 'TRACKER_GET_BY_JOB_KEY':
      return handleGetByJobKey(message);
    case 'TXT_BIND_OUTPUT_DIR':
      return handleBindTxtOutputDir(message);
    case 'TXT_GET_OUTPUT_STATE':
      return handleGetTxtOutputState();
    case 'TXT_EXPORT_TO_BOUND_DIR':
      return handleExportTxtToBoundDir(message);
    default:
      return null;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type) return undefined;
  const messageType = String(message.type);
  if (!messageType.startsWith('TRACKER_') && !messageType.startsWith('TXT_')) return undefined;

  (async () => {
    try {
      const response = await dispatchMessage(message);
      sendResponse(response);
    } catch (error) {
      const payload = toErrorPayload(error);
      await applyErrorStateByMessageType(messageType, payload);
      sendResponse(payload);
    }
  })();

  return true;
});
