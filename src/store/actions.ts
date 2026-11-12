import type {
  ExamBatch,
  GradedImportPreview,
  GroupMember,
  Lecturer,
  PblGroup,
  PendingWorkbook,
  ReviewStatus,
  Score,
  ScoreConflict,
  ScoreReview,
  SourceWorkbook,
  Student,
} from "../types";
import type { AppData } from "./store";
import { getEffectiveAdvisorId } from "../domain/advisor";
import { findCrossFileDuplicateIssues } from "../excel/importWorkbook";
import { createId, nowIso } from "../utils/id";

export interface ActionResult {
  data: AppData;
  error?: string;
  warnings?: string[];
}

export function addBatch(data: AppData, batch: ExamBatch): AppData {
  return {
    ...data,
    batches: [...data.batches, batch],
    activeBatchId: batch.id,
    currentRole: "coordinator",
    currentLecturerId: null,
  };
}

export function updateBatch(data: AppData, batchId: string, patch: Partial<ExamBatch>): AppData {
  return {
    ...data,
    batches: data.batches.map((batch) =>
      batch.id === batchId
        ? { ...batch, ...patch, updatedAt: nowIso(), id: batch.id }
        : batch,
    ),
  };
}

export function setActiveBatch(data: AppData, batchId: string | null): AppData {
  return {
    ...data,
    activeBatchId: batchId,
    currentRole: "coordinator",
    currentLecturerId: null,
  };
}

export function addLecturer(
  data: AppData,
  batchId: string,
  displayName: string,
  email: string,
  room?: string,
): ActionResult {
  const name = displayName.trim();
  if (!name) return { data, error: "Tên giảng viên không được để trống." };
  const lecturer: Lecturer = {
    id: createId("lec"),
    batchId,
    displayName: name,
    email: email.trim(),
    active: true,
    room: room ? room.trim() : "",
  };
  return { data: { ...data, lecturers: [...data.lecturers, lecturer] } };
}

export function updateLecturer(
  data: AppData,
  lecturerId: string,
  patch: Partial<Pick<Lecturer, "displayName" | "email" | "active" | "room">>,
): AppData {
  return {
    ...data,
    lecturers: data.lecturers.map((lecturer) =>
      lecturer.id === lecturerId ? { ...lecturer, ...patch } : lecturer,
    ),
  };
}

