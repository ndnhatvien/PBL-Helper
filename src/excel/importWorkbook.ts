import * as XLSX from "xlsx";
import type {
  ColumnMapping,
  ParsedStudentRow,
  PendingWorkbook,
  Student,
  WorkbookValidationSummary,
} from "../types";
import { arrayBufferToBase64, base64ToArrayBuffer } from "../utils/base64";
import { createId } from "../utils/id";
import { cellText, isBlankRow, normalizeText } from "../utils/text";

export interface HeaderDetection {
  headerRow: number;
  mapping: ColumnMapping;
  headers: string[];
  metaCourseCode: string | null;
  metaCourseName: string | null;
  metaLecturerName: string | null;
  metaLecturerNames?: string[];
  sourceTemplate: "bang_diem" | "dsts" | "custom";
}

export function splitLecturerNames(raw: string): string[] {
  if (!raw) return [];
  const parts = raw
    .split(/\s+v\u00e0\s+|\s*&\s*|\s*,\s*|\s*;\s*/i)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return parts.length > 0 ? parts : [raw.trim()];
}

export const EMPTY_MAPPING: ColumnMapping = {
  mssv: null,
  name: null,
  className: null,
  courseCode: null,
  courseName: null,
  groupCode: null,
  advisor: null,
  score: null,
};

function matchesMssv(value: string): boolean {
  const text = normalizeText(value);
  return (
    text.includes("mssv") ||
    text.includes("ma so sinh vien") ||
    text.includes("ma sinh vien") ||
    text === "ma sv" ||
    text === "so the" ||
    text.includes("so the sv") ||
    text.includes("so the sinh vien")
  );
}

function matchesName(value: string): boolean {
  const text = normalizeText(value);
  return (
    text === "ho ten" ||
    text === "ho va ten" ||
    text === "ten sinh vien" ||
    text === "ho ten sinh vien" ||
    text === "ho va ten sinh vien" ||
    text === "ten"
  );
}

function matchesClass(value: string): boolean {
  const text = normalizeText(value);
  return (
    text === "lop" ||
    text === "lop sh" ||
    text.includes("lop sinh hoat") ||
    text.includes("lop hanh chinh")
  );
}

function matchesCourseCode(value: string): boolean {
  const text = normalizeText(value);
  return (
    text.includes("ma hoc phan") ||
    text.includes("ma lop hoc phan") ||
    text.includes("ma mon hoc")
  );
}

function matchesCourseName(value: string): boolean {
  const text = normalizeText(value);
  return (
    text.includes("ten hoc phan") ||
    text.includes("ten lop hoc phan") ||
    text.includes("ten mon hoc")
  );
}

function matchesGroup(value: string): boolean {
  const text = normalizeText(value);
  return (
    text.includes("nhom") ||
    text === "group" ||
    text === "ma nhom" ||
    text === "nhom pbl" ||
    text === "ten nhom"
  );
}

function matchesAdvisor(value: string): boolean {
  const text = normalizeText(value);
  return (
    text === "gvhd" ||
    text === "cbhd" ||
    text === "advisor" ||
    text.includes("giang vien huong dan") ||
    text.includes("can bo huong dan") ||
    text.includes("nguoi huong dan") ||
    text.includes("gv huong dan") ||
    text === "giang vien hd"
  );
}

function matchesScore(value: string): boolean {
  const text = normalizeText(value);
  if (text.includes("chu")) return false;
  return (
    text === "ck" ||
    text === "diem" ||
    text === "diem ck" ||
    text === "diem so" ||
    text.startsWith("diem (so)") ||
    text.includes("diem cuoi") ||
    text.includes("diem thi") ||
    text.includes("diem tong ket") ||
    text.includes("diem mon") ||
    text.includes("diem pbl") ||
    text.includes("diem bao ve")
  );
}

export function detectMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = { ...EMPTY_MAPPING };

  headers.forEach((header, index) => {
    if (mapping.mssv === null && matchesMssv(header)) mapping.mssv = index;
    else if (mapping.name === null && matchesName(header)) mapping.name = index;
    else if (mapping.className === null && matchesClass(header))
      mapping.className = index;
    else if (mapping.courseCode === null && matchesCourseCode(header))
      mapping.courseCode = index;
    else if (mapping.courseName === null && matchesCourseName(header))
      mapping.courseName = index;
    else if (mapping.groupCode === null && matchesGroup(header))
      mapping.groupCode = index;
    else if (mapping.advisor === null && matchesAdvisor(header))
      mapping.advisor = index;
    else if (mapping.score === null && matchesScore(header)) mapping.score = index;
  });

  // Trường hợp sheet có "Mã lớp học phần" trùng với cột học phần, ưu tiên MSSV.
  return mapping;
}

