/** Lines of a report CSV's table (header, rows, totals), after the info header block. */
function csvTable(text) {
  return text.split('\r\n\r\n')[1].trim().split('\r\n');
}

module.exports = { csvTable };
