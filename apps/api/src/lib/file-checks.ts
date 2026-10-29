/** Checks on uploaded files that need no dependencies (unit-tested in test/file-checks.test.ts). */

/**
 * multer decodes the multipart filename as latin1; restore UTF-8 (₹, non-ASCII names), drop any path
 * and control characters, and keep it to a sane length.
 */
export function cleanFilename(original: string): string {
  const utf8 = Buffer.from(original, 'latin1').toString('utf8');
  const base = utf8.replace(/^.*[\\/]/, '');
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (clean.length <= 200) return clean || 'upload';
  const ext = /\.[a-z0-9]{1,5}$/i.exec(clean)?.[0] ?? '';
  return clean.slice(0, 200 - ext.length) + ext;
}

/**
 * True when the bytes are a spreadsheet or text: a zip container (.xlsx — also used by mislabelled
 * ".xls" exports), an OLE2 compound file (.xls) or plain text (CSV, TSV, HTML "xls" exports). Anything
 * else — a PDF or an image renamed to .xlsx — is rejected before it reaches the parser.
 */
export function looksLikeSpreadsheet(buf: Buffer): boolean {
  if (buf.length === 0) return false;
  const startsWith = (...bytes: number[]) => bytes.every((b, i) => buf[i] === b);
  if (startsWith(0x50, 0x4b, 0x03, 0x04)) return true; // zip (xlsx)
  if (startsWith(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)) return true; // OLE2 (xls)
  if (startsWith(0xff, 0xfe) || startsWith(0xfe, 0xff)) return true; // UTF-16 text with BOM
  // Text: no NUL bytes in the first 8 KB.
  return !buf.subarray(0, 8192).includes(0);
}