export function sheetToMatrix(
  workbook: XLSX.WorkBook,
  sheetName: string,
): unknown[][] {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
  });
}

function maxRowWidth(matrix: unknown[][]): number {
  return matrix.reduce((max, row) => Math.max(max, row.length), 0);
}

function normalizeRow(row: unknown[], width: number): unknown[] {
  return Array.from({ length: width }, (_, index) => row[index] ?? null);
}

const SUBHEADER_TOKENS = new Set([
  "so",
  "chu",
  "diem so",
  "diem chu",
  "bang so",
  "bang chu",
  "ck",
  "gk",
  "qt",
  "diem",
  "thang 10",
  "he 10",
  "he 4",
]);

function buildEffectiveHeaders(
  matrix: unknown[][],
  headerRow: number,
  rawHeaders: string[],
  mapping: ColumnMapping,
): string[] {
  const nextRow = matrix[headerRow + 1];
  if (!nextRow || !isRepeatedHeader(nextRow, rawHeaders, mapping)) {
    return rawHeaders;
  }
  const width = Math.max(rawHeaders.length, nextRow.length);
  return Array.from({ length: width }, (_, col) => {
    const primary = cellText(rawHeaders[col]);
    const sub = cellText(nextRow[col]);
    if (primary && (!sub || normalizeText(primary) === normalizeText(sub))) {
      return primary;
    }
    if (!primary && sub) {
      const prevPrimary = col > 0 ? cellText(rawHeaders[col - 1]) : "";
      if (prevPrimary && matchesScore(prevPrimary)) {
        return `${prevPrimary} (${sub})`;
      }
      return sub;
    }
    return primary;
  });
}

function detectFallbackGroupColumn(
  matrix: unknown[][],
  headerRow: number,
  headers: string[],
  mapping: ColumnMapping,
): number | null {
  const candidateCols: number[] = [];
  headers.forEach((h, idx) => {
    const norm = normalizeText(h);
    if (norm === "ma de" || norm === "ghi chu" || norm === "de tai") {
      candidateCols.push(idx);
    }
  });
  if (candidateCols.length === 0) return null;

  for (const colIdx of candidateCols) {
    for (let r = headerRow + 1; r < matrix.length; r += 1) {
      const row = matrix[r] ?? [];
      if (isBlankRow(row)) continue;
      if (isRepeatedHeader(row, headers, mapping)) continue;
      if (cellText(row[colIdx]) !== "") {
        return colIdx;
      }
    }
  }
  return null;
}

function detectSourceTemplate(
  matrix: unknown[][],
  headerRow: number,
  headers: string[],
): "bang_diem" | "dsts" | "custom" {
  const normalizedHeaders = headers.map((h) => normalizeText(h));
  if (normalizedHeaders.includes("so the")) return "dsts";
  for (let r = 0; r < headerRow; r += 1) {
    const rowText = (matrix[r] ?? []).map((c) => normalizeText(c)).join(" ");
    if (rowText.includes("danh sach thi ket thuc hoc phan")) return "dsts";
    if (rowText.includes("bang diem thanh phan")) return "bang_diem";
  }
  if (normalizedHeaders.includes("ck")) return "bang_diem";
  return "custom";
}

