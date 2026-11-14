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

/**
 * Trích xuất tên gọi ngắn gọn không dấu của giảng viên (VD: "Huỳnh Thanh Tùng" -> "Tung", "Huỳnh Việt Thắng" -> "Thang")
 */
export function getLecturerCallName(fullName: string): string {
  const clean = fullName.replace(/^(TS\.|PGS\.TS\.|PGS\.|GS\.|ThS\.|Thầy|Cô)\s+/gi, "").trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  const lastName = parts[parts.length - 1];
  const unaccented = lastName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .trim();
  return unaccented.charAt(0).toUpperCase() + unaccented.slice(1);
}

/**
 * Tạo tiền tố ngắn gọn cho bảng điểm theo GVHD (VD: ["Trần Văn Thanh", "Huỳnh Thanh Tùng"] -> "T.Thanh_T.Tung")
 */
export function generateScorecardPrefix(advisorNames?: string[] | null): string {
  if (!advisorNames || advisorNames.length === 0) return "";
  const valid = advisorNames.map((n) => n.trim()).filter(Boolean);
  if (valid.length === 0) return "";
  return valid.map((name) => `T.${getLecturerCallName(name)}`).join("_");
}

/**
 * Chuẩn hóa mã nhóm con trong bảng điểm (VD: "1" -> "N01", "01" -> "N01", "15" -> "N15", "Nhóm 1" -> "N01")
 */
export function normalizeRawGroupCode(rawCode: string): string {
  const clean = rawCode.trim();
  if (!clean) return "";
  if (/^\d+$/.test(clean)) {
    const num = parseInt(clean, 10);
    return `N${num < 10 ? "0" + num : num}`;
  }
  const nhomMatch = clean.match(/^(?:nhóm|nhom|n)\s*0*(\d+)$/i);
  if (nhomMatch) {
    const num = parseInt(nhomMatch[1], 10);
    return `N${num < 10 ? "0" + num : num}`;
  }
  return clean;
}

/**
 * Tạo mã nhóm chuẩn kết hợp tiền tố GVHD/Bảng điểm + Tên nhóm con
 * Ví dụ: "T.Thanh_T.Tung" + "1" -> "T.Thanh_T.Tung_N01"
 *        "T.Thang" + "01" -> "T.Thang_N01"
 */
export function formatAdvisorGroupCode(prefix: string, rawCode: string): string {
  const norm = normalizeRawGroupCode(rawCode);
  if (!prefix) return norm;
  if (norm.toLowerCase().startsWith(prefix.toLowerCase())) return norm;
  return `${prefix}_${norm}`;
}
