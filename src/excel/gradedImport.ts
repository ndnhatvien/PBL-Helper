import type {
  ExamBatch,
  GradedFileParse,
  GroupMember,
  GroupView,
  Lecturer,
  PblGroup,
  Score,
  ScoreImportCandidate,
  GradedImportPreview,
  Student,
} from "../types";
import { getEffectiveAdvisorId } from "../domain/advisor";
import { cellText } from "../utils/text";

interface PreviewInput {
  files: GradedFileParse[];
  batch: ExamBatch;
  students: Student[];
  groups: PblGroup[];
  members: GroupMember[];
  scores: Score[];
  lecturers: Lecturer[];
  batchGroupViews?: GroupView[];
}

function uniqueMssvMap(students: Student[]): Map<string, Student | null> {
  const map = new Map<string, Student | null>();
  for (const student of students) {
    const key = student.mssv.toLowerCase();
    if (map.has(key)) map.set(key, null);
    else map.set(key, student);
  }
  return map;
}

export function buildGradedImportPreview(input: PreviewInput): GradedImportPreview {
  const studentsById = new Map(input.students.map((student) => [student.id, student]));
  const mssvMap = uniqueMssvMap(input.students);
  const scoreByStudent = new Map(input.scores.map((score) => [score.studentId, score]));
  const lecturerById = new Map(
    input.lecturers.map((lecturer) => [lecturer.id, lecturer]),
  );
  const lecturerByName = new Map<string, Lecturer | null>();
  for (const lecturer of input.lecturers) {
    const key = lecturer.displayName.trim().toLowerCase();
    if (lecturerByName.has(key)) lecturerByName.set(key, null);
    else lecturerByName.set(key, lecturer);
  }

  const groupById = new Map(input.groups.map((group) => [group.id, group]));
  const memberByStudent = new Map(
    input.members.map((member) => [member.studentId, member]),
  );

  const errors: string[] = [];
  const candidates: ScoreImportCandidate[] = [];

  for (const file of input.files) {
    errors.push(...file.errors);

    let fileGrader = file.graderIdFromFile
      ? lecturerById.get(file.graderIdFromFile) ?? null
      : null;
    if (file.graderIdFromFile && !fileGrader) {
      errors.push(
        `File "${file.fileName}" ghi mã giảng viên ${file.graderIdFromFile} không có trong đợt.`,
      );
    }
    if (!fileGrader && file.graderNameFromFile) {
      fileGrader =
        lecturerByName.get(file.graderNameFromFile.trim().toLowerCase()) ?? null;
      if (!fileGrader) {
        errors.push(
          `File "${file.fileName}" ghi giảng viên "${file.graderNameFromFile}" không có trong đợt.`,
        );
      }
    }

    for (const row of file.rows) {
      const messages = [...row.errors, ...row.warnings];
      let student: Student | undefined;

      if (row.studentKey) {
        student = studentsById.get(row.studentKey);
      }
      if (!student && row.mssv) {
        const byMssv = mssvMap.get(row.mssv.toLowerCase());
        if (byMssv === null) {
          messages.push(
            `MSSV ${row.mssv} không duy nhất trong đợt, không thể dùng làm khóa dự phòng.`,
          );
        } else if (byMssv) {
          student = byMssv;
          messages.push(
            `Không khớp studentKey; đã ghép dự phòng theo MSSV ${row.mssv}.`,
          );
        }
      }

      if (!student) {
        messages.push(
          `Không tìm thấy sinh viên trong đợt (studentKey="${row.studentKey || "—"}", MSSV="${row.mssv || "—"}").`,
        );
      }

      if (student) {
        const member = memberByStudent.get(student.id);
        const group = member ? groupById.get(member.groupId) : undefined;
        if (fileGrader && group && group.graderId !== fileGrader.id) {
          messages.push(
            `Sinh viên thuộc nhóm ${group.groupCode} được giao cho giảng viên khác, không phải ${fileGrader.displayName}.`,
          );
        }
        if (member && fileGrader) {
          const effectiveAdvisor = getEffectiveAdvisorId(
            member.advisorOverrideId,
            group?.defaultAdvisorId ?? null,
          );
          if (effectiveAdvisor && effectiveAdvisor !== fileGrader.id) {
            // GVHD khác người chấm là hợp lệ; không thêm cảnh báo.
          }
        }
      }

      const oldValue = student
        ? scoreByStudent.get(student.id)?.value ?? null
        : null;
      const hasErrors = row.errors.length > 0 || !student;

      candidates.push({
        studentId: student?.id ?? null,
        studentKey: row.studentKey,
        mssv: row.mssv || (student?.mssv ?? ""),
        studentName: student?.name ?? "—",
        oldValue,
        newValue: row.value,
        sourceFileName: file.fileName,
        rowNumber: row.rowNumber,
        graderName: fileGrader?.displayName ?? file.graderNameFromFile ?? "",
        graderId: fileGrader?.id ?? null,
        status: hasErrors ? "error" : row.value === oldValue ? "unchanged" : "valid",
        messages,
      });
    }
  }

  // Xử lý nhiều file cùng cập nhật một sinh viên.
  const byStudent = new Map<string, ScoreImportCandidate[]>();
  for (const candidate of candidates) {
    if (!candidate.studentId || candidate.newValue === null) continue;
    if (candidate.status === "error") continue;
    const list = byStudent.get(candidate.studentId) ?? [];
    list.push(candidate);
    byStudent.set(candidate.studentId, list);
  }

  for (const list of byStudent.values()) {
    if (list.length < 2) continue;
    const distinctValues = new Set(list.map((candidate) => candidate.newValue));
    if (distinctValues.size > 1) {
      const detail = list
        .map(
          (candidate) =>
            `${candidate.sourceFileName} (dòng ${candidate.rowNumber}): ${candidate.newValue}`,
        )
        .join("; ");
      for (const candidate of list) {
        candidate.status = "conflict";
        candidate.messages.push(
          `Xung đột điểm giữa các file — ${detail}. Không tự động ghi đè; cần xử lý lại file.`,
        );
      }
    } else {
      const [first, ...rest] = list;
      for (const duplicate of rest) {
        duplicate.status = "unchanged";
        duplicate.messages.push(
          `Trùng giá trị với ${first.sourceFileName} (dòng ${first.rowNumber}); chỉ ghi nhận một lần.`,
        );
      }
    }
  }

  // Phát hiện sinh viên thiếu trong file của từng giảng viên.
  const missingByGrader: Array<{ graderName: string; missing: string[] }> = [];
  for (const file of input.files) {
    let fileGrader = file.graderIdFromFile
      ? lecturerById.get(file.graderIdFromFile)
      : undefined;
    if (!fileGrader && file.graderNameFromFile) {
      fileGrader =
        lecturerByName.get(file.graderNameFromFile.trim().toLowerCase()) ?? undefined;
    }
    if (!fileGrader) continue;

    const expectedStudentIds = input.members
      .filter((member) => {
        const group = groupById.get(member.groupId);
        return group?.graderId === fileGrader?.id;
      })
      .map((member) => member.studentId);

    const presentIds = new Set(
      candidates
        .filter((candidate) => candidate.sourceFileName === file.fileName)
        .map((candidate) => candidate.studentId)
        .filter((id): id is string => Boolean(id)),
    );
    const missing = expectedStudentIds
      .filter((id) => !presentIds.has(id))
      .map((id) => {
        const student = studentsById.get(id);
        return student ? `${student.mssv} - ${student.name}` : id;
      });

    if (missing.length > 0) {
      missingByGrader.push({
        graderName: fileGrader.displayName,
        missing,
      });
    }
  }

  const summary = {
    valid: candidates.filter((candidate) => candidate.status === "valid").length,
    unchanged: candidates.filter((candidate) => candidate.status === "unchanged")
      .length,
    conflicts: candidates.filter((candidate) => candidate.status === "conflict")
      .length,
    errors: candidates.filter((candidate) => candidate.status === "error").length,
    missing: missingByGrader.reduce((total, item) => total + item.missing.length, 0),
  };

  return {
    files: input.files,
    candidates,
    missingByGrader,
    errors,
    summary,
  };
}

/** Kiểm tra nhanh một file đã chấm so với đợt (dùng trong test và UI). */
export function isScoreFileForBatch(
  file: GradedFileParse,
  batch: ExamBatch,
): boolean {
  return !file.batchIdFromFile || cellText(file.batchIdFromFile) === batch.id;
}