export function detectHeader(matrix: unknown[][]): HeaderDetection {
  const searchLimit = Math.min(matrix.length, 30);
  let fallback: HeaderDetection | null = null;

  for (let rowIndex = 0; rowIndex < searchLimit; rowIndex += 1) {
    const row = matrix[rowIndex] ?? [];
    const rawHeaders = row.map((cell) => cellText(cell));
    const mapping = detectMapping(rawHeaders);
    if (mapping.mssv !== null) {
      if (mapping.groupCode === null) {
        mapping.groupCode = detectFallbackGroupColumn(
          matrix,
          rowIndex,
          rawHeaders,
          mapping,
        );
      }
      const headers = buildEffectiveHeaders(
        matrix,
        rowIndex,
        rawHeaders,
        mapping,
      );
      return {
        headerRow: rowIndex,
        mapping,
        headers,
        ...extractMetadata(matrix, rowIndex),
        sourceTemplate: detectSourceTemplate(matrix, rowIndex, rawHeaders),
      };
    }
    if (!fallback && mapping.name !== null) {
      const headers = buildEffectiveHeaders(
        matrix,
        rowIndex,
        rawHeaders,
        mapping,
      );
      fallback = {
        headerRow: rowIndex,
        mapping,
        headers,
        ...extractMetadata(matrix, rowIndex),
        sourceTemplate: detectSourceTemplate(matrix, rowIndex, rawHeaders),
      };
    }
  }

  if (fallback) return fallback;

  // Không tìm thấy tiêu đề quen thuộc: dùng dòng đầu tiên không rỗng để người dùng sửa mapping.
  const firstNonEmpty = matrix.findIndex((row) => !isBlankRow(row));
  const headerRow = firstNonEmpty >= 0 ? firstNonEmpty : 0;
  const headers = (matrix[headerRow] ?? []).map((cell) => cellText(cell));
  return {
    headerRow,
    mapping: detectMapping(headers),
    headers,
    metaCourseCode: null,
    metaCourseName: null,
    metaLecturerName: null,
    sourceTemplate: "custom",
  };
}

const KNOWN_METADATA_LABELS = new Set([
  "ma lop hoc phan",
  "ma hoc phan",
  "ten lop hoc phan",
  "ten hoc phan",
  "lop",
  "lop hoc phan",
  "ma lop",
  "hoc phan",
  "ten mon hoc",
  "mon hoc",
  "giang vien",
  "giang vien phu trach",
  "giang vien huong dan",
  "gvhd",
  "ngay thi",
  "hoc ky",
  "phong",
  "phong thi",
]);

function isMetadataLabelCell(raw: unknown): boolean {
  const text = cellText(raw);
  if (!text) return false;
  const clean = normalizeText(text).replace(/:+$/, "").trim();
  if (!clean) return false;
  if (text.endsWith(":")) return true;
  return KNOWN_METADATA_LABELS.has(clean);
}

function extractMetadataValue(row: unknown[], col: number): string {
  const rawCell = cellText(row[col]);
  if (rawCell.includes(":")) {
    const inline = rawCell.split(":").slice(1).join(":").trim();
    if (inline) return inline;
  }
  for (let index = col + 1; index < row.length; index += 1) {
    const candidate = cellText(row[index]);
    if (!candidate) continue;
    if (isMetadataLabelCell(row[index])) return "";
    return candidate;
  }
  return "";
}

function extractMetadata(
  matrix: unknown[][],
  headerRow: number,
): {
  metaCourseCode: string | null;
  metaCourseName: string | null;
  metaLecturerName: string | null;
  metaLecturerNames: string[];
} {
  let metaCourseCode: string | null = null;
  let metaCourseName: string | null = null;
  let metaLecturerName: string | null = null;
  const lecturerList: string[] = [];

  for (let rowIndex = 0; rowIndex < headerRow; rowIndex += 1) {
    const row = matrix[rowIndex] ?? [];
    for (let col = 0; col < row.length; col += 1) {
      const rawCell = cellText(row[col]);
      if (!rawCell) continue;
      const labelPart = rawCell.includes(":")
        ? rawCell.split(":")[0]
        : rawCell;
      const cleanLabel = normalizeText(labelPart).replace(/:+$/, "").trim();
      if (!cleanLabel) continue;

      const value = extractMetadataValue(row, col);
      if (!value) continue;

      if (
        !metaCourseCode &&
        (cleanLabel.includes("ma lop hoc phan") ||
          cleanLabel === "ma hoc phan" ||
          cleanLabel === "lop" ||
          cleanLabel === "lop hoc phan" ||
          cleanLabel === "ma lop")
      ) {
        metaCourseCode = value;
      } else if (
        !metaCourseName &&
        (cleanLabel.includes("ten lop hoc phan") ||
          cleanLabel === "ten hoc phan" ||
          cleanLabel === "hoc phan" ||
          cleanLabel === "ten mon hoc")
      ) {
        metaCourseName = value;
      } else if (
        cleanLabel === "giang vien" ||
        cleanLabel.includes("giang vien") ||
        cleanLabel === "gvhd" ||
        cleanLabel.includes("gvhd") ||
        cleanLabel.includes("huong dan")
      ) {
        const split = splitLecturerNames(value);
        for (const name of split) {
          if (!lecturerList.includes(name)) {
            lecturerList.push(name);
          }
        }
        if (!metaLecturerName) {
          metaLecturerName = value;
        }
      }
    }
  }

  const metaLecturerNames =
    lecturerList.length > 0
      ? lecturerList
      : metaLecturerName
        ? splitLecturerNames(metaLecturerName)
        : [];

  return {
    metaCourseCode,
    metaCourseName,
    metaLecturerName: metaLecturerNames.join(", ") || metaLecturerName,
    metaLecturerNames,
  };
}