export function commitSourceWorkbooks(
  data: AppData,
  batchId: string,
  pendingWorkbooks: PendingWorkbook[],
): ActionResult {
  if (pendingWorkbooks.length === 0) {
    return { data, error: "Chưa có file nào để nhập." };
  }
  const batch = data.batches.find((item) => item.id === batchId);
  if (!batch) return { data, error: "Không tìm thấy đợt thi." };

  const blocking = pendingWorkbooks.some(
    (workbook) =>
      workbook.errors.length > 0 ||
      workbook.rows.length === 0 ||
      workbook.mapping.mssv === null ||
      workbook.rows.some((row) => row.errors.length > 0),
  );
  if (blocking) {
    return {
      data,
      error:
        "Dữ liệu còn lỗi chặn nhập (MSSV trống/trùng, thiếu cột bắt buộc...). Hãy sửa ánh xạ hoặc dữ liệu trước.",
    };
  }

  const existing = data.students.filter((student) => student.batchId === batchId);
  const crossIssues = findCrossFileDuplicateIssues(pendingWorkbooks, existing);
  if (crossIssues.length > 0) {
    return { data, error: crossIssues.join(" ") };
  }

  const importedAt = nowIso();
  const newWorkbooks: SourceWorkbook[] = [];
  const newStudents: Student[] = [];
  const newLecturers: Lecturer[] = [];
  const existingLecturerNames = new Set(
    data.lecturers
      .filter((lecturer) => lecturer.batchId === batchId)
      .map((lecturer) => lecturer.displayName.trim().toLowerCase()),
  );
  const importRuns: AppData["importRuns"] = [];
  const warnings: string[] = [];

  for (const pending of pendingWorkbooks) {
    const lecturerName = pending.metaLecturerName?.trim() || null;
    if (lecturerName && !existingLecturerNames.has(lecturerName.toLowerCase())) {
      existingLecturerNames.add(lecturerName.toLowerCase());
      newLecturers.push({
        id: createId("lec"),
        batchId,
        displayName: lecturerName,
        email: "",
        active: true,
        room: "",
      });
    }

    const workbook: SourceWorkbook = {
      id: createId("wb"),
      batchId,
      fileName: pending.fileName,
      fileSize: pending.fileSize,
      sheetName: pending.sheetName,
      sheetNames: pending.sheetNames,
      headerRow: pending.headerRow,
      dataStartRow: pending.dataStartRow,
      mapping: { ...pending.mapping },
      headers: [...pending.headers],
      originalBase64: pending.originalBase64,
      importedAt,
      metaCourseCode: pending.metaCourseCode,
      metaCourseName: pending.metaCourseName,
      metaLecturerName: lecturerName,
      sourceTemplate: pending.sourceTemplate ?? "custom",
    };
    newWorkbooks.push(workbook);

    for (const row of pending.rows) {
      newStudents.push({
        id: createId("stu"),
        batchId,
        mssv: row.mssv,
        name: row.name,
        className: row.className,
        courseCode: row.courseCode,
        courseName: row.courseName,
        groupCodeFromSource: row.groupCode,
        sourceWorkbookId: workbook.id,
        sourceSheetName: pending.sheetName,
        sourceRowNumber: row.sourceRowNumber,
        originalRowData: row.originalRowData,
        importedAt,
      });
    }

    const rowWarnings = pending.rows.flatMap((row) =>
      row.warnings.map(
        (warning) => `${pending.fileName} dòng ${row.sourceRowNumber}: ${warning}`,
      ),
    );
    importRuns.push({
      id: createId("run"),
      batchId,
      kind: "source",
      fileName: pending.fileName,
      createdAt: importedAt,
      status:
        pending.errors.length > 0 || pending.warnings.length > 0 || rowWarnings.length > 0
          ? "warning"
          : "success",
      validationReport: [
        ...pending.errors,
        ...pending.warnings,
        ...rowWarnings,
      ],
    });
    warnings.push(
      ...pending.warnings.map((warning) => `${pending.fileName}: ${warning}`),
    );
  }

  return {
    data: {
      ...data,
      sourceWorkbooks: [...data.sourceWorkbooks, ...newWorkbooks],
      students: [...data.students, ...newStudents],
      lecturers:
        newLecturers.length > 0
          ? [...data.lecturers, ...newLecturers]
          : data.lecturers,
      importRuns: [...data.importRuns, ...importRuns],
    },
    warnings,
  };
}

export function createGroup(
  data: AppData,
  batchId: string,
  groupCode: string,
  studentIds: string[],
  defaultAdvisorId: string | null,
): ActionResult {
  const code = groupCode.trim();
  if (!code) return { data, error: "Mã nhóm không được để trống." };
  const batchGroups = data.groups.filter((group) => group.batchId === batchId);
  if (
    batchGroups.some(
      (group) => group.groupCode.toLowerCase() === code.toLowerCase(),
    )
  ) {
    return { data, error: `Mã nhóm "${code}" đã tồn tại trong đợt.` };
  }
  if (studentIds.length === 0) {
    return { data, error: "Nhóm phải có ít nhất một sinh viên." };
  }

  const batchStudents = new Map(
    data.students
      .filter((student) => student.batchId === batchId)
      .map((student) => [student.id, student]),
  );
  const memberOfStudent = new Map<string, GroupMember>();
  for (const member of data.members) {
    memberOfStudent.set(member.studentId, member);
  }

  for (const studentId of studentIds) {
    if (!batchStudents.has(studentId)) {
      return { data, error: "Có sinh viên không thuộc đợt thi hiện tại." };
    }
    if (memberOfStudent.has(studentId)) {
      return {
        data,
        error: `Sinh viên ${batchStudents.get(studentId)?.mssv} đã thuộc một nhóm khác.`,
      };
    }
  }
  if (defaultAdvisorId) {
    const advisor = data.lecturers.find(
      (lecturer) => lecturer.id === defaultAdvisorId && lecturer.batchId === batchId,
    );
    if (!advisor) return { data, error: "GVHD mặc định không hợp lệ." };
  }

  const now = nowIso();
  const group: PblGroup = {
    id: createId("grp"),
    batchId,
    groupCode: code,
    defaultAdvisorId,
    graderId: null,
    createdAt: now,
    updatedAt: now,
  };
  const members: GroupMember[] = studentIds.map((studentId) => ({
    id: createId("mem"),
    groupId: group.id,
    studentId,
    advisorOverrideId: null,
  }));

  return {
    data: {
      ...data,
      groups: [...data.groups, group],
      members: [...data.members, ...members],
    },
  };
}

