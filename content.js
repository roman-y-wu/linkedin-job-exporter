(function () {
  'use strict';

  if (window.linkedInExporterLoaded) return;
  window.linkedInExporterLoaded = true;

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
    jobDescription: ['.jobs-description__content', '.jobs-box__html-content', '#job-details']
  };

  function findElement(selectorList) {
    for (const selector of selectorList) {
      const element = document.querySelector(selector);
      if (element) return element;
    }
    return null;
  }

  function getTextContent(element) {
    if (!element) return '';
    return String(element.textContent || '').replace(/\s+/g, ' ').trim();
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

  function extractJobIdFromRawUrl(rawUrl) {
    try {
      const url = new URL(rawUrl, location.href);
      const pathMatch = url.pathname.match(/\/jobs\/view\/(\d+)/);
      if (pathMatch) return pathMatch[1];
      const queryMatch = url.searchParams.get('currentJobId') || url.searchParams.get('jobId');
      if (/^\d+$/.test(String(queryMatch || '').trim())) return String(queryMatch).trim();
    } catch (_error) {
      // Best effort below.
    }

    const pathMatch = String(rawUrl || '').match(/\/jobs\/view\/(\d+)/);
    if (pathMatch) return pathMatch[1];
    return '';
  }

  function toStablePageUrl(rawUrl, jobId) {
    try {
      const url = new URL(rawUrl, location.href);
      if (/^\d+$/.test(String(jobId || '').trim())) {
        return `${url.origin}/jobs/view/${jobId}/`;
      }
      url.hash = '';
      return url.toString().replace(/\/$/, '');
    } catch (_error) {
      return String(rawUrl || '').split('#')[0];
    }
  }

  function extractJobDescriptionText() {
    const jobDescEl = findElement(SELECTORS.jobDescription);
    if (!jobDescEl) return 'Job description not found';

    const clone = jobDescEl.cloneNode(true);
    clone.querySelectorAll('script,style,noscript,template,[aria-hidden="true"],.visually-hidden,.sr-only').forEach((el) => {
      el.remove();
    });

    const text = String(clone.innerText || clone.textContent || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return text || 'Job description not found';
  }

  function getCurrentJobInfo() {
    const jobTitle = getTextContent(findElement(SELECTORS.jobTitle)) || 'Unknown Position';
    const companyName = getTextContent(findElement(SELECTORS.companyName)) || 'Unknown Company';
    const locationText = extractLocation() || 'Unknown Location';
    const rawUrl = location.href;
    const jobId = extractJobIdFromRawUrl(rawUrl);

    return {
      jobTitle,
      companyName,
      location: locationText,
      jobDescriptionText: extractJobDescriptionText(),
      jobId,
      jobUrl: toStablePageUrl(rawUrl, jobId)
    };
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
    }, 2200);
  }

  function triggerTxtDownload(fileName, textContent) {
    const safeName = String(fileName || '').trim() || 'linkedin_job_description.txt';
    const content = String(textContent || '');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);

    try {
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = safeName;
      link.rel = 'noopener';
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error?.message || 'Failed to trigger page download.' };
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    }
  }

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

    if (message.type === 'SHOW_EXPORT_TOAST') {
      showToast(String(message.message || ''), Boolean(message.isError));
      sendResponse({ ok: true });
      return undefined;
    }

    if (message.type === 'DOWNLOAD_TXT_FILE') {
      const result = triggerTxtDownload(message.fileName, message.textContent);
      sendResponse(result);
      return undefined;
    }

    return undefined;
  });
})();
