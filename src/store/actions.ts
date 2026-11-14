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
import { getEffectiveAdvisorId, getGroupAdvisorIds } from "../domain/advisor";
import {
  findCrossFileDuplicateIssues,
  splitLecturerNames,
} from "../excel/importWorkbook";
export { splitLecturerNames };
import { createId, nowIso } from "../utils/id";
import {
  extractClassOrCourseSuffix,
  formatAdvisorGroupCode,
  generateScorecardPrefix,
  normalizeRawGroupCode,
} from "../utils/text";

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

export function renameLecturer(
  data: AppData,
  batchId: string,
  lecturerId: string,
  newDisplayName: string,
): ActionResult {
  const trimmed = newDisplayName.trim();
  if (!trimmed) {
    return { data, error: "Tên giảng viên không được để trống." };
  }

  const lecturer = data.lecturers.find((l) => l.id === lecturerId);
  if (!lecturer) {
    return { data, error: "Không tìm thấy giảng viên." };
  }

  const existingOther = data.lecturers.find(
    (l) =>
      l.batchId === batchId &&
      l.id !== lecturerId &&
      l.displayName.trim().toLowerCase() === trimmed.toLowerCase(),
  );
  if (existingOther) {
    return { data, error: `Đã có giảng viên "${existingOther.displayName}" trong đợt.` };
  }

  const oldName = lecturer.displayName.trim();
  const oldLower = oldName.toLowerCase();
  const newName = trimmed;

  const nextLecturers = data.lecturers.map((l) =>
    l.id === lecturerId ? { ...l, displayName: newName } : l,
  );

  // Sync to source workbooks
  const nextWorkbooks = data.sourceWorkbooks.map((wb) => {
    if (wb.batchId !== batchId) return wb;
    let changed = false;
    const currentNames = wb.metaLecturerNames?.length
      ? wb.metaLecturerNames
      : wb.metaLecturerName
        ? splitLecturerNames(wb.metaLecturerName)
        : [];
    const nextNames = currentNames.map((n) => {
      if (n.trim().toLowerCase() === oldLower) {
        changed = true;
        return newName;
      }
      return n;
    });

    if (!changed) return wb;
    return {
      ...wb,
      metaLecturerNames: nextNames,
      metaLecturerName: nextNames.join(", "),
    };
  });

  // Sync to students advisorNameFromSource
  const nextStudents = data.students.map((st) => {
    if (st.batchId !== batchId) return st;
    if (st.advisorNameFromSource?.trim().toLowerCase() === oldLower) {
      return { ...st, advisorNameFromSource: newName };
    }
    return st;
  });

  return {
    data: {
      ...data,
      lecturers: nextLecturers,
      sourceWorkbooks: nextWorkbooks,
      students: nextStudents,
    },
  };
}

export function deleteLecturer(
  data: AppData,
  batchId: string,
  lecturerId: string,
): ActionResult {
  const lecturer = data.lecturers.find((l) => l.id === lecturerId);
  if (!lecturer) {
    return { data, error: "Không tìm thấy giảng viên." };
  }

  const advisorGroups = data.groups.filter(
    (g) => g.batchId === batchId && g.defaultAdvisorId === lecturerId,
  ).length;
  const graderGroups = data.groups.filter(
    (g) => g.batchId === batchId && g.graderId === lecturerId,
  ).length;
  const overrides = data.members.filter(
    (m) => m.advisorOverrideId === lecturerId,
  ).length;

  const inWorkbooks = data.sourceWorkbooks.some((wb) => {
    if (wb.batchId !== batchId) return false;
    const names = (
      wb.metaLecturerNames?.length
        ? wb.metaLecturerNames
        : wb.metaLecturerName
          ? splitLecturerNames(wb.metaLecturerName)
          : []
    ).map((n) => n.trim().toLowerCase());
    return names.includes(lecturer.displayName.trim().toLowerCase());
  });

  if (advisorGroups > 0 || graderGroups > 0 || overrides > 0 || inWorkbooks) {
    return {
      data,
      error: `Không thể xóa giảng viên "${lecturer.displayName}" vì đang được sử dụng (${advisorGroups} nhóm GVHD, ${graderGroups} nhóm chấm, ${overrides} ngoại lệ${inWorkbooks ? ", có trong file nguồn" : ""}). Hãy gỡ phân công trước.`,
    };
  }

  return {
    data: {
      ...data,
      lecturers: data.lecturers.filter((l) => l.id !== lecturerId),
    },
  };
}

