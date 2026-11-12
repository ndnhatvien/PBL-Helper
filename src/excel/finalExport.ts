import * as XLSX from "xlsx";
import type {
  ExamBatch,
  FinalExportReport,
  SourceWorkbook,
  Score,
  ScoreConflict,
  Student,
} from "../types";
import { base64ToArrayBuffer } from "../utils/base64";
import { safeFileName } from "./grader";

export interface FinalExportInput {
  batch: ExamBatch;
  sourceWorkbooks: SourceWorkbook[];
  students: Student[];
  scores: Score[];
  conflicts: ScoreConflict[];
}

export interface FinalExportFile {
  workbookId: string;
  fileName: string;
  buffer: ArrayBuffer;
  report: FinalExportReport;
}

export interface FinalExportResult {
  files: FinalExportFile[];
  reports: FinalExportReport[];
}

export function buildFinalExports(input: FinalExportInput): FinalExportResult {
  const scoreByStudent = new Map(
    input.scores.map((score) => [score.studentId, score]),
  );
  const files: FinalExportFile[] = [];
  const reports: FinalExportReport[] = [];

  for (const source of input.sourceWorkbooks) {
    const issues: string[] = [];
    const students = input.students.filter(
      (student) => student.sourceWorkbookId === source.id,
    );
    let updatedRows = 0;
    let missingScores = 0;

    try {
      const buffer = base64ToArrayBuffer(source.originalBase64);
      const workbook = XLSX.read(new Uint8Array(buffer), {
        type: "array",
        cellDates: false,
      });
      const sheet = workbook.Sheets[source.sheetName];
      if (!sheet) {
        issues.push(`Không tìm thấy sheet "${source.sheetName}" trong file gốc.`);
      } else {
        const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1");
        let scoreCol = source.mapping.score;
        if (scoreCol === null) {
          scoreCol = range.e.c + 1;
          const headerCell = XLSX.utils.encode_cell({
            r: source.headerRow,
            c: scoreCol,
          });
          sheet[headerCell] = { t: "s", v: "Điểm" };
          range.e.c = Math.max(range.e.c, scoreCol);
          sheet["!ref"] = XLSX.utils.encode_range(range);
          issues.push(
            'File nguồn chưa có cột điểm; đã thêm cột "Điểm" ở cuối bảng.',
          );
        }

        for (const student of students) {
          const score = scoreByStudent.get(student.id);
          if (!score) {
            missingScores += 1;
            continue;
          }
          if (student.sourceRowNumber < 1) {
            issues.push(
              `Sinh viên ${student.mssv} có số dòng nguồn không hợp lệ.`,
            );
            continue;
          }

          const address = XLSX.utils.encode_cell({
            r: student.sourceRowNumber - 1,
            c: scoreCol,
          });
          const previous = sheet[address];
          sheet[address] = {
            ...(previous ?? {}),
            t: "n",
            v: score.value,
          };
          delete (sheet[address] as { w?: string }).w;
          delete (sheet[address] as { f?: string }).f;
          range.e.r = Math.max(range.e.r, student.sourceRowNumber - 1);
          updatedRows += 1;
        }

        sheet["!ref"] = XLSX.utils.encode_range(range);

        const sourceStudentIds = new Set(students.map((student) => student.id));
        const unresolved = input.conflicts.filter(
          (conflict) =>
            !conflict.resolved &&
            conflict.studentId &&
            sourceStudentIds.has(conflict.studentId),
        );
        for (const conflict of unresolved) {
          issues.push(
            `Xung đột chưa xử lý cho ${conflict.mssv} - ${conflict.studentName}: ${conflict.existingValue ?? "—"} vs ${conflict.newValue ?? "—"} (${conflict.sourceFileName}).`,
          );
        }
      }

      const outputBuffer = XLSX.write(workbook, {
        type: "array",
        bookType: "xlsx",
      }) as ArrayBuffer;
      const baseName = source.fileName.replace(/\.(xlsx|xls)$/i, "");
      const outputName = `${baseName}_da_cap_nhat.xlsx`;
      const report: FinalExportReport = {
        workbookId: source.id,
        fileName: source.fileName,
        outputName,
        updatedRows,
        missingScores,
        issues,
      };
      reports.push(report);
      files.push({
        workbookId: source.id,
        fileName: safeFileName(outputName),
        buffer: outputBuffer,
        report,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Lỗi không xác định khi xuất file.";
      const report: FinalExportReport = {
        workbookId: source.id,
        fileName: source.fileName,
        outputName: source.fileName,
        updatedRows: 0,
        missingScores: students.length,
        issues: [`Không thể tạo file đầu ra: ${message}`],
      };
      reports.push(report);
    }
  }

  return { files, reports };
}
