const PDFDocument = require('pdfkit');
const { NO_EXPIRY_DATE } = require('../inventory/batchIdentity');

/**
 * Exports a report produced by reports.service. Reports arrive with columns
 * already restricted to what the user may see (see restrictColumns), so an
 * export can never contain a field the user could not see on screen.
 */

function formatCell(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (value === NO_EXPIRY_DATE) return 'No expiry';
  return String(value);
}

function csvEscape(value) {
  let text = formatCell(value);
  // Neutralize spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(report) {
  const columns = report.columns;
  const lines = [columns.map((c) => csvEscape(c.label)).join(',')];
  for (const row of report.rows) lines.push(columns.map((c) => csvEscape(row[c.key])).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}

function humanize(key) {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}

function toPdf(report, { pharmacyName, generatedBy }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(16).fillColor('#0b1f3a').text(report.title);
    doc.fontSize(9).fillColor('#444')
      .text(`${pharmacyName}${report.period ? `  |  ${report.period.dateFrom || 'start'} to ${report.period.dateTo || 'today'}` : ''}${report.asOf ? `  |  As of ${report.asOf}` : ''}`)
      .text(`Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC by ${generatedBy}`);
    doc.moveDown();

    if (report.summary && !Array.isArray(report.summary)) {
      const entries = Object.entries(report.summary).filter(([, v]) => v === null || typeof v !== 'object');
      doc.fontSize(9).fillColor('#000');
      entries.forEach(([key, value], i) => {
        doc.text(`${humanize(key)}: ${formatCell(value)}`, { continued: i % 3 !== 2 && i !== entries.length - 1 });
        if (i % 3 !== 2 && i !== entries.length - 1) doc.text('     ', { continued: true });
      });
      doc.moveDown();
    }

    const columns = report.columns;
    const tableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const colWidth = tableWidth / Math.max(columns.length, 1);
    const drawRow = (cells, bold) => {
      if (doc.y > doc.page.height - doc.page.margins.bottom - 20) doc.addPage();
      const y = doc.y;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5).fillColor('#000');
      cells.forEach((cell, i) => {
        doc.text(cell, doc.page.margins.left + i * colWidth, y, { width: colWidth - 4, height: 20, ellipsis: true });
      });
      doc.y = y + 14;
    };
    drawRow(columns.map((c) => c.label), true);
    for (const row of report.rows) drawRow(columns.map((c) => formatCell(row[c.key])), false);
    if (report.rows.length === 0) doc.font('Helvetica').text('No records for the selected filters.');
    doc.end();
  });
}

module.exports = { toCsv, toPdf };
