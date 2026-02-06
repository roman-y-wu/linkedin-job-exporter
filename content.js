(function () {
  'use strict';

  if (window.linkedInExporterLoaded) return;
  window.linkedInExporterLoaded = true;

  const TRACKER_STATUSES = ['Saved', 'Applied', 'Interview', 'Rejected', 'Ghosted'];

  const SELECTORS = {
    jobTitle: [
      '.job-details-jobs-unified-top-card__job-title h1',
      '.jobs-unified-top-card__job-title',
      '.t-24.t-bold.inline'
    ],
    companyName: [
      '.job-details-jobs-unified-top-card__company-name a',
      '.job-details-jobs-unified-top-card__company-name',
      '.jobs-unified-top-card__company-name a',
      '.jobs-unified-top-card__company-name'
    ],
    location: [
      '.job-details-jobs-unified-top-card__tertiary-description-container .tvm__text',
      '.jobs-unified-top-card__tertiary-description-container .tvm__text',
      '.job-details-jobs-unified-top-card__primary-description-container .t-black--light',
      '.jobs-unified-top-card__primary-description-container .t-black--light',
      '.jobs-unified-top-card__bullet'
    ],
    locationContainer: [
      '.job-details-jobs-unified-top-card__tertiary-description-container',
      '.jobs-unified-top-card__tertiary-description-container',
      '.job-details-jobs-unified-top-card__primary-description-container',
      '.jobs-unified-top-card__primary-description-container'
    ],
    jobDescription: [
      '.jobs-description__content',
      '.jobs-box__html-content',
      '#job-details'
    ],
    headerContainer: [
      '.job-details-jobs-unified-top-card__container--two-pane',
      '.jobs-unified-top-card'
    ],
    actionsContainer: [
      '.jobs-unified-top-card__content--two-pane .display-flex.mt4',
      '.jobs-apply-button--top-card',
      '.jobs-unified-top-card__buttons-container',
      '.job-details-jobs-unified-top-card__buttons-container',
      '.jobs-unified-top-card__content--two-pane .jobs-unified-top-card__buttons-container'
    ]
  };

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

  function findElement(selectorList) {
    for (const selector of selectorList) {
      const element = document.querySelector(selector);
      if (element) return element;
    }
    return null;
  }

  function getTextContent(element) {
    if (!element) return '';
    const clone = element.cloneNode(true);
    const hiddenEls = clone.querySelectorAll('[aria-hidden="true"], .visually-hidden, .sr-only, [style*="display: none"]');
    hiddenEls.forEach((hiddenEl) => hiddenEl.remove());
    return clone.textContent.trim().replace(/\s+/g, ' ');
  }

  function getDateString() {
    const now = new Date();
    const year = String(now.getFullYear());
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }

  function sanitizeFilename(name) {
    return name
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
      .trim();
  }

  function extractLocation() {
    const directLocationEl = findElement(SELECTORS.location);
    const directLocationText = getTextContent(directLocationEl);
    if (directLocationText) {
      return directLocationText.split(/[·•|]/)[0].trim();
    }

    const locationContainerEl = findElement(SELECTORS.locationContainer);
    const locationContainerText = getTextContent(locationContainerEl);
    if (locationContainerText) {
      return locationContainerText.split(/[·•|]/)[0].trim();
    }

    return '';
  }

  function normalizeLinkedInJobUrl(urlValue) {
    try {
      const url = new URL(urlValue, location.href);
      url.search = '';
      url.hash = '';
      return url.toString().replace(/\/$/, '');
    } catch (_error) {
      return String(urlValue || '').split('?')[0].split('#')[0];
    }
  }

  function extractJobIdFromUrl(urlValue) {
    const normalized = normalizeLinkedInJobUrl(urlValue);
    const match = normalized.match(/\/jobs\/view\/(\d+)/);
    return match ? match[1] : '';
  }

  function extractJobInfo() {
    const jobTitleEl = findElement(SELECTORS.jobTitle);
    const companyNameEl = findElement(SELECTORS.companyName);
    const jobDescEl = findElement(SELECTORS.jobDescription);
    const locationText = extractLocation();

    return {
      jobTitle: getTextContent(jobTitleEl) || 'Unknown Position',
      companyName: getTextContent(companyNameEl) || 'Unknown Company',
      location: locationText || 'Unknown Location',
      jobDescriptionText: getTextContent(jobDescEl) || 'Job description not found'
    };
  }

  function getCurrentJobInfo() {
    const coreInfo = extractJobInfo();
    const jobUrl = normalizeLinkedInJobUrl(location.href);
    const jobId = extractJobIdFromUrl(jobUrl);
    const jobKey = jobId || jobUrl;

    return {
      ...coreInfo,
      jobUrl,
      jobId,
      jobKey
    };
  }

  function buildTrackerRecordDraft(jobInfo, overrides) {
    const custom = overrides || {};
    return {
      job_key: jobInfo.jobKey,
      job_id: jobInfo.jobId,
      company: jobInfo.companyName,
      position: jobInfo.jobTitle,
      location: jobInfo.location,
      job_url: jobInfo.jobUrl,
      status: custom.status || 'Saved',
      round1_pass: custom.round1_pass == null ? 0 : custom.round1_pass,
      round2_pass: custom.round2_pass == null ? 0 : custom.round2_pass,
      round3_pass: custom.round3_pass == null ? 0 : custom.round3_pass,
      notes: custom.notes == null ? '' : custom.notes
    };
  }

  function generateFilename(companyName, jobTitle, location) {
    const date = getDateString();
    return sanitizeFilename(`${date}_${companyName}_${jobTitle}_${location}`);
  }

  function buildTxtContent(jobInfo) {
    const exportedOn = new Date().toLocaleDateString();
    return [
      `Job Title: ${jobInfo.jobTitle}`,
      `Company: ${jobInfo.companyName}`,
      `Location: ${jobInfo.location}`,
      `Exported On: ${exportedOn}`,
      '',
      'Job Description:',
      jobInfo.jobDescriptionText
    ].join('\n');
  }

  function mapTxtExportErrorMessage(errorCode, fallbackMessage) {
    if (errorCode === 'NO_OUTPUT_DIR_BOUND') {
      return '请先在扩展 popup 中设置 TXT 保存文件夹。';
    }
    if (errorCode === 'OUTPUT_DIR_PERMISSION_DENIED') {
      return 'TXT 保存文件夹权限不足，请在扩展 popup 中重新设置。';
    }
    if (errorCode === 'OUTPUT_DIR_NOT_FOUND') {
      return 'TXT 保存文件夹不可用，请在扩展 popup 中重新设置。';
    }
    if (errorCode === 'OUTPUT_WRITE_FAILED') {
      return '写入 TXT 文件失败，请稍后重试。';
    }
    return fallbackMessage || '导出 TXT 失败，请重试。';
  }

  function formatLogError(error) {
    if (!error) return 'unknown error';
    if (typeof error === 'string') return error;
    if (error.message) return error.message;
    return String(error);
  }

  function showToast(message, isError) {
    let toast = document.getElementById('linkedin-job-tracker-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'linkedin-job-tracker-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = isError ? 'linkedin-job-tracker-toast linkedin-job-tracker-toast-error' : 'linkedin-job-tracker-toast';
    window.setTimeout(() => {
      if (toast) {
        toast.className = 'linkedin-job-tracker-toast linkedin-job-tracker-toast-hidden';
      }
    }, 2000);
  }

  function setPanelMessage(message, isError) {
    const messageElement = document.getElementById('linkedin-track-message');
    if (!messageElement) return;
    messageElement.textContent = message || '';
    messageElement.className = isError ? 'linkedin-track-message linkedin-track-message-error' : 'linkedin-track-message';
  }

  function createTrackerPanel() {
    const panel = document.createElement('div');
    panel.id = 'linkedin-track-panel';
    panel.className = 'linkedin-track-panel linkedin-hidden';
    panel.innerHTML = `
      <div class="linkedin-track-panel-header">
        <strong>Track Job</strong>
        <button id="linkedin-track-close" type="button" class="linkedin-track-close-btn">Close</button>
      </div>
      <p id="linkedin-track-job" class="linkedin-track-job"></p>
      <p id="linkedin-track-message" class="linkedin-track-message"></p>
      <label class="linkedin-track-label">
        Status
        <select id="linkedin-track-status">
          ${TRACKER_STATUSES.map((status) => `<option value="${status}">${status}</option>`).join('')}
        </select>
      </label>
      <div class="linkedin-track-rounds">
        <label><input id="linkedin-track-round1" type="checkbox" /> Round 1 Pass</label>
        <label><input id="linkedin-track-round2" type="checkbox" /> Round 2 Pass</label>
        <label><input id="linkedin-track-round3" type="checkbox" /> Round 3 Pass</label>
      </div>
      <label class="linkedin-track-label">
        Notes
        <textarea id="linkedin-track-notes" rows="3" placeholder="Optional notes..."></textarea>
      </label>
      <div class="linkedin-track-panel-actions">
        <button id="linkedin-track-save" type="button">Save</button>
      </div>
    `;

    document.body.appendChild(panel);

    const closeButton = panel.querySelector('#linkedin-track-close');
    closeButton.addEventListener('click', () => {
      panel.classList.add('linkedin-hidden');
    });

    const saveButton = panel.querySelector('#linkedin-track-save');
    saveButton.addEventListener('click', () => {
      saveTrackerFromPanel().catch((error) => {
        console.error(`LinkedIn Job Tracker: save failed: ${formatLogError(error)}`);
      });
    });

    return panel;
  }

  function ensureTrackerPanel() {
    const existing = document.getElementById('linkedin-track-panel');
    return existing || createTrackerPanel();
  }

  function setPanelForm(record) {
    const statusSelect = document.getElementById('linkedin-track-status');
    const round1 = document.getElementById('linkedin-track-round1');
    const round2 = document.getElementById('linkedin-track-round2');
    const round3 = document.getElementById('linkedin-track-round3');
    const notes = document.getElementById('linkedin-track-notes');
    if (!statusSelect || !round1 || !round2 || !round3 || !notes) return;

    statusSelect.value = TRACKER_STATUSES.includes(record.status) ? record.status : 'Saved';
    round1.checked = String(record.round1_pass) === '1';
    round2.checked = String(record.round2_pass) === '1';
    round3.checked = String(record.round3_pass) === '1';
    notes.value = record.notes || '';
  }

  async function openTrackerPanel() {
    const panel = ensureTrackerPanel();
    panel.classList.remove('linkedin-hidden');
    setPanelMessage('Loading...', false);

    const jobInfo = getCurrentJobInfo();
    const title = document.getElementById('linkedin-track-job');
    if (title) {
      title.textContent = `${jobInfo.companyName} | ${jobInfo.jobTitle}`;
    }

    setPanelForm({
      status: 'Saved',
      round1_pass: '0',
      round2_pass: '0',
      round3_pass: '0',
      notes: ''
    });

    try {
      const bindingState = await sendRuntimeMessage({ type: 'TRACKER_GET_BINDING_STATE' });
      if (!bindingState || !bindingState.ok || !bindingState.isBound || bindingState.needsRebind) {
        setPanelMessage('No writable CSV bound. Bind or rebind CSV from the extension popup first.', true);
        return;
      }

      const existing = await sendRuntimeMessage({
        type: 'TRACKER_GET_BY_JOB_KEY',
        jobKey: jobInfo.jobKey
      });

      if (existing && existing.ok && existing.record) {
        setPanelForm(existing.record);
        setPanelMessage('Loaded existing tracking record.', false);
      } else {
        setPanelMessage('Create a new tracking record for this job.', false);
      }
    } catch (error) {
      setPanelMessage(error.message || 'Failed to load tracker data.', true);
    }
  }

  async function saveTrackerFromPanel() {
    const saveButton = document.getElementById('linkedin-track-save');
    const statusSelect = document.getElementById('linkedin-track-status');
    const round1 = document.getElementById('linkedin-track-round1');
    const round2 = document.getElementById('linkedin-track-round2');
    const round3 = document.getElementById('linkedin-track-round3');
    const notes = document.getElementById('linkedin-track-notes');
    if (!saveButton || !statusSelect || !round1 || !round2 || !round3 || !notes) return;

    const jobInfo = getCurrentJobInfo();
    const payload = buildTrackerRecordDraft(jobInfo, {
      status: statusSelect.value,
      round1_pass: round1.checked ? 1 : 0,
      round2_pass: round2.checked ? 1 : 0,
      round3_pass: round3.checked ? 1 : 0,
      notes: notes.value
    });

    const previousText = saveButton.textContent;
    saveButton.disabled = true;
    saveButton.textContent = 'Saving...';

    try {
      const response = await sendRuntimeMessage({
        type: 'TRACKER_UPSERT',
        recordDraft: payload,
        source: 'content_panel'
      });

      if (!response || !response.ok) {
        const message = response?.message || response?.errorCode || 'Failed to save tracking record.';
        throw new Error(message);
      }

      setPanelMessage('Saved successfully.', false);
      showToast('Tracking saved.', false);
    } catch (error) {
      setPanelMessage(error.message || 'Save failed.', true);
      showToast(error.message || 'Save failed.', true);
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = previousText;
    }
  }

  async function trackAfterExport(jobInfo) {
    const recordDraft = buildTrackerRecordDraft(jobInfo, {
      status: 'Saved',
      round1_pass: 0,
      round2_pass: 0,
      round3_pass: 0,
      notes: ''
    });

    try {
      const response = await sendRuntimeMessage({
        type: 'TRACKER_UPSERT',
        recordDraft,
        source: 'export'
      });
      if (!response || !response.ok) {
        return {
          ok: false,
          errorCode: response?.errorCode || 'TRACKER_UPSERT_FAILED',
          message: response?.message || 'Tracker sync failed'
        };
      }
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        errorCode: 'TRACKER_UPSERT_FAILED',
        message: error.message || 'Tracker sync failed'
      };
    }
  }

  async function exportToTxt() {
    try {
      const jobInfo = getCurrentJobInfo();
      const filename = generateFilename(jobInfo.companyName, jobInfo.jobTitle, jobInfo.location);
      const content = buildTxtContent(jobInfo);
      const exportResponse = await sendRuntimeMessage({
        type: 'TXT_EXPORT_TO_BOUND_DIR',
        fileBaseName: filename,
        content,
        source: 'content_export'
      });
      if (!exportResponse?.ok) {
        throw new Error(mapTxtExportErrorMessage(exportResponse?.errorCode, exportResponse?.message));
      }

      const trackerResult = await trackAfterExport(jobInfo);
      if (!trackerResult.ok) {
        const trackerErrorCode = trackerResult.errorCode || 'TRACKER_UPSERT_FAILED';
        const trackerMessage = trackerResult.message || 'Tracker sync failed';
        console.debug(`[LinkedIn Job Tracker] auto-track skipped: ${trackerErrorCode} ${trackerMessage}`);
      }

      return {
        ok: true,
        trackerResult,
        writtenFileName: exportResponse.writtenFileName
      };
    } catch (error) {
      console.error(`LinkedIn Job Exporter: failed to export TXT: ${formatLogError(error)}`);
      alert(error?.message || 'Failed to export TXT. Please try again.');
      throw error;
    }
  }

  function setupRuntimeMessageHandlers() {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || !message.type) return undefined;

      if (message.type === 'PING') {
        sendResponse({ ok: true });
        return undefined;
      }

      if (message.type === 'GET_CURRENT_JOB_INFO') {
        sendResponse({ ok: true, jobInfo: getCurrentJobInfo() });
        return undefined;
      }

      if (message.type === 'EXPORT_TXT') {
        exportToTxt()
          .then((result) => sendResponse(result))
          .catch((error) => sendResponse({ ok: false, message: error?.message || String(error) }));
        return true;
      }

      return undefined;
    });
  }

  function init() {
    setupRuntimeMessageHandlers();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