function isRepeatedHeader(
  row: unknown[],
  headers: string[],
  mapping?: ColumnMapping,
): boolean {
  const nonEmpty = row
    .map((cell, index) => ({ cell: cellText(cell), index }))
    .filter((entry) => entry.cell !== "");
  if (nonEmpty.length === 0) return false;

  const exactRepeat = nonEmpty.every((entry) => {
    const header = cellText(headers[entry.index]);
    return header !== "" && normalizeText(header) === normalizeText(entry.cell);
  });
  if (exactRepeat) return true;

  // Kiểm tra dòng tiêu đề phụ (ví dụ: [null, ..., "Số", "Chữ", ...] trong mẫu DSTS)
  const mssvIdx = mapping?.mssv ?? null;
  const nameIdx = mapping?.name ?? null;
  if (mssvIdx !== null && cellText(row[mssvIdx]) !== "") return false;
  if (nameIdx !== null && cellText(row[nameIdx]) !== "") return false;
  if (cellText(row[0]) !== "" && /^\d+$/.test(cellText(row[0]))) return false;

  return nonEmpty.every((entry) => {
    const normCell = normalizeText(entry.cell);
    const header = cellText(headers[entry.index]);
    if (header !== "" && normalizeText(header) === normCell) return true;
    return SUBHEADER_TOKENS.has(normCell);
  });
}

function markInternalDuplicates(rows: ParsedStudentRow[]): void {
  const byMssv = new Map<string, ParsedStudentRow[]>();
  for (const row of rows) {
    if (!row.mssv) continue;
    const key = row.mssv.toLowerCase();
    const list = byMssv.get(key) ?? [];
    list.push(row);
    byMssv.set(key, list);
  }

  for (const list of byMssv.values()) {
    if (list.length < 2) continue;
    for (const row of list) {
      row.errors.push(`MSSV ${row.mssv} bị trùng trong cùng sheet`);
    }
  }
}

