import * as XLSX from "xlsx";
import type { ExamBatch } from "../types";
import { arrayBufferToBase64 } from "../utils/base64";
import { analyzeWorkbook } from "../excel/importWorkbook";
import { normalizeText } from "../utils/text";

export interface TestStudentInput {
  mssv: string;
  name: string;
  className: string;
  groupCode?: string;
  score?: string | number;
}

export function makeSourceWorkbook(
  title: string,
  courseCode: string,
  courseName: string,
  students: TestStudentInput[],
): { buffer: ArrayBuffer; fileName: string } {
  const rows: unknown[][] = [
    [title],
    ["Mã lớp học phần", courseCode, "Tên lớp học phần", courseName],
    ["STT", "MSSV", "Họ tên", "Lớp sinh hoạt", "Nhóm", "CK"],
    ["STT", "MSSV", "Họ tên", "Lớp sinh hoạt", "Nhóm", "CK"],
    ...students.map((student, index) => [
      index + 1,
      student.mssv,
      student.name,
      student.className,
      student.groupCode ?? "",
      student.score ?? "",
    ]),
  ];
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, "Bảng điểm thành phần");
  const buffer = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return { buffer, fileName: `${courseCode}_${title.includes("A") ? "A" : "B"}.xlsx` };
}

export function pendingFrom(
  file: { buffer: ArrayBuffer; fileName: string },
  tempId?: string,
) {
  return analyzeWorkbook({
    fileName: file.fileName,
    fileSize: file.buffer.byteLength,
    base64: arrayBufferToBase64(file.buffer),
    tempId,
  }).pending;
}

export function makeTestBatch(name = "Đợt kiểm thử"): ExamBatch {
  return {
    id: `batch_test_${Math.random().toString(36).slice(2, 9)}`,
    name,
    term: "HK1 2026–2027",
    examDate: "2026-11-04",
    note: "test",
    scoreConfig: { min: 0, max: 10, decimals: 1, isDemoDefault: false },
    status: "active",
    isDemo: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export interface RewriteOptions {
  reverseRows?: boolean;
  duplicateFirst?: boolean;
  appendRows?: unknown[][];
  omitMssv?: string[];
}

export function rewriteGradedScores(
  buffer: ArrayBuffer,
  scoresByMssv: Record<string, number | string>,
  options: RewriteOptions = {},
): ArrayBuffer {
  const workbook = XLSX.read(new Uint8Array(buffer), { type: "array" });
  const sheetName = workbook.SheetNames[0];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
  });
  const headerRow = matrix.findIndex((row) =>
    row.some((cell) => normalizeText(cell) === "studentkey"),
  );
  if (headerRow < 0) throw new Error("Không tìm thấy header studentKey");
  const headers = matrix[headerRow];
  const mssvCol = headers.findIndex((cell) => normalizeText(cell) === "mssv");
  const scoreCol = headers.findIndex((cell) => normalizeText(cell) === "diem");

  let dataRows = matrix
    .slice(headerRow + 1)
    .filter((row) => row.some((cell) => cell !== null && String(cell).trim() !== ""))
    .map((row) => [...row]);

  if (options.omitMssv && options.omitMssv.length > 0) {
    dataRows = dataRows.filter(
      (row) => !options.omitMssv?.includes(String(row[mssvCol] ?? "")),
    );
  }

  for (const row of dataRows) {
    const mssv = String(row[mssvCol] ?? "");
    if (mssv in scoresByMssv) row[scoreCol] = scoresByMssv[mssv];
  }

  if (options.duplicateFirst && dataRows.length > 0) {
    dataRows = [...dataRows, [...dataRows[0]]];
  }
  if (options.reverseRows) dataRows.reverse();
  if (options.appendRows) dataRows = [...dataRows, ...options.appendRows];

  const outRows = [...matrix.slice(0, headerRow + 1), ...dataRows];
  const newSheet = XLSX.utils.aoa_to_sheet(outRows);
  const outWorkbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(outWorkbook, newSheet, sheetName);
  return XLSX.write(outWorkbook, {
    type: "array",
    bookType: "xlsx",
  }) as ArrayBuffer;
}

export function readWorkbook(buffer: ArrayBuffer): XLSX.WorkBook {
  return XLSX.read(new Uint8Array(buffer), { type: "array", cellStyles: true });
}

export function sheetMatrix(
  workbook: XLSX.WorkBook,
  sheetName?: string,
): unknown[][] {
  const name = sheetName ?? workbook.SheetNames[0];
  return XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
  });
}
