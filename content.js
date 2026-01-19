(function() {
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
    jobDescription: [
      '.jobs-description__content',
      '.jobs-box__html-content',
      '#job-details'
    ],
    headerContainer: [
      '.job-details-jobs-unified-top-card__container--two-pane',
      '.jobs-unified-top-card'
    ]
  };

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
    return element.textContent.trim().replace(/\s+/g, ' ');
  }

  /**
   * Get current date in MMDD format
   */
  function getDateString() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${month}${day}`;
  }

  /**
   * Sanitize filename (remove invalid characters)
   */
  function sanitizeFilename(name) {
    return name.replace(/[<>:"/\\|?*]/g, '-').replace(/\s+/g, ' ').trim();
  }

  /**
   * Extract job information from the page
   */
  function extractJobInfo() {
    const jobTitleEl = findElement(SELECTORS.jobTitle);
    const companyNameEl = findElement(SELECTORS.companyName);
    const jobDescEl = findElement(SELECTORS.jobDescription);

    return {
      jobTitle: getTextContent(jobTitleEl) || 'Unknown Position',
      companyName: getTextContent(companyNameEl) || 'Unknown Company',
      jobDescription: jobDescEl ? jobDescEl.innerHTML : '<p>Job description not found</p>',
      jobDescriptionText: getTextContent(jobDescEl) || 'Job description not found'
    };
  }

  /**
   * Generate filename for the PDF
   */
  function generateFilename(companyName, jobTitle) {
    const date = getDateString();
    const filename = `${companyName} - ${jobTitle} - ${date}`;
    return sanitizeFilename(filename);
  }

  /**
   * Build PDF content HTML
   */
  function buildPdfContent(jobInfo) {
    return `
      <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
        <h1 style="font-size: 24px; margin-bottom: 8px; color: #000;">${jobInfo.jobTitle}</h1>
        <p style="font-size: 16px; color: #666; margin-bottom: 24px;">${jobInfo.companyName}</p>
        <hr style="border: none; border-top: 1px solid #ddd; margin-bottom: 24px;">
        <div style="font-size: 14px; white-space: pre-wrap;">${jobInfo.jobDescriptionText}</div>
      </div>
    `;
  }

  /**
   * Export job description to PDF
   */
  async function exportToPdf() {
    const button = document.getElementById('linkedin-export-btn');
    if (button) {
      button.textContent = 'Exporting...';
      button.disabled = true;
    }

    try {
      const jobInfo = extractJobInfo();
      const filename = generateFilename(jobInfo.companyName, jobInfo.jobTitle);
      const content = buildPdfContent(jobInfo);

      const options = {
        margin: [15, 15, 15, 15],
        filename: `${filename}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
      };

      await html2pdf().set(options).from(content).save();

      if (button) {
        button.textContent = 'Export PDF';
        button.disabled = false;
      }
    } catch (error) {
      console.error('LinkedIn Job Exporter: Failed to export PDF', error);
      alert('Failed to export PDF. Please try again.');
      if (button) {
        button.textContent = 'Export PDF';
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

    const headerContainer = findElement(SELECTORS.headerContainer);
    if (!headerContainer) {
      // Retry after a short delay (LinkedIn loads content dynamically)
      setTimeout(injectExportButton, 1000);
      return;
    }

    const button = document.createElement('button');
    button.id = 'linkedin-export-btn';
    button.textContent = 'Export PDF';
    button.addEventListener('click', exportToPdf);

    // Insert button after the header container
    headerContainer.parentNode.insertBefore(button, headerContainer.nextSibling);
  }

  /**
   * Initialize the extension
   */
  function init() {
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
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
