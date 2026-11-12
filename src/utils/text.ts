/** Chuẩn hóa tiếng Việt để so khớp tiêu đề cột và nhãn. */
export function normalizeText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

export function isBlankRow(row: unknown[]): boolean {
  return row.every(
    (cell) => cell === null || cell === undefined || String(cell).trim() === "",
  );
}