export function inspectPendingWorkbook(
  rows: ParsedStudentRow[],
  mapping: ColumnMapping,
): WorkbookValidationSummary {
  let validRowCount = 0;
  let errorRowCount = 0;
  let warningRowCount = 0;

  let emptyCount = 0;
  let duplicateCount = 0;
  let placeholderCount = 0;
  let formatIssueCount = 0;

  let missingGroupCount = 0;
  let assignedStudentCount = 0;
  const groupsMap = new Map<string, ParsedStudentRow[]>();
  const hasGroupData =
    mapping.groupCode !== null || rows.some((r) => Boolean(r.groupCode));

  for (const row of rows) {
    if (row.errors.length > 0) errorRowCount += 1;
    else if (row.warnings.length > 0) warningRowCount += 1;
    else validRowCount += 1;

    for (const error of row.errors) {
      if (error.includes("MSSV trống")) emptyCount += 1;
      else if (error.includes("bị trùng")) duplicateCount += 1;
      else if (error.includes("giá trị giữ chỗ")) placeholderCount += 1;
    }
    for (const warning of row.warnings) {
      if (
        warning.includes("khoảng trắng ở giữa") ||
        warning.includes("ký tự đặc biệt") ||
        warning.includes("nhầm cột STT")
      ) {
        formatIssueCount += 1;
      }
    }

    if (hasGroupData) {
      if (!row.groupCode) {
        missingGroupCount += 1;
      } else {
        assignedStudentCount += 1;
        const key = row.groupCode.toLowerCase();
        const list = groupsMap.get(key) ?? [];
        list.push(row);
        groupsMap.set(key, list);
      }
    }
  }

  const singleStudentGroups: string[] = [];
  const largeGroups: string[] = [];

  for (const groupRows of groupsMap.values()) {
    const code = groupRows[0].groupCode;
    if (groupRows.length === 1) {
      singleStudentGroups.push(code);
    } else if (groupRows.length > 4) {
      largeGroups.push(`${code} (${groupRows.length} SV)`);
    }
  }

  const criticalNotes: string[] = [];
  if (!hasGroupData) {
    criticalNotes.push(
      "Chưa ánh xạ cột Nhóm: Toàn bộ sinh viên chưa có nhóm để phân công giảng viên chấm.",
    );
  } else if (missingGroupCount > 0) {
    criticalNotes.push(
      `Có ${missingGroupCount} sinh viên bị thiếu mã nhóm trong file. Những sinh viên này có nguy cơ bị bỏ sót khi phân công chấm!`,
    );
  }

  if (singleStudentGroups.length > 0) {
    criticalNotes.push(
      `Có ${singleStudentGroups.length} nhóm chỉ có 1 sinh viên (${singleStudentGroups.slice(0, 3).join(", ")}${singleStudentGroups.length > 3 ? "..." : ""}). Hãy kiểm tra xem có sót sinh viên không.`,
    );
  }

  if (largeGroups.length > 0) {
    criticalNotes.push(
      `Có ${largeGroups.length} nhóm sĩ số lớn > 4 sinh viên (${largeGroups.slice(0, 3).join(", ")}${largeGroups.length > 3 ? "..." : ""}).`,
    );
  }

  if (formatIssueCount > 0) {
    criticalNotes.push(
      `Có ${formatIssueCount} dòng có định dạng MSSV bất thường (khoảng trắng thừa, ký tự lạ, quá ngắn).`,
    );
  }

  if (emptyCount > 0 || duplicateCount > 0 || placeholderCount > 0) {
    criticalNotes.push(
      `Có ${emptyCount + duplicateCount + placeholderCount} lỗi MSSV nghiêm trọng chặn nhập.`,
    );
  }

  const hasRiskOfMisassignment =
    !hasGroupData ||
    missingGroupCount > 0 ||
    singleStudentGroups.length > 0 ||
    formatIssueCount > 0 ||
    largeGroups.length > 0;

  return {
    totalRows: rows.length,
    validRowCount,
    errorRowCount,
    warningRowCount,
    mssvIssues: {
      emptyCount,
      duplicateCount,
      placeholderCount,
      formatIssueCount,
    },
    groupInspection: {
      hasGroupColumn: hasGroupData,
      groupCount: groupsMap.size,
      assignedStudentCount,
      missingGroupCount,
      singleStudentGroups,
      largeGroups,
    },
    hasRiskOfMisassignment,
    criticalNotes,
  };
}

