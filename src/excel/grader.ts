import * as XLSX from "xlsx";
import type {
  ExamBatch,
  GradedFileParse,
  GradedRow,
  GroupMember,
  Lecturer,
  PblGroup,
  Score,
  SourceWorkbook,
  Student,
} from "../types";
import { getStudentAdvisorDisplayName } from "../domain/advisor";
import { parseScoreValue } from "../utils/score";
import { cellText, isBlankRow, normalizeText } from "../utils/text";

export interface GraderExportFile {
  grader: Lecturer;
  fileName: string;
  buffer: ArrayBuffer;
  groupCount: number;
  studentCount: number;
}

export interface GraderExportInput {
  batch: ExamBatch;
  students: Student[];
  groups: PblGroup[];
  members: GroupMember[];
  lecturers: Lecturer[];
  scores: Score[];
  graders: Lecturer[];
  sourceWorkbooks?: SourceWorkbook[];
}

const HEADERS = [
  "studentKey",
  "Mã nhóm",
  "MSSV",
  "Họ tên",
  "Lớp",
  "Mã học phần",
  "Tên học phần",
  "Giảng viên hướng dẫn",
  "Điểm",
  "Ghi chú chấm",
];

export function buildGraderWorkbook(
  input: GraderExportInput,
  grader: Lecturer,
): { workbook: XLSX.WorkBook; groupCount: number; studentCount: number } {
  const scoreByStudent = new Map(
    input.scores.map((score) => [score.studentId, score]),
  );
  const studentById = new Map(input.students.map((student) => [student.id, student]));
  const graderGroups = input.groups
    .filter((group) => group.graderId === grader.id)
    .sort((a, b) => a.groupCode.localeCompare(b.groupCode, "vi"));

  const rows: unknown[][] = [
    ["PHIẾU CHẤM ĐIỂM PBL"],
    ["Đợt thi", input.batch.name],
    ["Mã đợt (không xóa)", input.batch.id],
    ["Giảng viên chấm", grader.displayName],
    ["Mã giảng viên (không xóa)", grader.id],
    ["Phòng", grader.room?.trim() ? grader.room.trim() : "—"],
    ["Thang điểm", `${input.batch.scoreConfig.min}–${input.batch.scoreConfig.max}, tối đa ${input.batch.scoreConfig.decimals} chữ số thập phân`],
    [
      "Hướng dẫn",
      "Chỉ nhập điểm vào cột Điểm (cột I). Cột G (Tên HP) và H (GVHD) được ẩn để thuận tiện nhập điểm (Unhide nếu cần xem). Không sửa hoặc xóa cột studentKey (cột A ẩn) và các dòng mã phía trên. Lưu file .xlsx và gửi lại cho điều phối viên.",
    ],
    [],
    HEADERS,
  ];

  let studentCount = 0;
  for (const group of graderGroups) {
    const groupMembers = input.members
      .filter((member) => member.groupId === group.id)
      .map((member) => ({
        member,
        student: studentById.get(member.studentId),
      }))
      .filter(
        (entry): entry is { member: GroupMember; student: Student } =>
          Boolean(entry.student),
      )
      .sort((a, b) => a.student.mssv.localeCompare(b.student.mssv, "vi"));

    for (const { member, student } of groupMembers) {
      const advisorDisplay = getStudentAdvisorDisplayName(
        member,
        student,
        group,
        input.lecturers,
        input.sourceWorkbooks,
      );
      const score = scoreByStudent.get(student.id);
      rows.push([
        student.id,
        group.groupCode,
        student.mssv,
        student.name,
        student.className,
        student.courseCode,
        student.courseName,
        advisorDisplay,
        score ? score.value : "",
        "",
      ]);
      studentCount += 1;
    }
  }

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = [
    { wch: 38, hidden: true },
    { wch: 14 },
    { wch: 14 },
    { wch: 26 },
    { wch: 12 },
    { wch: 18 },
    { wch: 32, hidden: true },
    { wch: 28, hidden: true },
    { wch: 10 },
    { wch: 30 },
  ];
  const headerRowIdx = rows.indexOf(HEADERS);
  const headerExcelRow = headerRowIdx >= 0 ? headerRowIdx + 1 : 10;
  const dataStartExcelRow = headerExcelRow + 1;
  sheet["!autofilter"] = {
    ref: `A${headerExcelRow}:J${Math.max(rows.length, headerExcelRow)}`,
  };
  sheet["!freeze"] = `A${dataStartExcelRow}`;

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Phieu_cham_diem");
  return { workbook, groupCount: graderGroups.length, studentCount };
}

