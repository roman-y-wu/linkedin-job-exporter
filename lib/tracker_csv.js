(function (globalScope) {
  'use strict';

  const CSV_HEADERS = [
    'job_key',
    'job_id',
    'company',
    'position',
    'location',
    'job_url',
    'status',
    'saved_at',
    'applied_at',
    'interview_at',
    'rejected_at',
    'ghosted_at',
    'round1_pass',
    'round2_pass',
    'round3_pass',
    'notes',
    'created_at',
    'updated_at'
  ];

  const STATUS_VALUES = ['Saved', 'Applied', 'Interview', 'Rejected', 'Ghosted'];

  function isHeaderMatch(headers) {
    if (!Array.isArray(headers) || headers.length !== CSV_HEADERS.length) return false;
    for (let i = 0; i < CSV_HEADERS.length; i += 1) {
      if (headers[i] !== CSV_HEADERS[i]) return false;
    }
    return true;
  }

  function parseCsv(text) {
    const source = String(text || '').replace(/^\uFEFF/, '');
    const rows = [];
    let row = [];
    let value = '';
    let inQuotes = false;

    for (let i = 0; i < source.length; i += 1) {
      const ch = source[i];
      if (inQuotes) {
        if (ch === '"') {
          if (source[i + 1] === '"') {
            value += '"';
            i += 1;
          } else {
            inQuotes = false;
          }
        } else {
          value += ch;
        }
        continue;
      }

      if (ch === '"') {
        inQuotes = true;
        continue;
      }

      if (ch === ',') {
        row.push(value);
        value = '';
        continue;
      }

      if (ch === '\n') {
        row.push(value);
        rows.push(row);
        row = [];
        value = '';
        continue;
      }

      if (ch === '\r') {
        continue;
      }

      value += ch;
    }

    if (value.length > 0 || row.length > 0) {
      row.push(value);
      rows.push(row);
    }

    const headers = rows.length > 0 ? rows[0] : [];
    const dataRows = rows.slice(1).filter((candidate) => candidate.some((cell) => String(cell || '').length > 0));
    const objects = dataRows.map((dataRow) => {
      const item = {};
      for (let i = 0; i < CSV_HEADERS.length; i += 1) {
        item[CSV_HEADERS[i]] = dataRow[i] == null ? '' : String(dataRow[i]);
      }
      return item;
    });

    return {
      headers,
      rows: dataRows,
      objects
    };
  }

  function csvEscape(value) {
    const str = value == null ? '' : String(value);
    if (/[",\n\r]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  function serializeObjects(objects, headers, includeBom) {
    const headerRow = Array.isArray(headers) && headers.length > 0 ? headers : CSV_HEADERS;
    const lines = [headerRow.join(',')];

    for (const obj of objects || []) {
      const line = headerRow.map((header) => csvEscape(obj?.[header] ?? '')).join(',');
      lines.push(line);
    }

    const body = lines.join('\n');
    return includeBom ? `\uFEFF${body}` : body;
  }

  globalScope.TrackerCsv = {
    CSV_HEADERS,
    STATUS_VALUES,
    isHeaderMatch,
    parseCsv,
    serializeObjects
  };
})(typeof self !== 'undefined' ? self : window);
