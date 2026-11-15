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
 * Trích xuất hậu tố mã lớp/học phần: 2 chữ số cuối + 1 chữ cái (nếu có)
 * Ví dụ:
 * - "106337026102438A" -> "38A"
 * - "106337026102440" -> "40"
 * - "21.11" -> "11"
 * - "21.39B" -> "39B"
 * - "21.41" -> "41"
 * - "106337026102438A-_DSTS.xlsx" -> "38A"
 */
export function extractClassOrCourseSuffix(str?: string | null): string {
  if (!str) return "";
  let clean = String(str).replace(/\.(xlsx|xls)$/i, "").trim();
  clean = clean.replace(/[-_]+(DSTS|dsts|bang[_-]?diem|CK)[-_]*$/i, "").trim();

  // 1. Kiểm tra ở cuối chuỗi: 2 chữ số cuối + 1 chữ cái (nếu có)
  const mEnd = clean.match(/(\d{2}[A-Za-z]?)[^0-9A-Za-z]*$/);
  if (mEnd) return mEnd[1].toUpperCase();

  // 2. Tìm bất kỳ cụm 2 chữ số + 1 chữ cái có phân tách rõ ràng
  const mMid = clean.match(/(?:^|[._\-\s]|lop|nhom)(\d{2}[A-Za-z]?)(?:[._\-\s]|$)/i);
  if (mMid) return mMid[1].toUpperCase();

  return "";
}

/**
 * Tạo tiền tố ngắn gọn cho bảng điểm theo GVHD + Hậu tố lớp (2 chữ số cuối + 1 chữ cái nếu có)
 * Ví dụ:
 * - ["Nguyễn Văn Nam"] + "106337026102441" -> "T.Nam_41"
 * - ["Nguyễn Văn Nam"] + "106337026102439B" -> "T.Nam_39B"
 * - ["Huỳnh Thanh Tùng", "Trần Văn Thanh"] + "106337026102440" -> "T.Tung_T.Thanh_40"
 */
export function generateScorecardPrefix(
  advisorNames?: string[] | null,
  classOrCourseCode?: string | null,
): string {
  const advisorPart = (advisorNames && advisorNames.length > 0)
    ? advisorNames
        .map((n) => n.trim())
        .filter(Boolean)
        .map((name) => `T.${getLecturerCallName(name)}`)
        .join("_")
    : "";

  const classSuffix = extractClassOrCourseSuffix(classOrCourseCode);

  if (advisorPart && classSuffix) {
    return `${advisorPart}_${classSuffix}`;
  }
  if (advisorPart) {
    return advisorPart;
  }
  if (classSuffix) {
    return `L_${classSuffix}`;
  }
  return "";
}

/**
 * Chuẩn hóa mã nhóm con trong bảng điểm (VD: "1" -> "N01", "01" -> "N01", "15" -> "N15", "Nhóm 1" -> "N01")
 * Hỗ trợ các mã cấm thi:
 * - "xxx", "XXX" -> "XXX"
 * - "X01", "X1", "x02", "Nhóm X01" -> "X01", "X02"...
 */
export function normalizeRawGroupCode(rawCode: string): string {
  const clean = rawCode.trim();
  if (!clean) return "";
  if (/^x{3,}$/i.test(clean)) {
    return "XXX";
  }
  const xMatch = clean.match(/^(?:nhóm\s+|nhom\s+)?x[-_]?\s*0*(\d+)$/i);
  if (xMatch) {
    const num = parseInt(xMatch[1], 10);
    return `X${num < 10 ? "0" + num : num}`;
  }
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
 * Kiểm tra mã nhóm có phải ký hiệu cấm thi (xxx hoặc X## với ## là số thứ tự) không.
 * Các nhóm cấm thi sẽ không được phân công chấm thi.
 * Ví dụ:
 * - Dạng xxx: "xxx", "XXX", "T.Nam_41_XXX", "Nhóm xxx", "41_xxx" -> true
 * - Dạng X##: "X01", "X1", "x02", "T.Nam_41_X01", "Nhóm X01", "41_X02" -> true
 */
export function isBarredGroupCode(code?: string | null): boolean {
  if (!code) return false;
  const clean = code.trim();
  return /(?:^|[_-\s])(?:nhóm\s+|nhom\s+)?(?:x{3,}|x[-_]?\s*\d+)(?:[_-\s]|$)/i.test(clean);
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
