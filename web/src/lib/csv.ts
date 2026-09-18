/** Trigger a client-side download of CSV text that is already serialised. */
export function downloadCsvText(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/** Trigger a client-side CSV download. A BOM is prepended so Excel detects UTF-8. */
export function downloadCsv(filename: string, rows: Array<Array<string | number>>) {
  const escape = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
  const body = rows.map((row) => row.map(escape).join(",")).join("\r\n");
  downloadCsvText(filename, "\uFEFF" + body);
}