export function exportGraderWorkbooks(input: GraderExportInput): GraderExportFile[] {
  return input.graders.map((grader) => {
    const { workbook, groupCount, studentCount } = buildGraderWorkbook(
      input,
      grader,
    );
    const buffer = XLSX.write(workbook, {
      type: "array",
      bookType: "xlsx",
    }) as ArrayBuffer;
    return {
      grader,
      fileName: `Phieu_cham_${safeFileName(grader.displayName)}.xlsx`,
      buffer,
      groupCount,
      studentCount,
    };
  });
}

export function safeFileName(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D")
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "") || "khong_ten"
  );
}

interface GradedHeaderInfo {
  headerRow: number;
  keyCol: number | null;
  mssvCol: number | null;
  scoreCol: number | null;
  graderNameCol: number | null;
}

const GRADED_SUBHEADER_TOKENS = new Set([
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

export function findGradedHeader(matrix: unknown[][]): GradedHeaderInfo | null {
  const limit = Math.min(matrix.length, 30);
  let fallbackMssvHeader: GradedHeaderInfo | null = null;

  for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
    const row = matrix[rowIndex] ?? [];
    let keyCol: number | null = null;
    let mssvCol: number | null = null;
    let scoreCol: number | null = null;
    let graderNameCol: number | null = null;

    row.forEach((cell, colIndex) => {
      const text = normalizeText(cell);
      if (
        keyCol === null &&
        (text.includes("studentkey") ||
          text.includes("ma dinh danh") ||
          text.includes("khoa sinh vien"))
      ) {
        keyCol = colIndex;
      } else if (
        mssvCol === null &&
        (text.includes("mssv") ||
          text.includes("ma so sinh vien") ||
          text.includes("ma sinh vien") ||
          text === "ma sv" ||
          text === "so the" ||
          text.includes("so the sv") ||
          text.includes("so the sinh vien"))
      ) {
        mssvCol = colIndex;
      } else if (
        scoreCol === null &&
        !text.includes("chu") &&
        (text === "diem" ||
          text === "ck" ||
          text === "diem ck" ||
          text === "diem so" ||
          text.startsWith("diem "))
      ) {
        scoreCol = colIndex;
      } else if (
        graderNameCol === null &&
        (text === "giang vien cham" || text === "ten giang vien cham")
      ) {
        graderNameCol = colIndex;
      }
    });

    if (keyCol !== null && scoreCol !== null) {
      return { headerRow: rowIndex, keyCol, mssvCol, scoreCol, graderNameCol };
    }
    if (!fallbackMssvHeader && mssvCol !== null && scoreCol !== null) {
      fallbackMssvHeader = {
        headerRow: rowIndex,
        keyCol: null,
        mssvCol,
        scoreCol,
        graderNameCol,
      };
    }
  }
  return fallbackMssvHeader;
}

function metadataValue(
  matrix: unknown[][],
  headerRow: number,
  labels: string[],
): string | null {
  for (let rowIndex = 0; rowIndex < headerRow; rowIndex += 1) {
    const row = matrix[rowIndex] ?? [];
    for (let colIndex = 0; colIndex < row.length; colIndex += 1) {
      const rawText = cellText(row[colIndex]);
      const label = normalizeText(rawText);
      const cleanLabel = label.replace(/:+$/, "").trim();
      for (const candidate of labels) {
        if (cleanLabel === candidate) {
          if (rawText.includes(":")) {
            const inline = rawText.split(":").slice(1).join(":").trim();
            if (inline) return inline;
          }
          for (let next = colIndex + 1; next < row.length; next += 1) {
            const value = cellText(row[next]);
            if (value) return value;
          }
        } else if (label.startsWith(candidate + ":") || label.startsWith(candidate + " :")) {
          const parts = rawText.split(":");
          if (parts.length > 1) {
            const val = parts.slice(1).join(":").trim();
            if (val) return val;
          }
          for (let next = colIndex + 1; next < row.length; next += 1) {
            const value = cellText(row[next]);
            if (value) return value;
          }
        }
      }
    }
  }
  return null;
}

export function parseGradedWorkbook(
  buffer: ArrayBuffer,
  fileName: string,
  batch: ExamBatch,
): GradedFileParse {
  const errors: string[] = [];
  const warnings: string[] = [];
  const workbook = XLSX.read(new Uint8Array(buffer), {
    type: "array",
    cellDates: false,
  });

  let matrix: unknown[][] = [];
  let header: GradedHeaderInfo | null = null;

  for (const candidateSheet of workbook.SheetNames) {
    const candidateMatrix = XLSX.utils.sheet_to_json<unknown[]>(
      workbook.Sheets[candidateSheet],
      { header: 1, raw: true, defval: null, blankrows: true },
    );
    const candidateHeader = findGradedHeader(candidateMatrix);
    if (candidateHeader) {
      matrix = candidateMatrix;
      header = candidateHeader;
      break;
    }
  }

  if (!header) {
    return {
      fileName,
      batchIdFromFile: null,
      graderIdFromFile: null,
      graderNameFromFile: null,
      roomFromFile: null,
      rows: [],
      errors: [
        "Không tìm thấy tiêu đề phiếu chấm hợp lệ (cần cột studentKey/MSSV/Số thẻ và Điểm/CK).",
      ],
      warnings,
    };
  }

  const batchIdFromFile = metadataValue(matrix, header.headerRow, [
    "ma dot (khong xoa)",
    "ma dot",
  ]);
  const graderIdFromFile = metadataValue(matrix, header.headerRow, [
    "ma giang vien (khong xoa)",
    "ma giang vien",
  ]);
  const graderNameFromFile = metadataValue(matrix, header.headerRow, [
    "giang vien cham",
    "giang vien",
    "gvhd",
  ]);
  const roomFromFileRaw = metadataValue(matrix, header.headerRow, [
    "phong",
    "phong cham",
    "phong bao cao",
    "dia diem",
  ]);
  const roomFromFile =
    roomFromFileRaw && roomFromFileRaw !== "—" && roomFromFileRaw !== "-"
      ? roomFromFileRaw
      : null;

  if (batchIdFromFile && batchIdFromFile !== batch.id) {
    errors.push(
      `File "${fileName}" thuộc đợt khác (${batchIdFromFile}), không khớp đợt đang chọn.`,
    );
  }
  if (!batchIdFromFile) {
    warnings.push(
      `File "${fileName}" không có mã đợt; chỉ ghép theo studentKey/MSSV trong đợt đang chọn.`,
    );
  }

  const headers = (matrix[header.headerRow] ?? []).map((cell) => cellText(cell));
  const rows: GradedRow[] = [];
  const seenKeys = new Map<string, GradedRow[]>();

  for (let rowIndex = header.headerRow + 1; rowIndex < matrix.length; rowIndex += 1) {
    const rawRow = matrix[rowIndex] ?? [];
    if (isBlankRow(rawRow)) continue;

    const nonEmpty = rawRow
      .map((cell, index) => ({ cell: cellText(cell), index }))
      .filter((entry) => entry.cell !== "");
    const repeatedHeader =
      nonEmpty.length > 0 &&
      nonEmpty.every((entry) => {
        const headerText = cellText(headers[entry.index]);
        return (
          headerText !== "" &&
          normalizeText(headerText) === normalizeText(entry.cell)
        );
      });
    if (repeatedHeader) continue;

    const studentKey =
      header.keyCol !== null ? cellText(rawRow[header.keyCol]) : "";
    const mssv = header.mssvCol !== null ? cellText(rawRow[header.mssvCol]) : "";
    const isSubHeader =
      !studentKey &&
      !mssv &&
      nonEmpty.length > 0 &&
      nonEmpty.every((entry) => {
        const norm = normalizeText(entry.cell);
        const headerText = cellText(headers[entry.index]);
        if (headerText !== "" && normalizeText(headerText) === norm) return true;
        return GRADED_SUBHEADER_TOKENS.has(norm);
      });
    if (isSubHeader) continue;
    const rawScore =
      header.scoreCol !== null ? cellText(rawRow[header.scoreCol]) : "";
    const rowErrors: string[] = [];
    const rowWarnings: string[] = [];

    const parsed = parseScoreValue(rawScore, batch.scoreConfig);
    if (parsed.error) rowErrors.push(parsed.error);
    if (!studentKey && !mssv) {
      rowErrors.push("Dòng không xác định được sinh viên (thiếu studentKey và MSSV)");
    } else if (!studentKey) {
      rowWarnings.push("Thiếu studentKey, sẽ thử ghép theo MSSV nếu duy nhất.");
    }

    const row: GradedRow = {
      rowNumber: rowIndex + 1,
      studentKey,
      mssv,
      rawScore,
      value: parsed.value,
      graderName: graderNameFromFile ?? "",
      errors: rowErrors,
      warnings: rowWarnings,
    };
    rows.push(row);

    if (studentKey) {
      const key = studentKey.toLowerCase();
      const list = seenKeys.get(key) ?? [];
      list.push(row);
      seenKeys.set(key, list);
    }
  }

  for (const list of seenKeys.values()) {
    if (list.length < 2) continue;
    for (const row of list) {
      row.errors.push(`studentKey ${row.studentKey} bị trùng trong file`);
    }
  }

  if (rows.length === 0) {
    warnings.push(`File "${fileName}" không có dòng điểm nào.`);
  }

  return {
    fileName,
    batchIdFromFile,
    graderIdFromFile,
    graderNameFromFile,
    roomFromFile,
    rows,
    errors,
    warnings,
  };
}