export function parseRowsWithMapping(
  matrix: unknown[][],
  headerRow: number,
  mapping: ColumnMapping,
  metaCourseCode: string | null,
  metaCourseName: string | null,
): {
  rows: ParsedStudentRow[];
  errors: string[];
  warnings: string[];
  validation: WorkbookValidationSummary;
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  const rows: ParsedStudentRow[] = [];
  const headers = (matrix[headerRow] ?? []).map((cell) => cellText(cell));
  const width = Math.max(maxRowWidth(matrix), headers.length);

  if (mapping.mssv === null) {
    errors.push("Chưa ánh xạ cột bắt buộc MSSV.");
  }

  if (mapping.mssv !== null && mapping.mssv >= width) {
    errors.push("Cột MSSV đã chọn nằm ngoài phạm vi dữ liệu của sheet.");
  }

  let skippedBlank = 0;
  let skippedRepeatedHeaders = 0;

  for (let rowIndex = headerRow + 1; rowIndex < matrix.length; rowIndex += 1) {
    const rawRow = matrix[rowIndex] ?? [];
    if (isBlankRow(rawRow)) {
      skippedBlank += 1;
      continue;
    }
    if (isRepeatedHeader(rawRow, headers, mapping)) {
      skippedRepeatedHeaders += 1;
      continue;
    }

    const row = normalizeRow(rawRow, width);
    const rawMssv = mapping.mssv !== null ? cellText(row[mapping.mssv]) : "";
    const mssv = rawMssv.trim();
    const rawName = mapping.name !== null ? cellText(row[mapping.name]) : "";
    const name = rawName.trim();
    const rawClassName =
      mapping.className !== null ? cellText(row[mapping.className]) : "";
    const className = rawClassName.trim();
    const rawGroupCode =
      mapping.groupCode !== null ? cellText(row[mapping.groupCode]) : "";
    const groupCode = rawGroupCode.trim();
    const rawAdvisor =
      mapping.advisor !== null && mapping.advisor !== undefined
        ? cellText(row[mapping.advisor])
        : "";
    const advisorName = rawAdvisor.trim();
    const courseCode =
      ((mapping.courseCode !== null ? cellText(row[mapping.courseCode]) : "") ||
      metaCourseCode ||
      "").trim();
    const courseName =
      ((mapping.courseName !== null ? cellText(row[mapping.courseName]) : "") ||
      metaCourseName ||
      "").trim();

    const rowErrors: string[] = [];
    const rowWarnings: string[] = [];

    // 1. Kiểm tra MSSV
    if (!mssv) {
      rowErrors.push("MSSV trống");
    } else {
      const normMssv = normalizeText(mssv);
      const PLACEHOLDERS = [
        "null",
        "none",
        "na",
        "n/a",
        "chua co",
        "khong co",
        "undefined",
        "trong",
        "chua xac dinh",
      ];
      if (PLACEHOLDERS.includes(normMssv)) {
        rowErrors.push(`MSSV không hợp lệ (giá trị giữ chỗ: "${mssv}")`);
      } else if (/\s/.test(mssv)) {
        rowWarnings.push(`MSSV chứa khoảng trắng ở giữa ("${mssv}")`);
      } else if (mssv.length < 4 && /^\d+$/.test(mssv)) {
        rowWarnings.push(
          `MSSV bất thường: chỉ có ${mssv.length} chữ số ("${mssv}"), có thể nhầm cột STT`,
        );
      } else if (/[^a-zA-Z0-9_\-\.\/]/.test(mssv)) {
        rowWarnings.push(`MSSV chứa ký tự đặc biệt ("${mssv}")`);
      }
    }

    // 2. Kiểm tra Họ tên
    if (!name) {
      rowWarnings.push("Thiếu họ tên");
    } else if (/\d{4,}/.test(name)) {
      rowWarnings.push("Họ tên chứa dãy số, có thể nhầm cột MSSV");
    }

    // 3. Kiểm tra Lớp
    if (!className) {
      rowWarnings.push("Thiếu lớp");
    }

    // 4. Kiểm tra Học phần
    if (!courseCode && !courseName) {
      rowWarnings.push("Thiếu học phần");
    }

    // 5. Kiểm tra thông tin Nhóm
    if (mapping.groupCode !== null && !groupCode) {
      rowWarnings.push("Thiếu thông tin nhóm (chưa có mã nhóm)");
    }

    rows.push({
      sourceRowNumber: rowIndex + 1,
      mssv,
      name,
      className,
      courseCode,
      courseName,
      groupCode,
      advisorName: advisorName || undefined,
      originalRowData: row,
      errors: rowErrors,
      warnings: rowWarnings,
    });
  }

  markInternalDuplicates(rows);

  const validation = inspectPendingWorkbook(rows, mapping);

  if (skippedBlank > 0) {
    warnings.push(`Đã bỏ qua ${skippedBlank} dòng trống.`);
  }
  if (skippedRepeatedHeaders > 0) {
    warnings.push(
      `Đã bỏ qua ${skippedRepeatedHeaders} dòng lặp lại tiêu đề (không phải dữ liệu sinh viên).`,
    );
  }
  if (rows.length === 0) {
    warnings.push("Sheet không có dòng dữ liệu sinh viên nào.");
  }

  if (mapping.groupCode === null) {
    warnings.push(
      "Chưa ánh xạ cột Nhóm. Toàn bộ sinh viên sẽ cần được phân nhóm thủ công sau khi nhập.",
    );
  } else {
    if (validation.groupInspection.missingGroupCount > 0) {
      warnings.push(
        `Có ${validation.groupInspection.missingGroupCount}/${rows.length} sinh viên thiếu mã nhóm.`,
      );
    }
    if (validation.groupInspection.singleStudentGroups.length > 0) {
      warnings.push(
        `Có ${validation.groupInspection.singleStudentGroups.length} nhóm chỉ có 1 sinh viên: ${validation.groupInspection.singleStudentGroups.slice(0, 5).join(", ")}${validation.groupInspection.singleStudentGroups.length > 5 ? "..." : ""}`,
      );
    }
  }

  return { rows, errors, warnings, validation };
}

