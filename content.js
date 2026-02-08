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

  const EXPAND_CONTROL_SELECTORS = [
    'button[aria-label*="show more" i]',
    'button[aria-label*="see more" i]',
    'button[aria-label*="description" i]',
    'button[aria-label*="显示更多"]',
    'button[aria-label*="展开"]',
    'button.jobs-description__footer-button',
    'a[role="button"][aria-label*="show more" i]'
  ];

  const EXPAND_TEXT_PATTERNS = [/show more/i, /see more/i, /read more/i, /显示更多/, /展开/, /查看更多/];
  const COLLAPSE_TEXT_PATTERNS = [/show less/i, /see less/i, /collapse/i, /收起/, /隐藏/];
  const SECTION_HEADING_LABELS = [
    'About the job',
    'Role',
    'Responsibilities',
    'Qualifications',
    'Required Knowledge, Skills And Abilities',
    'Preferred Qualifications',
    'Shift',
    'Pay Transparency',
    'Pay',
    'Additional Details',
    'DISCLAIMER',
    'Employment Equity Statement',
    'Equal Opportunity Statement',
    'What We Offer',
    'What To Expect During The Interview Process',
    'Benefits',
    'Compensation',
    'Schedule',
    'The Foundation for Success',
    'The Homie Way',
    'Belonging at Homebase',
    'Hey, We’re Homebase'
  ];

  const DESCRIPTION_NOISE_SELECTORS = [
    '[aria-hidden="true"]',
    '.visually-hidden',
    '.sr-only',
    '[style*="display: none"]',
    '[hidden]',
    'script',
    'style',
    'noscript',
    'template',
    'button',
    'input',
    'textarea',
    'select'
  ].join(', ');

  const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
  const BLOCK_TAGS = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'BLOCKQUOTE', 'PRE']);

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

  function toStablePageUrl(rawUrl, jobId) {
    try {
      const url = new URL(rawUrl, location.href);
      const normalizedJobId = isNumericString(jobId) ? String(jobId).trim() : '';

      if (normalizedJobId) {
        return `${url.origin}/jobs/view/currentJobId=${normalizedJobId}/`;
      }

      url.hash = '';
      return url.toString().replace(/\/$/, '');
    } catch (_error) {
      return String(rawUrl || '').split('#')[0];
    }
  }

  function isNumericString(value) {
    return /^\d+$/.test(String(value || '').trim());
  }

  function extractJobIdFromRawUrl(rawUrl) {
    try {
      const url = new URL(rawUrl, location.href);
      const pathMatch = url.pathname.match(/\/jobs\/view\/(\d+)/);
      if (pathMatch) {
        return pathMatch[1];
      }

      const queryParamNames = ['currentJobId', 'jobId'];
      for (const name of queryParamNames) {
        const value = url.searchParams.get(name);
        if (isNumericString(value)) {
          return String(value).trim();
        }
      }
    } catch (_error) {
      // Fall through to best-effort regex parsing below.
    }

    const pathMatch = String(rawUrl || '').match(/\/jobs\/view\/(\d+)/);
    if (pathMatch) {
      return pathMatch[1];
    }

    const queryMatch = String(rawUrl || '').match(/[?&](?:currentJobId|jobId)=(\d+)/i);
    return queryMatch ? queryMatch[1] : '';
  }

  function delay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function isElementVisible(element) {
    if (!element || typeof element.getClientRects !== 'function') return false;
    const rects = element.getClientRects();
    return rects.length > 0;
  }

  function matchesExpandControl(element) {
    const text = [
      element.textContent || '',
      element.getAttribute('aria-label') || '',
      element.getAttribute('title') || ''
    ].join(' ');
    if (!text) return false;
    if (COLLAPSE_TEXT_PATTERNS.some((pattern) => pattern.test(text))) return false;
    return EXPAND_TEXT_PATTERNS.some((pattern) => pattern.test(text));
  }

  async function expandJobDescriptionIfNeeded() {
    const descriptionElement = findElement(SELECTORS.jobDescription);
    if (!descriptionElement) return false;

    const candidates = new Set();
    for (const selector of EXPAND_CONTROL_SELECTORS) {
      descriptionElement.querySelectorAll(selector).forEach((element) => candidates.add(element));
      document.querySelectorAll(selector).forEach((element) => candidates.add(element));
    }

    descriptionElement.querySelectorAll('button, a[role="button"], span[role="button"]').forEach((element) => {
      if (matchesExpandControl(element)) {
        candidates.add(element);
      }
    });
    document.querySelectorAll('button, a[role="button"], span[role="button"]').forEach((element) => {
      if (matchesExpandControl(element)) {
        candidates.add(element);
      }
    });

    let clicked = false;
    for (const candidate of candidates) {
      if (!isElementVisible(candidate) || candidate.disabled) continue;

      const ariaExpanded = String(candidate.getAttribute('aria-expanded') || '').toLowerCase();
      if (ariaExpanded === 'true') continue;

      try {
        candidate.click();
        clicked = true;
      } catch (_error) {
        // Ignore click errors and continue trying other candidates.
      }
    }

    if (clicked) {
      await delay(220);
      await new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
    }
    return clicked;
  }

  function normalizeInlineText(text) {
    return String(text || '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
  }

  function buildDescriptionClone(sourceElement) {
    const clone = sourceElement.cloneNode(true);
    clone.querySelectorAll(DESCRIPTION_NOISE_SELECTORS).forEach((element) => element.remove());
    return clone;
  }

  function normalizeParagraphText(text) {
    if (!text) return '';
    const normalizedLines = String(text)
      .replace(/\u00a0/g, ' ')
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line) => line.replace(/[ \t]+/g, ' ').trim())
      .filter((line) => line.length > 0);

    if (normalizedLines.length === 0) return '';
    const merged = normalizedLines
      .join('\n')
      .replace(/([.!?;:])([A-Z])/g, '$1 $2')
      .replace(/([a-z0-9])([A-Z][a-z])/g, '$1 $2');
    return merged.trim();
  }

  function appendParagraphLines(lines, text) {
    const paragraph = normalizeParagraphText(text);
    if (!paragraph) return;
    paragraph.split('\n').forEach((line) => lines.push(line));
    lines.push('');
  }

  function hasNestedListChild(element) {
    return Array.from(element.children).some((child) => {
      const tag = child.tagName ? child.tagName.toUpperCase() : '';
      return tag === 'UL' || tag === 'OL';
    });
  }

  function appendListItem(lines, markerPrefix, continuationPrefix, text) {
    const itemText = normalizeParagraphText(text);
    if (!itemText) return;
    const itemLines = itemText.split('\n');
    lines.push(`${markerPrefix}${itemLines[0]}`);
    for (let i = 1; i < itemLines.length; i += 1) {
      lines.push(`${continuationPrefix}${itemLines[i]}`);
    }
  }

  function renderListText(listElement, lines, depth) {
    const isOrdered = listElement.tagName.toUpperCase() === 'OL';
    const startNumber = Math.max(1, Number.parseInt(listElement.getAttribute('start') || '1', 10) || 1);
    const items = Array.from(listElement.children).filter((child) => child.tagName && child.tagName.toUpperCase() === 'LI');

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const itemClone = item.cloneNode(true);
      itemClone.querySelectorAll(':scope > ul, :scope > ol').forEach((nested) => nested.remove());

      const indent = '  '.repeat(depth);
      const marker = isOrdered ? `${startNumber + index}. ` : '- ';
      appendListItem(lines, `${indent}${marker}`, `${indent}  `, itemClone.innerText || itemClone.textContent || '');

      const nestedLists = Array.from(item.children).filter((child) => {
        const tag = child.tagName ? child.tagName.toUpperCase() : '';
        return tag === 'UL' || tag === 'OL';
      });
      for (const nestedList of nestedLists) {
        renderListText(nestedList, lines, depth + 1);
      }
    }
    lines.push('');
  }

  function renderStructuredTextFromContainer(container, lines) {
    for (const childNode of container.childNodes) {
      if (childNode.nodeType === Node.TEXT_NODE) {
        appendParagraphLines(lines, childNode.nodeValue || '');
        continue;
      }
      if (childNode.nodeType !== Node.ELEMENT_NODE) continue;

      const tag = childNode.tagName.toUpperCase();
      if (tag === 'UL' || tag === 'OL') {
        renderListText(childNode, lines, 0);
        continue;
      }
      if (HEADING_TAGS.has(tag)) {
        appendParagraphLines(lines, childNode.innerText || childNode.textContent || '');
        continue;
      }
      if (BLOCK_TAGS.has(tag) || tag === 'MAIN') {
        if (hasNestedListChild(childNode)) {
          renderStructuredTextFromContainer(childNode, lines);
        } else {
          appendParagraphLines(lines, childNode.innerText || childNode.textContent || '');
        }
        continue;
      }
      if (tag === 'BR') {
        lines.push('');
        continue;
      }
      appendParagraphLines(lines, childNode.innerText || childNode.textContent || '');
    }
  }

  function compactStructuredLines(lines) {
    const output = [];
    for (const rawLine of lines) {
      const line = String(rawLine || '').replace(/\u00a0/g, ' ').replace(/[ \t]+$/g, '');
      if (!line.trim()) {
        if (output.length === 0 || output[output.length - 1] === '') continue;
        output.push('');
        continue;
      }
      output.push(line);
    }

    while (output.length > 0 && output[output.length - 1] === '') {
      output.pop();
    }
    return output.join('\n');
  }

  function escapeRegex(source) {
    return String(source || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function buildFlexibleHeadingSource(label) {
    return escapeRegex(String(label || '').trim())
      .replace(/\\,/g, '\\s*,\\s*')
      .replace(/\s+/g, '\\s+');
  }

  const SECTION_HEADING_SOURCES = SECTION_HEADING_LABELS.map((label) => buildFlexibleHeadingSource(label));
  const AGGRESSIVE_SECTION_HEADING_SOURCES = SECTION_HEADING_LABELS
    .filter((label) => /[\s,]/.test(label))
    .map((label) => buildFlexibleHeadingSource(label));

  function normalizeSentenceSpacing(text) {
    return String(text || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/([,;:])([A-Za-z])/g, '$1 $2')
      .replace(/([.!?;:])([A-Z])/g, '$1 $2')
      .replace(/\)([A-Za-z])/g, ') $1')
      .replace(/([A-Z]{3,})([A-Z][a-z])/g, '$1 $2')
      .replace(/([a-z0-9])([A-Z][a-z])/g, '$1 $2')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function splitIntoSentenceUnits(text) {
    const normalized = normalizeSentenceSpacing(text);
    if (!normalized) return [];
    return normalized
      .split(/(?<=[.!?])\s+(?=[A-Z0-9(])/g)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  function dedupeAdjacentBlocks(blocks) {
    const result = [];
    let lastFingerprint = '';
    for (const block of blocks) {
      const normalized = String(block || '').trim();
      if (!normalized) continue;
      const fingerprint = normalized
        .toLowerCase()
        .replace(/[ \t]+/g, ' ')
        .replace(/\s*\n\s*/g, '\n');
      if (fingerprint === lastFingerprint) continue;
      result.push(normalized);
      lastFingerprint = fingerprint;
    }
    return result;
  }

  function isHeadingOnlyBlock(text) {
    const match = matchKnownHeadingAtStart(text);
    return Boolean(match && !match.remainder);
  }

  function dedupeAdjacentSections(blocks) {
    const result = [];
    let previousHeadingFingerprint = '';
    let previousBodyFingerprint = '';

    for (let index = 0; index < blocks.length; index += 1) {
      const current = String(blocks[index] || '').trim();
      if (!current) continue;

      if (!isHeadingOnlyBlock(current)) {
        const paragraphFingerprint = current.toLowerCase().replace(/\s+/g, ' ');
        if (paragraphFingerprint === previousBodyFingerprint && !previousHeadingFingerprint) {
          continue;
        }
        result.push(current);
        previousHeadingFingerprint = '';
        previousBodyFingerprint = paragraphFingerprint;
        continue;
      }

      const heading = current;
      const hasBody = index + 1 < blocks.length && !isHeadingOnlyBlock(blocks[index + 1]);
      const body = hasBody ? String(blocks[index + 1] || '').trim() : '';
      const headingFingerprint = heading.toLowerCase().replace(/\s+/g, ' ');
      const bodyFingerprint = body.toLowerCase().replace(/\s+/g, ' ');

      if (headingFingerprint === previousHeadingFingerprint && bodyFingerprint === previousBodyFingerprint) {
        if (hasBody) index += 1;
        continue;
      }

      result.push(heading);
      if (hasBody) {
        result.push(body);
        index += 1;
      }
      previousHeadingFingerprint = headingFingerprint;
      previousBodyFingerprint = bodyFingerprint;
    }

    return result;
  }

  function matchKnownHeadingAtStart(text) {
    const value = String(text || '').trim();
    if (!value) return null;

    for (let index = 0; index < SECTION_HEADING_LABELS.length; index += 1) {
      const source = SECTION_HEADING_SOURCES[index];
      const regex = new RegExp(`^(${source})(?=\\s|:|$)`, 'i');
      const match = value.match(regex);
      if (match) {
        return {
          heading: match[0].trim(),
          remainder: value.slice(match[0].length).replace(/^[:\s-]+/, '').trim()
        };
      }
    }

    const genericHeadingMatch = value.match(/^([A-Z][A-Za-z0-9&/,'’()\- ]{2,80})(?=:\s+)/);
    if (genericHeadingMatch) {
      const heading = genericHeadingMatch[1].trim();
      return {
        heading,
        remainder: value.slice(genericHeadingMatch[0].length).replace(/^[:\s-]+/, '').trim()
      };
    }
    return null;
  }

  function isListStyleHeading(heading) {
    const normalized = String(heading || '').toLowerCase();
    return /(responsibilit|qualification|requirement|skill|offer|benefit|expect|process|shift|pay|details|ability|statement)/.test(normalized);
  }

  function splitListLikeSentenceFragments(sentence) {
    const normalized = normalizeSentenceSpacing(sentence);
    if (!normalized) return [];

    const fragments = normalized
      .replace(/\)\s+(?=[A-Z][a-z])/g, ')\n')
      .replace(/\b(preferred|required)\s+(?=[A-Z][a-z])/gi, '$1\n')
      .replace(/\s+(?=(Good|Basic|Strong|Excellent|Proven|Ability|Knowledge|Experience|Familiarity|Understanding)\b)/g, '\n')
      .split('\n')
      .map((part) => part.trim())
      .filter(Boolean);

    return fragments.length > 0 ? fragments : [normalized];
  }

  function formatBodyText(bodyText, heading) {
    const normalizedBody = normalizeSentenceSpacing(bodyText);
    if (!normalizedBody) return '';

    const bulletItems = normalizedBody
      .replace(/\s*[•▪◦]\s*/g, '\n')
      .split('\n')
      .map((segment) => segment.trim())
      .filter(Boolean);

    if (bulletItems.length > 1) {
      return bulletItems.map((segment) => `- ${segment}`).join('\n');
    }

    const sentences = splitIntoSentenceUnits(normalizedBody);
    if (isListStyleHeading(heading) && sentences.length >= 1) {
      const listItems = [];
      for (const sentence of sentences) {
        const fragments = sentence.length > 90 ? splitListLikeSentenceFragments(sentence) : [sentence];
        for (const fragment of fragments) {
          if (!fragment) continue;
          const fingerprint = fragment.toLowerCase().replace(/\s+/g, ' ');
          const previous = listItems[listItems.length - 1];
          const previousFingerprint = previous ? previous.toLowerCase().replace(/\s+/g, ' ') : '';
          if (fingerprint && fingerprint === previousFingerprint) continue;
          listItems.push(fragment);
        }
      }
      if (listItems.length >= 2) {
        return listItems.map((item) => `- ${item}`).join('\n');
      }
    }
    if (sentences.length >= 4 && normalizedBody.length > 280) {
      return sentences.join('\n');
    }
    return normalizedBody;
  }

  function postProcessDescriptionText(rawText) {
    if (!rawText || rawText === 'Job description not found') {
      return 'Job description not found';
    }

    let text = String(rawText)
      .replace(/\u00a0/g, ' ')
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/([A-Z]{3,})([A-Z][a-z])/g, '$1 $2')
      .replace(/\)([A-Za-z])/g, ') $1')
      .trim();

    const groupedHeadingSources = SECTION_HEADING_SOURCES.join('|');
    const headingPattern = new RegExp(`(^|[\\n\\r]|[.!?]\\s+)(\\s*(?:${groupedHeadingSources}))(?=\\s|:|$)`, 'gi');
    text = text.replace(headingPattern, (_match, prefix, heading) => `${prefix}\n\n${heading.trim()}`);

    if (AGGRESSIVE_SECTION_HEADING_SOURCES.length > 0) {
      const groupedAggressiveSources = AGGRESSIVE_SECTION_HEADING_SOURCES.join('|');
      const softHeadingPattern = new RegExp(`\\s+((?:${groupedAggressiveSources}))(?=\\s|:|$)`, 'gi');
      text = text.replace(softHeadingPattern, (_match, heading) => `\n\n${heading.trim()}`);
    }

    text = text
      .replace(/([A-Z][A-Za-z0-9&/,'’()\- ]{2,80}):\s+/g, '\n\n$1:\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const candidateBlocks = text
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .filter(Boolean);

    const finalBlocks = [];
    for (const block of candidateBlocks) {
      const headingMatch = matchKnownHeadingAtStart(block);
      if (headingMatch) {
        finalBlocks.push(headingMatch.heading);
        const body = formatBodyText(headingMatch.remainder, headingMatch.heading);
        if (body) finalBlocks.push(body);
        continue;
      }

      const formatted = formatBodyText(block, '');
      if (formatted) finalBlocks.push(formatted);
    }

    const dedupedBlocks = dedupeAdjacentBlocks(finalBlocks);
    const dedupedSections = dedupeAdjacentSections(dedupedBlocks);
    if (dedupedSections.length === 0) {
      return 'Job description not found';
    }
    return dedupedSections.join('\n\n');
  }

  function extractStructuredDescriptionText(descriptionElement) {
    if (!descriptionElement) return 'Job description not found';

    const clone = buildDescriptionClone(descriptionElement);
    const lines = [];
    renderStructuredTextFromContainer(clone, lines);
    const content = compactStructuredLines(lines);
    return postProcessDescriptionText(content);
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
      jobDescriptionText: extractStructuredDescriptionText(jobDescEl)
    };
  }

  function getCurrentJobInfo() {
    const coreInfo = extractJobInfo();
    const rawUrl = location.href;
    const jobId = extractJobIdFromRawUrl(rawUrl);
    const jobUrl = toStablePageUrl(rawUrl, jobId);
    const jobKey = jobUrl;

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
      job_id: '',
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

  async function buildTrackerDraftForExport(jobInfo) {
    const fallback = {
      status: 'Saved',
      round1_pass: 0,
      round2_pass: 0,
      round3_pass: 0,
      notes: ''
    };

    try {
      const existing = await sendRuntimeMessage({
        type: 'TRACKER_GET_BY_JOB_KEY',
        jobKey: jobInfo.jobKey
      });
      if (existing?.ok && existing.record) {
        return buildTrackerRecordDraft(jobInfo, {
          status: existing.record.status || 'Saved',
          round1_pass: existing.record.round1_pass,
          round2_pass: existing.record.round2_pass,
          round3_pass: existing.record.round3_pass,
          notes: existing.record.notes || ''
        });
      }
    } catch (_error) {
      // Ignore pre-read failure and fall back to default draft.
    }

    return buildTrackerRecordDraft(jobInfo, fallback);
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

  function inferExportErrorCode(error) {
    if (!error) return 'UNKNOWN_ERROR';
    if (error.errorCode) return error.errorCode;
    if (error.code) return error.code;
    const message = String(error.message || error || '').toLowerCase();
    if (message.includes('timeout') || message.includes('超时')) return 'MESSAGE_TIMEOUT';
    if (message.includes('no response') || message.includes('没有返回结果')) return 'MESSAGE_NO_RESPONSE';
    return 'UNKNOWN_ERROR';
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
    const recordDraft = await buildTrackerDraftForExport(jobInfo);

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
      await expandJobDescriptionIfNeeded();
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
        const exportError = new Error(mapTxtExportErrorMessage(exportResponse?.errorCode, exportResponse?.message));
        exportError.errorCode = exportResponse?.errorCode || 'TXT_EXPORT_FAILED';
        throw exportError;
      }

      const trackerResult = await trackAfterExport(jobInfo);
      if (!trackerResult.ok) {
        const trackerErrorCode = trackerResult.errorCode || 'TRACKER_UPSERT_FAILED';
        const trackerMessage = trackerResult.message || 'Tracker sync failed';
        const syncError = new Error(`TXT 已导出，但 CSV 同步失败：${trackerMessage}`);
        syncError.errorCode = trackerErrorCode;
        throw syncError;
      }

      return {
        ok: true,
        trackerResult,
        writtenFileName: exportResponse.writtenFileName
      };
    } catch (error) {
      if (!error?.errorCode) {
        error.errorCode = inferExportErrorCode(error);
      }
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
          .catch((error) =>
            sendResponse({
              ok: false,
              errorCode: inferExportErrorCode(error),
              message: error?.message || String(error)
            })
          );
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