export function addGroupMember(
  data: AppData,
  groupId: string,
  studentId: string,
): ActionResult {
  const group = data.groups.find((item) => item.id === groupId);
  if (!group) return { data, error: "Không tìm thấy nhóm." };
  const student = data.students.find((item) => item.id === studentId);
  if (!student || student.batchId !== group.batchId) {
    return { data, error: "Sinh viên không thuộc đợt của nhóm." };
  }
  if (data.members.some((member) => member.studentId === studentId)) {
    return { data, error: "Sinh viên đã thuộc một nhóm khác." };
  }
  return {
    data: {
      ...data,
      members: [
        ...data.members,
        {
          id: createId("mem"),
          groupId,
          studentId,
          advisorOverrideId: null,
        },
      ],
    },
  };
}

export function removeGroupMember(data: AppData, memberId: string): AppData {
  return { ...data, members: data.members.filter((member) => member.id !== memberId) };
}

export function deleteGroup(data: AppData, groupId: string): AppData {
  return {
    ...data,
    groups: data.groups.filter((group) => group.id !== groupId),
    members: data.members.filter((member) => member.groupId !== groupId),
  };
}

export function autoCreateGroupsFromSource(
  data: AppData,
  batchId: string,
): {
  data: AppData;
  createdCount: number;
  skippedCount: number;
  message: string;
  error?: string;
} {
  const batch = data.batches.find((b) => b.id === batchId);
  if (!batch) {
    return {
      data,
      createdCount: 0,
      skippedCount: 0,
      message: "Không tìm thấy đợt thi.",
      error: "Không tìm thấy đợt thi.",
    };
  }

  const batchStudents = data.students.filter((s) => s.batchId === batchId);
  const existingMemberStudentIds = new Set(
    data.members
      .filter((m) => {
        const group = data.groups.find((g) => g.id === m.groupId);
        return group && group.batchId === batchId;
      })
      .map((m) => m.studentId),
  );

  const availableStudents = batchStudents.filter(
    (s) => !existingMemberStudentIds.has(s.id),
  );

  const studentsWithGroup = availableStudents.filter(
    (s) => s.groupCodeFromSource && s.groupCodeFromSource.trim() !== "",
  );
  const skippedCount = availableStudents.length - studentsWithGroup.length;

  if (studentsWithGroup.length === 0) {
    return {
      data,
      createdCount: 0,
      skippedCount,
      message: "Không có sinh viên nào có mã nhóm từ file nguồn để tạo tự động.",
    };
  }

  const grouped = new Map<string, { code: string; students: Student[] }>();
  for (const s of studentsWithGroup) {
    const rawCode = s.groupCodeFromSource.trim();
    const key = rawCode.toLowerCase();
    const existing = grouped.get(key);
    if (existing) {
      existing.students.push(s);
    } else {
      grouped.set(key, { code: rawCode, students: [s] });
    }
  }

  let nextData = data;
  let createdCount = 0;

  for (const [, { code, students }] of grouped.entries()) {
    const existingGroup = nextData.groups.find(
      (g) => g.batchId === batchId && g.groupCode.toLowerCase() === code.toLowerCase(),
    );

    if (existingGroup) {
      for (const student of students) {
        const addResult = addGroupMember(nextData, existingGroup.id, student.id);
        if (!addResult.error) {
          nextData = addResult.data;
        }
      }
    } else {
      const workbookMap = new Map(
        nextData.sourceWorkbooks
          .filter((wb) => wb.batchId === batchId)
          .map((wb) => [wb.id, wb]),
      );
      let defaultAdvisorId: string | null = null;
      for (const student of students) {
        const wb = workbookMap.get(student.sourceWorkbookId);
        const lecName = wb?.metaLecturerName?.trim();
        if (lecName) {
          const lec = nextData.lecturers.find(
            (l) =>
              l.batchId === batchId &&
              l.displayName.trim().toLowerCase() === lecName.toLowerCase(),
          );
          if (lec) {
            defaultAdvisorId = lec.id;
            break;
          }
        }
      }
      const createResult = createGroup(
        nextData,
        batchId,
        code,
        students.map((s) => s.id),
        defaultAdvisorId,
      );
      if (!createResult.error) {
        nextData = createResult.data;
        createdCount += 1;
      }
    }
  }

  return {
    data: nextData,
    createdCount,
    skippedCount,
    message: `Đã tự động tạo/cập nhật ${createdCount} nhóm PBL từ file nguồn cho ${studentsWithGroup.length} sinh viên.${skippedCount > 0 ? ` Còn ${skippedCount} sinh viên chưa có mã nhóm nguồn cần phân nhóm thủ công.` : ""}`,
  };
}