export interface AnalyzeOptions {
  fileName: string;
  fileSize: number;
  base64: string;
  sheetName?: string;
  headerRow?: number;
  mapping?: ColumnMapping;
  tempId?: string;
  metaLecturerName?: string | null;
  metaLecturerNames?: string[];
}

export interface AnalyzeResult {
  pending: PendingWorkbook;
  matrix: unknown[][];
  workbook: XLSX.WorkBook;
}

/**
 * Đọc file Excel từ base64, chọn sheet, tự dò tiêu đề và ánh xạ cột.
 * Không ghi dữ liệu gì vào kho; đây là bước xem trước.
 */
export function analyzeWorkbook(options: AnalyzeOptions): AnalyzeResult {
  const buffer = base64ToArrayBuffer(options.base64);
  const workbook = XLSX.read(new Uint8Array(buffer), {
    type: "array",
    cellDates: false,
  });
  const sheetNames = workbook.SheetNames;
  if (sheetNames.length === 0) {
    throw new Error(`File "${options.fileName}" không có sheet nào.`);
  }
  let sheetName =
    options.sheetName && sheetNames.includes(options.sheetName)
      ? options.sheetName
      : sheetNames[0];
  if (!options.sheetName && sheetNames.length > 1) {
    for (const candidate of sheetNames) {
      const candidateMatrix = sheetToMatrix(workbook, candidate);
      if (detectHeader(candidateMatrix).mapping.mssv !== null) {
        sheetName = candidate;
        break;
      }
    }
  }
  const matrix = sheetToMatrix(workbook, sheetName);
  const detected = detectHeader(matrix);
  const headerRow = options.headerRow ?? detected.headerRow;
  const rawHeaders = (matrix[headerRow] ?? []).map((cell) => cellText(cell));
  const mapping =
    options.mapping ??
    (options.headerRow === undefined
      ? detected.mapping
      : detectMapping(rawHeaders));
  const headers =
    options.headerRow === undefined
      ? detected.headers
      : buildEffectiveHeaders(matrix, headerRow, rawHeaders, mapping);

  const metaCourseCode =
    mapping.courseCode === null ? detected.metaCourseCode : detected.metaCourseCode;
  const metaCourseName =
    mapping.courseName === null ? detected.metaCourseName : detected.metaCourseName;
  const metaLecturerName =
    options.metaLecturerName !== undefined
      ? options.metaLecturerName
      : detected.metaLecturerName;
  const metaLecturerNames =
    options.metaLecturerNames !== undefined
      ? options.metaLecturerNames
      : (detected.metaLecturerNames ??
        (metaLecturerName ? splitLecturerNames(metaLecturerName) : []));
  const sourceTemplate = detected.sourceTemplate;

  const parsed = parseRowsWithMapping(
    matrix,
    headerRow,
    mapping,
    metaCourseCode,
    metaCourseName,
  );

  const pending: PendingWorkbook = {
    tempId: options.tempId ?? createId("pending"),
    fileName: options.fileName,
    fileSize: options.fileSize,
    originalBase64: options.base64,
    sheetNames,
    sheetName,
    headerRow,
    dataStartRow: headerRow + 1,
    headers,
    mapping,
    rows: parsed.rows,
    metaCourseCode,
    metaCourseName,
    metaLecturerName,
    metaLecturerNames,
    sourceTemplate,
    errors: parsed.errors,
    warnings: parsed.warnings,
    validation: parsed.validation,
  };

  return { pending, matrix, workbook };
}

export async function analyzeFile(file: File): Promise<PendingWorkbook> {
  const buffer = await file.arrayBuffer();
  return analyzeWorkbook({
    fileName: file.name,
    fileSize: file.size,
    base64: arrayBufferToBase64(buffer),
  }).pending;
}