export function updateSourceWorkbookAdvisors(
  data: AppData,
  batchId: string,
  workbookId: string,
  advisors: string[],
): ActionResult {
  const wb = data.sourceWorkbooks.find((w) => w.id === workbookId);
  if (!wb) {
    return { data, error: "Không tìm thấy file nguồn." };
  }

  const cleaned = advisors.map((a) => a.trim()).filter(Boolean);
  if (cleaned.length === 0) {
    return { data, error: "Cần ít nhất một GVHD cho file." };
  }

  const existingLecturers = data.lecturers.filter((l) => l.batchId === batchId);
  const existingNames = new Set(
    existingLecturers.map((l) => l.displayName.trim().toLowerCase()),
  );

  const newLecturers: Lecturer[] = [];
  for (const name of cleaned) {
    if (!existingNames.has(name.toLowerCase())) {
      existingNames.add(name.toLowerCase());
      newLecturers.push({
        id: createId("lec"),
        batchId,
        displayName: name,
        email: "",
        active: true,
        room: "",
      });
    }
  }

  const allLecturers = [...data.lecturers, ...newLecturers];
  const primaryLec = allLecturers.find(
    (l) =>
      l.batchId === batchId &&
      l.displayName.trim().toLowerCase() === cleaned[0].toLowerCase(),
  );

  const oldNames = (
    wb.metaLecturerNames?.length
      ? wb.metaLecturerNames
      : wb.metaLecturerName
        ? splitLecturerNames(wb.metaLecturerName)
        : []
  ).map((n) => n.trim().toLowerCase());

  const oldLecIds = new Set(
    existingLecturers
      .filter((l) => oldNames.includes(l.displayName.trim().toLowerCase()))
      .map((l) => l.id),
  );

  const updatedWorkbooks = data.sourceWorkbooks.map((w) => {
    if (w.id !== workbookId) return w;
    return {
      ...w,
      metaLecturerNames: cleaned,
      metaLecturerName: cleaned.join(", "),
    };
  });

  const wbStudentIds = new Set(
    data.students
      .filter((s) => s.sourceWorkbookId === workbookId)
      .map((s) => s.id),
  );

  const affectedGroupIds = new Set(
    data.members
      .filter((m) => wbStudentIds.has(m.studentId))
      .map((m) => m.groupId),
  );

  const newAdvisorIds = new Set(
    allLecturers
      .filter((l) =>
        l.batchId === batchId &&
        cleaned.some((c) => c.toLowerCase() === l.displayName.trim().toLowerCase()),
      )
      .map((l) => l.id),
  );

  const updatedGroups = data.groups.map((g) => {
    if (!affectedGroupIds.has(g.id)) return g;
    let nextDefaultAdvisorId = g.defaultAdvisorId;
    if (!g.defaultAdvisorId || oldLecIds.has(g.defaultAdvisorId)) {
      nextDefaultAdvisorId = primaryLec ? primaryLec.id : g.defaultAdvisorId;
    }
    let nextGraderId = g.graderId;
    if (nextGraderId && newAdvisorIds.has(nextGraderId)) {
      nextGraderId = null;
    }
    return {
      ...g,
      defaultAdvisorId: nextDefaultAdvisorId,
      graderId: nextGraderId,
    };
  });

  return {
    data: {
      ...data,
      lecturers: allLecturers,
      sourceWorkbooks: updatedWorkbooks,
      groups: updatedGroups,
    },
  };
}