export function updateGroup(
  data: AppData,
  groupId: string,
  patch: Partial<Pick<PblGroup, "groupCode" | "defaultAdvisorId" | "graderId">>,
): ActionResult {
  const group = data.groups.find((item) => item.id === groupId);
  if (!group) return { data, error: "Không tìm thấy nhóm." };
  if (patch.groupCode !== undefined) {
    const code = patch.groupCode.trim();
    if (!code) return { data, error: "Mã nhóm không được để trống." };
    if (
      data.groups.some(
        (item) =>
          item.batchId === group.batchId &&
          item.id !== groupId &&
          item.groupCode.toLowerCase() === code.toLowerCase(),
      )
    ) {
      return { data, error: `Mã nhóm "${code}" đã tồn tại.` };
    }
    patch = { ...patch, groupCode: code };
  }
  if (patch.defaultAdvisorId) {
    const advisor = data.lecturers.find(
      (lecturer) =>
        lecturer.id === patch.defaultAdvisorId &&
        lecturer.batchId === group.batchId,
    );
    if (!advisor) return { data, error: "GVHD mặc định không hợp lệ." };
  }
  if (patch.graderId) {
    const grader = data.lecturers.find(
      (lecturer) =>
        lecturer.id === patch.graderId && lecturer.batchId === group.batchId,
    );
    if (!grader) return { data, error: "Giảng viên chấm không hợp lệ." };
  }
  return {
    data: {
      ...data,
      groups: data.groups.map((item) =>
        item.id === groupId
          ? { ...item, ...patch, updatedAt: nowIso() }
          : item,
      ),
    },
  };
}

export function updateMemberOverride(
  data: AppData,
  memberId: string,
  advisorOverrideId: string | null,
): ActionResult {
  const member = data.members.find((item) => item.id === memberId);
  if (!member) return { data, error: "Không tìm thấy thành viên nhóm." };
  if (advisorOverrideId) {
    const group = data.groups.find((item) => item.id === member.groupId);
    const advisor = data.lecturers.find(
      (lecturer) =>
        lecturer.id === advisorOverrideId &&
        lecturer.batchId === group?.batchId,
    );
    if (!advisor) return { data, error: "GVHD ngoại lệ không hợp lệ." };
  }
  return {
    data: {
      ...data,
      members: data.members.map((item) =>
        item.id === memberId ? { ...item, advisorOverrideId } : item,
      ),
    },
  };
}

export function applyAssignments(
  data: AppData,
  assignments: Record<string, string>,
): AppData {
  return {
    ...data,
    groups: data.groups.map((group) =>
      assignments[group.id]
        ? { ...group, graderId: assignments[group.id], updatedAt: nowIso() }
        : group,
    ),
  };
}

export function saveReview(
  data: AppData,
  studentId: string,
  reviewerId: string,
  status: ReviewStatus,
  note: string,
): ActionResult {
  const member = data.members.find((item) => item.studentId === studentId);
  const group = member
    ? data.groups.find((item) => item.id === member.groupId)
    : undefined;
  if (!member || !group) {
    return { data, error: "Sinh viên chưa thuộc nhóm nên không thể rà soát." };
  }
  const effective = getEffectiveAdvisorId(
    member.advisorOverrideId,
    group.defaultAdvisorId,
  );
  if (effective !== reviewerId) {
    return {
      data,
      error:
        "Bạn không phải GVHD hiệu lực của sinh viên này nên không được rà soát.",
    };
  }

  const existing = data.reviews.find(
    (review) =>
      review.studentId === studentId && review.reviewerId === reviewerId,
  );
  const updatedAt = nowIso();
  if (existing) {
    return {
      data: {
        ...data,
        reviews: data.reviews.map((review) =>
          review.id === existing.id
            ? { ...review, status, note: note.trim(), updatedAt }
            : review,
        ),
      },
    };
  }

  const review: ScoreReview = {
    id: createId("rev"),
    batchId: group.batchId,
    studentId,
    reviewerId,
    status,
    note: note.trim(),
    updatedAt,
  };
  return { data: { ...data, reviews: [...data.reviews, review] } };
}