/** Kiểm tra MSSV trùng giữa các file đang chờ và dữ liệu đã có trong đợt. */
export function findCrossFileDuplicateIssues(
  pendingWorkbooks: PendingWorkbook[],
  existingStudents: Student[],
): string[] {
  const existing = new Map<string, string>();
  for (const student of existingStudents) {
    existing.set(student.mssv.toLowerCase(), "dữ liệu đã nhập trong đợt");
  }

  const seen = new Map<string, string>();
  const issues = new Set<string>();

  for (const workbook of pendingWorkbooks) {
    for (const row of workbook.rows) {
      if (!row.mssv) continue;
      const key = row.mssv.toLowerCase();
      if (existing.has(key)) {
        issues.add(
          `MSSV ${row.mssv} (${workbook.fileName}, dòng ${row.sourceRowNumber}) đã tồn tại trong đợt.`,
        );
      }
      const previous = seen.get(key);
      if (previous) {
        issues.add(
          `MSSV ${row.mssv} xuất hiện ở cả ${previous} và ${workbook.fileName} (dòng ${row.sourceRowNumber}).`,
        );
      } else {
        seen.set(key, workbook.fileName);
      }
    }
  }

  return [...issues];
}

/**
 * Gộp thông tin và loại bỏ các dòng/file trùng MSSV khi người dùng nạp chung cả 2 mẫu
 * (ví dụ: vừa có file Bảng điểm thành phần vừa có file DSTS của cùng lớp học phần).
 */
export function mergeDuplicatePendingWorkbooks(
  pendingWorkbooks: PendingWorkbook[],
  existingStudents: Student[] = [],
): {
  workbooks: PendingWorkbook[];
  mergedStudentCount: number;
  removedFileNames: string[];
} {
  const existingKeys = new Set(
    existingStudents.map((student) => student.mssv.toLowerCase()),
  );
  const cloned: PendingWorkbook[] = pendingWorkbooks.map((wb) => ({
    ...wb,
    rows: wb.rows.map((r) => ({
      ...r,
      errors: [...r.errors],
      warnings: [...r.warnings],
    })),
    warnings: [...wb.warnings],
  }));

  const primaryByMssv = new Map<
    string,
    { workbook: PendingWorkbook; row: ParsedStudentRow }
  >();
  let mergedStudentCount = 0;

  for (const workbook of cloned) {
    const keptRows: ParsedStudentRow[] = [];
    for (const row of workbook.rows) {
      if (!row.mssv) {
        keptRows.push(row);
        continue;
      }
      const key = row.mssv.toLowerCase();
      if (existingKeys.has(key)) {
        mergedStudentCount += 1;
        continue;
      }
      const existingPrimary = primaryByMssv.get(key);
      if (!existingPrimary) {
        primaryByMssv.set(key, { workbook, row });
        keptRows.push(row);
      } else {
        mergedStudentCount += 1;
        const targetRow = existingPrimary.row;
        const targetWb = existingPrimary.workbook;
        if (!targetRow.groupCode && row.groupCode) {
          targetRow.groupCode = row.groupCode;
          targetRow.warnings = targetRow.warnings.filter(
            (w) => !w.includes("Thiếu thông tin nhóm"),
          );
        }
        if (!targetRow.name && row.name) targetRow.name = row.name;
        if (!targetRow.className && row.className) targetRow.className = row.className;
        if (!targetRow.courseCode && row.courseCode) targetRow.courseCode = row.courseCode;
        if (!targetRow.courseName && row.courseName) targetRow.courseName = row.courseName;

        if (!targetWb.metaCourseCode && workbook.metaCourseCode) {
          targetWb.metaCourseCode = workbook.metaCourseCode;
        }
        if (!targetWb.metaCourseName && workbook.metaCourseName) {
          targetWb.metaCourseName = workbook.metaCourseName;
        }
        if (!targetWb.metaLecturerName && workbook.metaLecturerName) {
          targetWb.metaLecturerName = workbook.metaLecturerName;
        }
      }
    }
    workbook.rows = keptRows;
  }

  const removedFileNames: string[] = [];
  const workbooks: PendingWorkbook[] = [];

  for (const workbook of cloned) {
    if (workbook.rows.length === 0) {
      removedFileNames.push(workbook.fileName);
      continue;
    }
    workbook.validation = inspectPendingWorkbook(workbook.rows, workbook.mapping);
    workbooks.push(workbook);
  }

  return { workbooks, mergedStudentCount, removedFileNames };
}

export function pendingHasBlockingErrors(workbook: PendingWorkbook): boolean {
  return (
    workbook.errors.length > 0 ||
    workbook.rows.some((row) => row.errors.length > 0)
  );
}

export function countPendingRows(workbooks: PendingWorkbook[]): number {
  return workbooks.reduce((total, workbook) => total + workbook.rows.length, 0);
}
