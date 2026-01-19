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
    const logoSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="48" height="48" style="margin-bottom: 10px;"><rect width="128" height="128" rx="16" fill="#0a66c2"/><path d="M32 96V40h20v56H32zm10-64a12 12 0 110-24 12 12 0 010 24zm26 64V62c0-6 2-10 8-10 6 0 8 4 8 10v34h20V58c0-14-8-20-18-20-8 0-14 4-18 10v-8H48v56h20z" fill="white"/></svg>`;

    return `
      <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #333; padding: 20px; line-height: 1.6;">
        <div style="border-bottom: 2px solid #0a66c2; padding-bottom: 20px; margin-bottom: 30px;">
          ${logoSvg}
          <div style="font-size: 11px; color: #0a66c2; font-weight: bold; text-transform: uppercase; letter-spacing: 1.2px; margin-bottom: 4px;">LinkedIn Job Export</div>
          <h1 style="font-size: 28px; line-height: 1.2; margin: 0 0 8px 0; color: #000; font-weight: 700;">${jobInfo.jobTitle}</h1>
          <div style="font-size: 18px; color: #444; font-weight: 500;">${jobInfo.companyName}</div>
        </div>
        
        <div class="job-description" style="font-size: 15px; color: #333; line-height: 1.7;">
          ${jobInfo.jobDescription}
        </div>

        <div style="margin-top: 60px; padding-top: 15px; border-top: 1px solid #eee; font-size: 11px; color: #888; text-align: center;">
          Exported on ${new Date().toLocaleDateString()} | LinkedIn Job Exporter
        </div>

        <style>
          .job-description h1, .job-description h2, .job-description h3 { 
            font-size: 1.2em; margin: 24px 0 12px 0; color: #000; border-bottom: 1px solid #eee; padding-bottom: 5px;
          }
          .job-description p { margin: 0 0 16px 0; }
          .job-description ul, .job-description ol { margin: 0 0 16px 0; padding-left: 25px; }
          .job-description li { margin-bottom: 8px; }
          .job-description strong { color: #111; font-weight: 600; }
          .job-description span { line-height: inherit !important; }
        </style>
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