export function deleteSourceWorkbook(
  data: AppData,
  workbookId: string,
): ActionResult {
  const wb = data.sourceWorkbooks.find((w) => w.id === workbookId);
  if (!wb) {
    return { data, error: "Không tìm thấy file nguồn." };
  }

  const studentIdsToDelete = new Set(
    data.students
      .filter((s) => s.sourceWorkbookId === workbookId)
      .map((s) => s.id),
  );

  const remainingStudents = data.students.filter(
    (s) => !studentIdsToDelete.has(s.id),
  );
  const remainingMembers = data.members.filter(
    (m) => !studentIdsToDelete.has(m.studentId),
  );

  const activeGroupIds = new Set(remainingMembers.map((m) => m.groupId));
  const remainingGroups = data.groups.filter((g) => {
    if (g.batchId !== wb.batchId) return true;
    return activeGroupIds.has(g.id);
  });

  const remainingReviews = data.reviews.filter(
    (r) => !studentIdsToDelete.has(r.studentId),
  );

  const remainingWorkbooks = data.sourceWorkbooks.filter(
    (w) => w.id !== workbookId,
  );

  return {
    data: {
      ...data,
      students: remainingStudents,
      members: remainingMembers,
      groups: remainingGroups,
      reviews: remainingReviews,
      sourceWorkbooks: remainingWorkbooks,
    },
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
    const rawNames = (
      pending.metaLecturerNames?.length
        ? pending.metaLecturerNames
        : pending.metaLecturerName
          ? splitLecturerNames(pending.metaLecturerName)
          : []
    )
      .map((n) => n.trim())
      .filter(Boolean);

    for (const row of pending.rows) {
      if (row.advisorName) {
        const splitRowAdv = splitLecturerNames(row.advisorName);
        for (const name of splitRowAdv) {
          const cleanName = name.trim();
          if (cleanName && !rawNames.includes(cleanName)) {
            rawNames.push(cleanName);
          }
        }
      }
    }

    for (const name of rawNames) {
      const clean = name.trim();
      if (clean && !existingLecturerNames.has(clean.toLowerCase())) {
        existingLecturerNames.add(clean.toLowerCase());
        newLecturers.push({
          id: createId("lec"),
          batchId,
          displayName: clean,
          email: "",
          active: true,
          room: "",
        });
      }
    }

    const workbookLecturerNames = (
      pending.metaLecturerNames?.length
        ? pending.metaLecturerNames
        : pending.metaLecturerName
          ? splitLecturerNames(pending.metaLecturerName)
          : []
    )
      .map((n) => n.trim())
      .filter(Boolean);

    const primaryLecturerName =
      workbookLecturerNames.join(", ") ||
      pending.metaLecturerName?.trim() ||
      null;

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
      metaLecturerName: primaryLecturerName,
      metaLecturerNames: workbookLecturerNames,
      groupPrefix:
        pending.groupPrefix?.trim() ||
        generateScorecardPrefix(workbookLecturerNames, pending.metaCourseCode || pending.fileName) ||
        (pending.metaCourseCode ? `L_${extractClassOrCourseSuffix(pending.metaCourseCode) || pending.metaCourseCode}` : ""),
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
        advisorNameFromSource:
          row.advisorName ||
          (workbookLecturerNames.length > 0
            ? workbookLecturerNames.join(", ")
            : undefined),
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

export function getWorkbookLabel(wb?: SourceWorkbook | null): string {
  if (!wb) return "";
  const code = wb.metaCourseCode?.trim();
  if (code) return code;
  return (
    wb.fileName
      .replace(/\.(xlsx|xls)$/i, "")
      .replace(/[-_]?(DSTS|bang_diem|CK|dsts).*$/i, "")
      .trim() || wb.fileName.replace(/\.(xlsx|xls)$/i, "").trim()
  );
}

export function getScorecardGroupPrefix(wb?: SourceWorkbook | null): string {
  if (!wb) return "";
  if (wb.groupPrefix?.trim()) return wb.groupPrefix.trim();
  const advNames = wb.metaLecturerNames?.length
    ? wb.metaLecturerNames
    : wb.metaLecturerName
      ? splitLecturerNames(wb.metaLecturerName)
      : [];
  const advPrefix = generateScorecardPrefix(advNames, wb.metaCourseCode || wb.fileName);
  if (advPrefix) return advPrefix;
  return getWorkbookLabel(wb);
}

export function formatCompoundGroupCode(
  wb: SourceWorkbook | undefined,
  rawCode: string,
): string {
  const prefix = getScorecardGroupPrefix(wb);
  return formatAdvisorGroupCode(prefix, rawCode);
}

export function updateSourceWorkbookPrefix(
  data: AppData,
  batchId: string,
  workbookId: string,
  newPrefix: string,
): ActionResult {
  const wb = data.sourceWorkbooks.find(
    (w) => w.id === workbookId && w.batchId === batchId,
  );
  if (!wb) return { data, error: "Không tìm thấy file nguồn." };

  const cleanPrefix = newPrefix.trim();
  const updatedWorkbooks = data.sourceWorkbooks.map((w) =>
    w.id === workbookId ? { ...w, groupPrefix: cleanPrefix } : w,
  );

  // Đồng bộ cập nhật lại mã nhóm cho các nhóm thuộc bảng điểm này
  const updatedGroups = data.groups.map((group) => {
    if (group.batchId !== batchId) return group;
    if (group.sourceWorkbookId !== workbookId) return group;
    const match =
      group.groupCode.match(/_(N\d+|[A-Za-z0-9]+)$/i) ||
      group.groupCode.match(/-\s*([A-Za-z0-9\s]+)$/);
    const subCode = match ? match[1].trim() : group.groupCode;
    const nextCode = cleanPrefix
      ? `${cleanPrefix}_${normalizeRawGroupCode(subCode)}`
      : normalizeRawGroupCode(subCode);
    return { ...group, groupCode: nextCode, updatedAt: nowIso() };
  });

  return {
    data: {
      ...data,
      sourceWorkbooks: updatedWorkbooks,
      groups: updatedGroups,
    },
  };
}

export function createGroup(
  data: AppData,
  batchId: string,
  groupCode: string,
  studentIds: string[],
  defaultAdvisorId: string | null,
  sourceWorkbookId?: string | null,
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

  let wbId = sourceWorkbookId ?? null;
  if (!wbId && studentIds.length > 0) {
    wbId = batchStudents.get(studentIds[0])?.sourceWorkbookId ?? null;
  }

  const now = nowIso();
  const group: PblGroup = {
    id: createId("grp"),
    batchId,
    groupCode: code,
    sourceWorkbookId: wbId,
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

  const workbookMap = new Map(
    data.sourceWorkbooks
      .filter((wb) => wb.batchId === batchId)
      .map((wb) => [wb.id, wb]),
  );

  // Gom nhóm chuẩn: Mỗi nhóm sinh viên LUÔN LUÔN được xác định bởi Bảng điểm + Tên nhóm nguồn
  const grouped = new Map<
    string,
    {
      sourceWorkbookId: string;
      rawCode: string;
      finalGroupCode: string;
      students: Student[];
    }
  >();

  for (const s of studentsWithGroup) {
    const rawCode = s.groupCodeFromSource.trim();
    const compoundKey = `${s.sourceWorkbookId}::${rawCode.toLowerCase()}`;
    const existing = grouped.get(compoundKey);
    if (existing) {
      existing.students.push(s);
    } else {
      const wb = workbookMap.get(s.sourceWorkbookId);
      const finalGroupCode = formatCompoundGroupCode(wb, rawCode);

      grouped.set(compoundKey, {
        sourceWorkbookId: s.sourceWorkbookId,
        rawCode,
        finalGroupCode,
        students: [s],
      });
    }
  }

  let nextData = data;
  let createdCount = 0;

  for (const [, { sourceWorkbookId, rawCode, finalGroupCode, students }] of grouped.entries()) {
    // Tìm nhóm đã tồn tại trong đợt phù hợp CHÍNH XÁC với bảng điểm này
    const existingGroup = nextData.groups.find(
      (g) =>
        g.batchId === batchId &&
        g.sourceWorkbookId === sourceWorkbookId &&
        (g.groupCode.toLowerCase() === finalGroupCode.toLowerCase() ||
          g.groupCode.toLowerCase() === rawCode.toLowerCase()),
    );

    if (existingGroup) {
      for (const student of students) {
        const addResult = addGroupMember(nextData, existingGroup.id, student.id);
        if (!addResult.error) {
          nextData = addResult.data;
        }
      }
    } else {
      // Xác định defaultAdvisorId chuẩn theo bảng điểm / sinh viên
      const wb = workbookMap.get(sourceWorkbookId);
      let defaultAdvisorId: string | null = null;
      if (wb) {
        const wbAdvisorNames = (wb.metaLecturerNames && wb.metaLecturerNames.length > 0)
          ? wb.metaLecturerNames
          : wb.metaLecturerName
            ? splitLecturerNames(wb.metaLecturerName)
            : [];
        for (const wbName of wbAdvisorNames) {
          const clean = wbName.trim().toLowerCase();
          const lec = nextData.lecturers.find(
            (l) => l.batchId === batchId && l.displayName.trim().toLowerCase() === clean,
          );
          if (lec) {
            defaultAdvisorId = lec.id;
            break;
          }
        }
      }

      if (!defaultAdvisorId) {
        for (const student of students) {
          if (student.advisorNameFromSource) {
            const splitNames = splitLecturerNames(student.advisorNameFromSource);
            for (const sName of splitNames) {
              const lec = nextData.lecturers.find(
                (l) =>
                  l.batchId === batchId &&
                  l.displayName.trim().toLowerCase() === sName.trim().toLowerCase(),
              );
              if (lec) {
                defaultAdvisorId = lec.id;
                break;
              }
            }
            if (defaultAdvisorId) break;
          }
        }
      }

      // Đảm bảo uniqueGroupCode là duy nhất trong đợt, tránh va chạm tên giữa các bảng điểm
      let uniqueGroupCode = finalGroupCode;
      let suffixIdx = 2;
      while (
        nextData.groups.some(
          (g) =>
            g.batchId === batchId &&
            g.groupCode.toLowerCase() === uniqueGroupCode.toLowerCase(),
        )
      ) {
        uniqueGroupCode = `${finalGroupCode}_${suffixIdx}`;
        suffixIdx += 1;
      }

      const createResult = createGroup(
        nextData,
        batchId,
        uniqueGroupCode,
        students.map((s) => s.id),
        defaultAdvisorId,
        sourceWorkbookId,
      );
      if (!createResult.error) {
        nextData = createResult.data;
        if (defaultAdvisorId) {
          nextData = {
            ...nextData,
            members: nextData.members.map((m) => {
              const st = students.find((s) => s.id === m.studentId);
              if (!st?.advisorNameFromSource) return m;
              const sNames = splitLecturerNames(st.advisorNameFromSource);
              const matchedLec = nextData.lecturers.find(
                (l) =>
                  l.batchId === batchId &&
                  sNames.some(
                    (sn) => sn.toLowerCase() === l.displayName.trim().toLowerCase(),
                  ),
              );
              if (matchedLec && matchedLec.id !== defaultAdvisorId) {
                return { ...m, advisorOverrideId: matchedLec.id };
              }
              return m;
            }),
          };
        }
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

export function resetAndRecreateGroupsFromSource(
  data: AppData,
  batchId: string,
): ActionResult & { createdCount: number; message?: string } {
  const batch = data.batches.find((b) => b.id === batchId);
  if (!batch) return { data, error: "Không tìm thấy đợt thi.", createdCount: 0 };

  const activeGroupIds = new Set(
    data.groups.filter((g) => g.batchId === batchId).map((g) => g.id),
  );

  const cleanData: AppData = {
    ...data,
    groups: data.groups.filter((g) => g.batchId !== batchId),
    members: data.members.filter((m) => !activeGroupIds.has(m.groupId)),
  };

  const autoResult = autoCreateGroupsFromSource(cleanData, batchId);
  return {
    data: autoResult.data,
    error: autoResult.error,
    createdCount: autoResult.createdCount,
    message: `Đã làm mới và tự động tạo lại ${autoResult.createdCount} nhóm sinh viên chuẩn theo từng bảng điểm.`,
  };
}

export function updateGroup(
  data: AppData,
  groupId: string,
  patch: Partial<
    Pick<
      PblGroup,
      "groupCode" | "defaultAdvisorId" | "graderId" | "sourceWorkbookId"
    >
  >,
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

    const currentGraderId =
      patch.graderId !== undefined ? patch.graderId : group.graderId;
    if (currentGraderId && currentGraderId === patch.defaultAdvisorId) {
      return {
        data,
        error: `Xung đột quyền lợi: Giảng viên "${advisor.displayName}" đang được phân công chấm nhóm này nên không thể đặt làm GVHD.`,
      };
    }
  }
  if (patch.graderId) {
    const grader = data.lecturers.find(
      (lecturer) =>
        lecturer.id === patch.graderId && lecturer.batchId === group.batchId,
    );
    if (!grader) return { data, error: "Giảng viên chấm không hợp lệ." };

    const advisorIds = getGroupAdvisorIds(
      { ...group, ...patch },
      data.members,
      data.students,
      data.lecturers,
      data.sourceWorkbooks,
    );
    if (advisorIds.includes(patch.graderId)) {
      return {
        data,
        error: `Xung đột quyền lợi: Giảng viên "${grader.displayName}" là GVHD của nhóm này nên không được phân công chấm nhóm này.`,
      };
    }
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
