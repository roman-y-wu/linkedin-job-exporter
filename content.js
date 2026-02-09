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
  const SECTION_HEADING_LABELS = [
    'About the job',
    'About us',
    'Overview',
    'Job Summary',
    'Summary',
    'Role',
    'What you will do',
    "What you'll do",
    'What you’ll do',
    'What we offer',
    'What to expect during the interview process',
    'Day to day',
    'The Team',
    'Our Culture',
    'Responsibilities',
    'Duties',
    'Requirements',
    'Qualifications',
    'Required Qualifications',
    'Minimum Qualifications',
    'Basic Qualifications',
    'Preferred Qualifications',
    'Required Skills',
    'Preferred Skills',
    'Must Have',
    'Nice to Have',
    'Who You Are',
    'Required Knowledge, Skills And Abilities',
    'Benefits',
    'Compensation',
    'Pay',
    'Pay Transparency',
    'Schedule',
    'Additional Details',
    'Disclaimer',
    'Equal Opportunity Statement'
  ];
  const SECTION_HEADING_PATTERNS = SECTION_HEADING_LABELS.map((heading) => {
    const source = escapeRegex(heading).replace(/\s+/g, '\\s+');
    return {
      heading,
      inlinePattern: new RegExp(`^(${source})(?:\\s*[:\\-])?\\s+(.+)$`, 'i'),
      exactPattern: new RegExp(`^${source}$`, 'i')
    };
  });

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
    clone.querySelectorAll('[aria-hidden="true"], .visually-hidden, .sr-only, [style*="display: none"]').forEach((el) => {
      el.remove();
    });
    return String(clone.textContent || '').replace(/\s+/g, ' ').trim();
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

  function delay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  async function waitForDescriptionElement(timeoutMs = 2200) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const element = findElement(SELECTORS.jobDescription);
      if (element) return element;
      await delay(120);
    }
    return findElement(SELECTORS.jobDescription);
  }

  function isElementVisible(element) {
    if (!element || typeof element.getClientRects !== 'function') return false;
    return element.getClientRects().length > 0;
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

  function collectExpandCandidates(descriptionElement) {
    const candidates = new Set();
    for (const selector of EXPAND_CONTROL_SELECTORS) {
      descriptionElement.querySelectorAll(selector).forEach((el) => candidates.add(el));
      document.querySelectorAll(selector).forEach((el) => candidates.add(el));
    }

    descriptionElement.querySelectorAll('button, a[role="button"], span[role="button"]').forEach((el) => {
      if (matchesExpandControl(el)) candidates.add(el);
    });
    document.querySelectorAll('button, a[role="button"], span[role="button"]').forEach((el) => {
      if (matchesExpandControl(el)) candidates.add(el);
    });
    return candidates;
  }

  function getDescriptionLength(element) {
    return String(element?.innerText || element?.textContent || '').trim().length;
  }

  async function expandJobDescriptionIfNeeded() {
    const descriptionElement = await waitForDescriptionElement();
    if (!descriptionElement) return false;

    let clickedAny = false;
    let previousLength = getDescriptionLength(descriptionElement);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const currentElement = findElement(SELECTORS.jobDescription) || descriptionElement;
      try {
        currentElement.scrollIntoView({ block: 'center', inline: 'nearest' });
      } catch (_error) {
        // Ignore if scroll fails.
      }

      const candidates = collectExpandCandidates(currentElement);
      let clickedThisRound = false;
      for (const candidate of candidates) {
        if (!isElementVisible(candidate) || candidate.disabled) continue;
        const ariaExpanded = String(candidate.getAttribute('aria-expanded') || '').toLowerCase();
        if (ariaExpanded === 'true') continue;
        try {
          candidate.click();
          clickedThisRound = true;
          clickedAny = true;
        } catch (_error) {
          // Ignore and keep trying.
        }
      }

      await delay(260 + attempt * 120);
      await new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));

      const nextElement = findElement(SELECTORS.jobDescription) || currentElement;
      const currentLength = getDescriptionLength(nextElement);
      const grew = currentLength > previousLength + 20;
      previousLength = Math.max(previousLength, currentLength);

      if (!clickedThisRound && !grew) break;
    }

    return clickedAny;
  }

  function normalizeParagraphText(text) {
    const lines = String(text || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line) => line.replace(/[ \t]+/g, ' ').trim())
      .filter(Boolean);

    return lines.join('\n').trim();
  }

  function isLikelyHeadingText(text) {
    const value = String(text || '').trim();
    if (!value) return false;
    if (value.length > 90) return false;
    const words = value.split(/\s+/).filter(Boolean);
    if (words.length > 10) return false;
    if (/^[A-Z][A-Za-z0-9/&,'’()\- ]{2,90}$/.test(value)) return true;
    return isKnownHeadingLine(value);
  }

  function extractInlineHeadingFromElement(element) {
    if (!element || !element.childNodes) return null;

    const firstElementChild = Array.from(element.childNodes).find((node) => node.nodeType === Node.ELEMENT_NODE);
    if (!firstElementChild) return null;
    const tag = String(firstElementChild.tagName || '').toUpperCase();
    if (tag !== 'STRONG' && tag !== 'B') return null;

    const headingRaw = normalizeParagraphText(firstElementChild.textContent || '');
    const heading = headingRaw.replace(/[:：\-\u2013\u2014]+$/g, '').trim();
    if (!isLikelyHeadingText(heading)) return null;

    const clone = element.cloneNode(true);
    const cloneFirstElementChild = Array.from(clone.childNodes).find((node) => node.nodeType === Node.ELEMENT_NODE);
    if (cloneFirstElementChild) cloneFirstElementChild.remove();
    const body = normalizeParagraphText(clone.innerText || clone.textContent || '');
    if (!body) return null;

    return { heading, body };
  }

  function appendParagraphLines(lines, text) {
    const paragraph = normalizeParagraphText(text);
    if (!paragraph) return;
    paragraph.split('\n').forEach((line) => lines.push(line));
    lines.push('');
  }

  function hasNestedListChild(element) {
    return Array.from(element.children || []).some((child) => {
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

  function containsBrChild(element) {
    return Array.from(element.childNodes).some(
      (node) => node.nodeType === Node.ELEMENT_NODE && node.tagName.toUpperCase() === 'BR'
    );
  }

  function renderBrDelimitedBlock(element, lines) {
    let buffer = '';
    for (const node of element.childNodes) {
      if (node.nodeType === Node.ELEMENT_NODE && node.tagName.toUpperCase() === 'BR') {
        appendParagraphLines(lines, buffer);
        buffer = '';
        continue;
      }
      if (node.nodeType === Node.TEXT_NODE) {
        buffer += node.nodeValue || '';
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        buffer += node.innerText || node.textContent || '';
      }
    }
    appendParagraphLines(lines, buffer);
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
        } else if (containsBrChild(childNode)) {
          renderBrDelimitedBlock(childNode, lines);
        } else {
          const inlineHeading = extractInlineHeadingFromElement(childNode);
          if (inlineHeading) {
            lines.push(inlineHeading.heading);
            lines.push('');
            inlineHeading.body.split('\n').forEach((line) => lines.push(line));
            lines.push('');
            continue;
          }
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

  function formatPlainTextFallback(text) {
    let value = String(text || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();

    if (!value) return '';

    value = value.replace(/\s*[•▪◦○►▸➤➜–]\s*/g, '\n- ');

    for (const heading of SECTION_HEADING_LABELS) {
      const src = escapeRegex(heading).replace(/\s+/g, '\\s+');
      const re = new RegExp(`(^|[\\n\\r]|[.!?]\\s+)(\\s*(${src}))(?=\\s|:|$)`, 'gi');
      value = value.replace(re, (_match, prefix, headingText) => `${prefix}\n\n${headingText.trim()}\n`);
    }

    value = value.replace(/([A-Z][A-Za-z0-9&/,'’()\- ]{2,80}):\s+/g, '\n\n$1:\n');
    value = value.replace(/^(.{1,80}):\s*$/gm, '\n\n$1:\n');

    value = value.replace(/\n{3,}/g, '\n\n').trim();

    if (!value.includes('\n')) {
      const sentenceSplit = value
        .split(/(?<=[.!?])\s+(?=[A-Z0-9(])/g)
        .map((part) => part.trim())
        .filter(Boolean);
      if (sentenceSplit.length >= 3) {
        value = sentenceSplit.join('\n');
      }
    }

    return value;
  }

  function scoreDescriptionQuality(text) {
    const value = String(text || '').trim();
    if (!value) return -1;

    const lines = value.split('\n').map((line) => line.trim()).filter(Boolean);
    const bulletLines = lines.filter((line) => /^(-|\*|\d+\.)\s+/.test(line)).length;
    const headingLines = lines.filter((line) => {
      if (line.length > 90) return false;
      if (/^[A-Z][A-Za-z0-9/&,'’()\- ]{2,90}$/.test(line) && !/[.!?]$/.test(line)) return true;
      return isKnownHeadingLine(line);
    }).length;
    const longLines = lines.filter((line) => line.length > 220).length;
    const uniqueLineRatio = lines.length === 0 ? 0 : new Set(lines.map((line) => line.toLowerCase())).size / lines.length;

    return (
      value.length * 0.01 +
      lines.length * 0.5 +
      bulletLines * 3 +
      headingLines * 2 -
      longLines * 2 +
      uniqueLineRatio * 4
    );
  }

  function flattenJsonLdNodes(input, out) {
    if (!input) return;
    if (Array.isArray(input)) {
      for (const item of input) flattenJsonLdNodes(item, out);
      return;
    }
    if (typeof input !== 'object') return;

    out.push(input);
    if (Array.isArray(input['@graph'])) {
      flattenJsonLdNodes(input['@graph'], out);
    }
  }

  function extractDescriptionFromJsonLd() {
    const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    const allNodes = [];

    for (const script of scripts) {
      const raw = String(script.textContent || '').trim();
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        flattenJsonLdNodes(parsed, allNodes);
      } catch (_error) {
        // Ignore malformed JSON-LD blocks.
      }
    }

    const jobPostingNode = allNodes.find((node) => {
      const type = node?.['@type'];
      if (Array.isArray(type)) return type.some((v) => String(v).toLowerCase() === 'jobposting');
      return String(type || '').toLowerCase() === 'jobposting';
    });

    if (!jobPostingNode) return '';
    const description = String(jobPostingNode.description || '').trim();
    if (!description) return '';

    const wrapper = document.createElement('div');
    wrapper.innerHTML = description;
    wrapper.querySelectorAll(DESCRIPTION_NOISE_SELECTORS).forEach((el) => el.remove());

    const lines = [];
    renderStructuredTextFromContainer(wrapper, lines);
    const structured = compactStructuredLines(lines);
    if (structured) return structured;

    return normalizeParagraphText(wrapper.innerText || wrapper.textContent || '');
  }

  function splitHeadingLine(text) {
    const line = String(text || '').trim();
    if (!line) return null;

    for (const candidate of SECTION_HEADING_PATTERNS) {
      const match = line.match(candidate.inlinePattern);
      if (match) {
        return {
          heading: candidate.heading,
          body: String(match[2] || '').trim()
        };
      }
    }

    const genericMatch = line.match(/^([A-Z][A-Za-z0-9&/,'’()\- ]{2,70}):\s+(.+)$/);
    if (genericMatch) {
      return {
        heading: String(genericMatch[1] || '').trim(),
        body: String(genericMatch[2] || '').trim()
      };
    }

    const keywordInlineMatch = line.match(
      /^(Responsibilities|Qualifications|Requirements|Benefits|Compensation|What you will do|What you'll do|What you’ll do|Preferred Qualifications|Required Qualifications|Minimum Qualifications|Must Have|Nice to Have)(?:\s*[:\-])?\s+(.+)$/i
    );
    if (keywordInlineMatch) {
      return {
        heading: String(keywordInlineMatch[1] || '').trim(),
        body: String(keywordInlineMatch[2] || '').trim()
      };
    }

    const allCapsHeadingMatch = line.match(/^([A-Z][A-Z0-9/&,'’()\- ]{4,60})\s+([A-Z][\s\S]{12,})$/);
    if (allCapsHeadingMatch) {
      return {
        heading: String(allCapsHeadingMatch[1] || '').trim(),
        body: String(allCapsHeadingMatch[2] || '').trim()
      };
    }

    return null;
  }

  function isKnownHeadingLine(text) {
    const line = String(text || '').trim();
    if (!line) return false;
    return SECTION_HEADING_PATTERNS.some((candidate) => candidate.exactPattern.test(line));
  }

  function enforceHeadingSpacing(text) {
    const sourceLines = String(text || '')
      .split('\n')
      .map((line) => String(line || '').trimEnd());
    const output = [];

    for (const rawLine of sourceLines) {
      const line = rawLine.trim();
      if (!line) {
        if (output.length > 0 && output[output.length - 1] !== '') {
          output.push('');
        }
        continue;
      }

      const split = splitHeadingLine(line);
      if (split) {
        if (output.length > 0 && output[output.length - 1] !== '') output.push('');
        output.push(`## ${split.heading}`);
        output.push('');
        if (split.body) output.push(split.body);
        continue;
      }

      const isHeading = isKnownHeadingLine(line);
      if (isHeading) {
        if (output.length > 0 && output[output.length - 1] !== '') output.push('');
        output.push(`## ${line}`);
        output.push('');
        continue;
      }

      output.push(line);
    }

    while (output.length > 0 && output[output.length - 1] === '') {
      output.pop();
    }

    const compact = [];
    for (const line of output) {
      if (line === '' && (compact.length === 0 || compact[compact.length - 1] === '')) continue;
      compact.push(line);
    }

    return compact.join('\n');
  }

  function extractStructuredDescriptionText(descriptionElement) {
    const candidates = [];

    if (descriptionElement) {
      const clone = descriptionElement.cloneNode(true);
      clone.querySelectorAll(DESCRIPTION_NOISE_SELECTORS).forEach((el) => el.remove());

      const lines = [];
      renderStructuredTextFromContainer(clone, lines);
      const content = compactStructuredLines(lines);
      if (content) {
        candidates.push(enforceHeadingSpacing(content));
      }

      const fallbackText = formatPlainTextFallback(clone.innerText || clone.textContent || '');
      if (fallbackText) {
        candidates.push(enforceHeadingSpacing(fallbackText));
      }
    }

    const jsonLdDescription = extractDescriptionFromJsonLd();
    if (jsonLdDescription) {
      candidates.push(enforceHeadingSpacing(formatPlainTextFallback(jsonLdDescription)));
    }

    const uniqueCandidates = Array.from(new Set(candidates.map((item) => String(item || '').trim()).filter(Boolean)));
    if (uniqueCandidates.length === 0) return 'Job description not found';

    uniqueCandidates.sort((a, b) => scoreDescriptionQuality(b) - scoreDescriptionQuality(a));
    return uniqueCandidates[0] || 'Job description not found';
  }

  function extractJobDescriptionText() {
    const jobDescEl = findElement(SELECTORS.jobDescription);
    return extractStructuredDescriptionText(jobDescEl);
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
      (async () => {
        try {
          await expandJobDescriptionIfNeeded();
          sendResponse({ ok: true, jobInfo: getCurrentJobInfo() });
        } catch (error) {
          sendResponse({ ok: false, message: error?.message || 'Failed to parse job info.' });
        }
      })();
      return true;
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
