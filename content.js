(function () {
  'use strict';

  // Avoid duplicate injection
  if (window.linkedInExporterLoaded) return;
  window.linkedInExporterLoaded = true;

  // Selectors for LinkedIn job page elements (may need updates if LinkedIn changes their DOM)
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

  let keepAliveTimer = null;

  function findActionsContainerFallback() {
    // Try to locate the "Apply/Save" button row and append our export button there.
    const candidates = [];
    const byAria = [
      'button[aria-label*="Apply"]',
      'button[aria-label*="Quick Apply"]',
      'button[aria-label*="Save"]',
      'button[aria-label*="申请"]',
      'button[aria-label*="快速申请"]',
      'button[aria-label*="保存"]',
      'a[aria-label*="Apply"]'
    ];
    for (const sel of byAria) {
      const el = document.querySelector(sel);
      if (el) candidates.push(el);
    }

    // Fallback: first visible button that looks like an action in the job header.
    const header = findElement(SELECTORS.headerContainer) || document;
    const anyHeaderButton = header.querySelector('button, a[role="button"]');
    if (anyHeaderButton) candidates.push(anyHeaderButton);

    const isGoodContainer = (node) => {
      if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
      const buttons = node.querySelectorAll('button, a[role="button"], a');
      return buttons.length >= 2;
    };

    for (const el of candidates) {
      let cur = el;
      for (let i = 0; i < 8 && cur; i++) {
        if (isGoodContainer(cur)) return cur;
        cur = cur.parentElement;
      }
    }

    return null;
  }

  /**
   * Find element using multiple selectors (fallback strategy)
   */
  function findElement(selectorList) {
    for (const selector of selectorList) {
      const el = document.querySelector(selector);
      if (el) return el;
    }
    return null;
  }

  /**
   * Extract text content from element, cleaned up
   */
  function getTextContent(element) {
    if (!element) return '';
    // Clone to manipulate without affecting DOM
    const clone = element.cloneNode(true);
    // Remove visually hidden or aria-hidden elements that cause text duplication
    const hiddenEls = clone.querySelectorAll('[aria-hidden="true"], .visually-hidden, .sr-only, [style*="display: none"]');
    hiddenEls.forEach(el => el.remove());

    return clone.textContent.trim().replace(/\s+/g, ' ');
  }

  /**
   * Get current date in YYYYMMDD format
   */
  function getDateString() {
    const now = new Date();
    const year = String(now.getFullYear());
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }

  /**
   * Sanitize filename (remove invalid characters)
   */
  function sanitizeFilename(name) {
    return name
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
      .trim();
  }

  function createExportButton() {
    const button = document.createElement('button');
    button.id = 'linkedin-export-btn';
    button.textContent = 'Export TXT';
    button.addEventListener('click', exportToTxt);
    return button;
  }

  function injectFloatingButton() {
    if (document.getElementById('linkedin-export-btn')) return;
    const button = createExportButton();
    button.style.position = 'fixed';
    button.style.right = '16px';
    button.style.bottom = '16px';
    button.style.zIndex = '2147483647';
    document.body.appendChild(button);
  }

  /**
   * Extract job location from location text blocks
   */
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

  /**
   * Extract job information from the page
   */
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

  /**
   * Generate filename for the TXT
   */
  function generateFilename(companyName, jobTitle, location) {
    const date = getDateString();
    const filename = `${date}_${companyName}_${jobTitle}_${location}`;
    return sanitizeFilename(filename);
  }

  /**
   * Build TXT content
   */
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

  /**
   * Export job description to TXT
   */
  async function exportToTxt() {
    const button = document.getElementById('linkedin-export-btn');
    if (button) {
      button.textContent = 'Exporting...';
      button.disabled = true;
    }

    try {
      const jobInfo = extractJobInfo();
      const filename = generateFilename(jobInfo.companyName, jobInfo.jobTitle, jobInfo.location);
      const content = buildTxtContent(jobInfo);
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${filename}.txt`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      if (button) {
        button.textContent = 'Export TXT';
        button.disabled = false;
      }
    } catch (error) {
      console.error('LinkedIn Job Exporter: Failed to export TXT', error);
      alert('Failed to export TXT. Please try again.');
      if (button) {
        button.textContent = 'Export TXT';
        button.disabled = false;
      }
    }
  }

  /**
   * Create and inject the export button
   */
  function injectExportButton() {
    // Don't add button if already exists
    if (document.getElementById('linkedin-export-btn')) return;

    try {
      // Try to find the actions container (where Apply/Save buttons are)
      const actionsContainer = findElement(SELECTORS.actionsContainer) || findActionsContainerFallback();
      if (!actionsContainer) {
        console.warn('LinkedIn Job Exporter: actions container not found; using floating button fallback');
        injectFloatingButton();
        return;
      }

      const targetContainer = actionsContainer.classList.contains('display-flex')
        ? actionsContainer
        : actionsContainer.closest('.display-flex') || actionsContainer.parentElement;

      if (!targetContainer) {
        console.warn('LinkedIn Job Exporter: no target container found; using floating button fallback');
        injectFloatingButton();
        return;
      }

      targetContainer.appendChild(createExportButton());
    } catch (error) {
      console.warn('LinkedIn Job Exporter: failed to inject near actions; using floating fallback', error);
      injectFloatingButton();
    }
  }

  function setupRuntimeMessageHandlers() {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || !message.type) return undefined;

      if (message.type === 'PING') {
        sendResponse({ ok: true });
        return undefined;
      }

      if (message.type === 'INJECT_BUTTON') {
        injectExportButton();
        sendResponse({ ok: true });
        return undefined;
      }

      if (message.type === 'EXPORT_TXT') {
        exportToTxt()
          .then(() => sendResponse({ ok: true }))
          .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
        return true;
      }

      return undefined;
    });
  }

  /**
   * Initialize the extension
   */
  function init() {
    console.log('LinkedIn Job Exporter: content script loaded', { href: location.href });
    setupRuntimeMessageHandlers();
    // Initial injection
    injectExportButton();

    // Re-inject on URL changes (LinkedIn is a SPA)
    let lastUrl = location.href;
    const observer = new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        setTimeout(injectExportButton, 500);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    if (keepAliveTimer) {
      clearInterval(keepAliveTimer);
    }
    keepAliveTimer = window.setInterval(() => {
      if (!document.getElementById('linkedin-export-btn')) {
        injectExportButton();
      }
    }, 2000);
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
