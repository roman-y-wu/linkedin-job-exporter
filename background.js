importScripts('lib/tracker_csv.js');

const STORAGE_KEYS = {
  BINDING_META: 'trackerBindingMeta'
};

const IDB_CONFIG = {
  DB_NAME: 'linkedinJobTrackerDB',
  STORE_NAME: 'handles',
  HANDLE_KEY: 'trackerCsvHandle'
};

const ERROR_CODES = {
  NO_BOUND_FILE: 'NO_BOUND_FILE',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  SCHEMA_MISMATCH: 'SCHEMA_MISMATCH',
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

const NEEDS_REBIND_CODES = new Set([
  ERROR_CODES.NO_BOUND_FILE,
  ERROR_CODES.PERMISSION_DENIED,
  ERROR_CODES.FILE_NOT_FOUND,
  ERROR_CODES.SCHEMA_MISMATCH
]);

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
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
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
  if (error.name === 'NotFoundError') return ERROR_CODES.FILE_NOT_FOUND;
  if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return ERROR_CODES.PERMISSION_DENIED;
  return ERROR_CODES.UNKNOWN_ERROR;
}

function toErrorPayload(error) {
  const errorCode = inferErrorCode(error);
  return {
    ok: false,
    errorCode,
    message: error?.message || 'Unknown tracker error',
    needsRebind: NEEDS_REBIND_CODES.has(errorCode)
  };
}

async function applyErrorState(errorPayload) {
  const patch = {
    lastError: errorPayload.errorCode || ERROR_CODES.UNKNOWN_ERROR
  };
  if (errorPayload.needsRebind) {
    patch.needsRebind = true;
  }
  await updateBindingMeta(patch);
}

async function queryWritePermission(handle) {
  if (!handle || typeof handle.queryPermission !== 'function') {
    throw makeError(ERROR_CODES.PERMISSION_DENIED, 'File handle is not available.');
  }
  const permission = await handle.queryPermission({ mode: 'readwrite' });
  if (permission !== 'granted') {
    throw makeError(ERROR_CODES.PERMISSION_DENIED, 'Read/write permission is not granted for the bound CSV file.');
  }
}

async function resolveBindingState() {
  const meta = await getBindingMeta();
  const handle = await getStoredHandle();

  let permission = 'unavailable';
  let needsRebind = Boolean(meta.needsRebind);
  let isBound = Boolean(handle);
  let fileName = meta.fileName || (handle?.name || '');

  if (handle && typeof handle.queryPermission === 'function') {
    try {
      permission = await handle.queryPermission({ mode: 'readwrite' });
      if (permission !== 'granted') {
        needsRebind = true;
      }
    } catch (_error) {
      permission = 'unknown';
      needsRebind = true;
    }
  } else if (meta.isBound) {
    needsRebind = true;
  }

  if (!handle && meta.isBound) {
    needsRebind = true;
  }

  if (meta.lastError && NEEDS_REBIND_CODES.has(meta.lastError)) {
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
  let file;
  try {
    file = await handle.getFile();
  } catch (error) {
    throw makeError(ERROR_CODES.FILE_NOT_FOUND, 'The bound CSV file can no longer be found.', error);
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
  const text = TrackerCsv.serializeObjects(records, TrackerCsv.CSV_HEADERS, true);
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

async function validateOrInitializeCsv(handle) {
  await queryWritePermission(handle);
  let file;
  try {
    file = await handle.getFile();
  } catch (error) {
    throw makeError(ERROR_CODES.FILE_NOT_FOUND, 'The selected CSV file cannot be read.', error);
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

function normalizeDraft(recordDraft) {
  if (!recordDraft || typeof recordDraft !== 'object') {
    throw makeError(ERROR_CODES.INVALID_INPUT, 'recordDraft is required.');
  }

  const jobKey = String(recordDraft.job_key || '').trim();
  if (!jobKey) {
    throw makeError(ERROR_CODES.INVALID_INPUT, 'job_key is required.');
  }

  return {
    job_key: jobKey,
    job_id: String(recordDraft.job_id || '').trim(),
    company: String(recordDraft.company || '').trim(),
    position: String(recordDraft.position || '').trim(),
    location: String(recordDraft.location || '').trim(),
    job_url: String(recordDraft.job_url || '').trim(),
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

  merged.job_key = draft.job_key;
  merged.job_id = draft.job_id || merged.job_id;
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

async function upsertTrackerRecord(recordDraft) {
  return enqueueWrite(async () => {
    const draft = normalizeDraft(recordDraft);
    const handle = await getStoredHandle();
    if (!handle) {
      throw makeError(ERROR_CODES.NO_BOUND_FILE, 'No CSV file is currently bound.');
    }

    await queryWritePermission(handle);
    const nowIso = new Date().toISOString();
    const records = await readCsvRecords(handle);
    const existingIndex = records.findIndex((item) => item.job_key === draft.job_key);
    const merged = mergeRecord(existingIndex >= 0 ? records[existingIndex] : null, draft, nowIso);

    if (existingIndex >= 0) {
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

  const handle = await getStoredHandle();
  if (!handle) {
    return null;
  }

  await queryWritePermission(handle);
  const records = await readCsvRecords(handle);
  return records.find((item) => item.job_key === normalizedKey) || null;
}

async function handleBindCsv(message) {
  if (message?.fileHandle) {
    await setStoredHandle(message.fileHandle);
  }

  const handle = await getStoredHandle();
  if (!handle) {
    throw makeError(ERROR_CODES.NO_BOUND_FILE, 'No file handle is available for CSV binding.');
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

async function handleUpsert(message) {
  const record = await upsertTrackerRecord(message?.recordDraft);
  const syncState = await resolveBindingState();
  return {
    ok: true,
    record,
    syncState
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
    default:
      return null;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type) return undefined;
  if (!String(message.type).startsWith('TRACKER_')) return undefined;

  (async () => {
    try {
      const response = await dispatchMessage(message);
      sendResponse(response);
    } catch (error) {
      const payload = toErrorPayload(error);
      await applyErrorState(payload);
      sendResponse(payload);
    }
  })();

  return true;
});