export function commitGradedImport(
  data: AppData,
  batchId: string,
  preview: GradedImportPreview,
): ActionResult {
  const valid = preview.candidates.filter(
    (candidate) => candidate.status === "valid" && candidate.studentId && candidate.newValue !== null,
  );
  if (preview.errors.length > 0) {
    return {
      data,
      error:
        "File còn lỗi cấp file (sai đợt, không rõ giảng viên...). Không cập nhật điểm cho đến khi xử lý.",
    };
  }
  if (valid.length === 0) {
    return {
      data,
      error: "Không có điểm hợp lệ nào để cập nhật. Hãy kiểm tra báo cáo lỗi/xung đột.",
    };
  }

  const now = nowIso();
  let scores = [...data.scores];
  const changeLogs = [...data.changeLogs];
  const updatedStudentIds = new Set<string>();

  for (const candidate of valid) {
    const studentId = candidate.studentId as string;
    const newValue = candidate.newValue as number;
    if (updatedStudentIds.has(studentId)) continue;
    updatedStudentIds.add(studentId);

    const existing = scores.find((score) => score.studentId === studentId);
    if (existing) {
      changeLogs.push({
        id: createId("log"),
        batchId,
        studentId,
        oldValue: existing.value,
        newValue,
        changedBy: candidate.graderName || "Điều phối viên",
        graderId: candidate.graderId,
        sourceFileName: candidate.sourceFileName,
        changedAt: now,
      });
      scores = scores.map((score) =>
        score.id === existing.id
          ? {
              ...score,
              value: newValue,
              graderId: candidate.graderId,
              sourceFileName: candidate.sourceFileName,
              updatedAt: now,
            }
          : score,
      );
    } else {
      const score: Score = {
        id: createId("score"),
        batchId,
        studentId,
        value: newValue,
        graderId: candidate.graderId,
        sourceFileName: candidate.sourceFileName,
        updatedAt: now,
      };
      scores.push(score);
      changeLogs.push({
        id: createId("log"),
        batchId,
        studentId,
        oldValue: null,
        newValue,
        changedBy: candidate.graderName || "Điều phối viên",
        graderId: candidate.graderId,
        sourceFileName: candidate.sourceFileName,
        changedAt: now,
      });
    }
  }

  // Ghi nhận xung đột chưa xử lý; các xung đột cũ của sinh viên vừa cập nhật được đánh dấu đã xử lý.
  const conflicts: ScoreConflict[] = data.conflicts.map((conflict) =>
    conflict.batchId === batchId &&
    conflict.studentId &&
    updatedStudentIds.has(conflict.studentId)
      ? { ...conflict, resolved: true }
      : conflict,
  );

  const conflictKeys = new Set(
    conflicts
      .filter((conflict) => !conflict.resolved)
      .map(
        (conflict) =>
          `${conflict.studentId}:${conflict.existingValue}:${conflict.newValue}:${conflict.sourceFileName}`,
      ),
  );
  for (const candidate of preview.candidates) {
    if (candidate.status !== "conflict") continue;
    const key = `${candidate.studentId}:${candidate.oldValue}:${candidate.newValue}:${candidate.sourceFileName}`;
    if (conflictKeys.has(key)) continue;
    conflictKeys.add(key);
    conflicts.push({
      id: createId("conflict"),
      batchId,
      studentId: candidate.studentId,
      studentKey: candidate.studentKey,
      mssv: candidate.mssv,
      studentName: candidate.studentName,
      existingValue: candidate.oldValue,
      newValue: candidate.newValue,
      sourceFileName: candidate.sourceFileName,
      createdAt: now,
      resolved: false,
    });
  }

  const importRuns = [...data.importRuns];
  for (const file of preview.files) {
    const related = preview.candidates.filter(
      (candidate) => candidate.sourceFileName === file.fileName,
    );
    const hasIssues =
      file.errors.length > 0 ||
      file.warnings.length > 0 ||
      related.some((candidate) => candidate.status !== "valid" && candidate.status !== "unchanged");
    importRuns.push({
      id: createId("run"),
      batchId,
      kind: "graded",
      fileName: file.fileName,
      createdAt: now,
      status: hasIssues ? "warning" : "success",
      validationReport: [
        ...file.errors,
        ...file.warnings,
        ...related.flatMap((candidate) =>
          candidate.messages.map(
            (message) =>
              `Dòng ${candidate.rowNumber} (${candidate.mssv || "?"}): ${message}`,
          ),
        ),
      ],
    });
  }

  return {
    data: {
      ...data,
      scores,
      changeLogs,
      conflicts,
      importRuns,
    },
  };
}
