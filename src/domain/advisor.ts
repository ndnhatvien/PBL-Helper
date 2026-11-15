import type {
  AdvisorSource,
  GroupMember,
  Lecturer,
  PblGroup,
  ReviewStatus,
  SourceWorkbook,
  Student,
} from "../types";

export function getEffectiveAdvisorId(
  studentOverrideId: string | null | undefined,
  groupDefaultAdvisorId: string | null | undefined,
): string | null {
  return studentOverrideId || groupDefaultAdvisorId || null;
}

export function getAdvisorSource(
  studentOverrideId: string | null | undefined,
  groupDefaultAdvisorId: string | null | undefined,
): AdvisorSource {
  if (studentOverrideId) return "student_override";
  if (groupDefaultAdvisorId) return "group_default";
  return "unassigned";
}

export function canAdvisorReviewStudent(
  currentLecturerId: string | null | undefined,
  effectiveAdvisorId: string | null | undefined,
): boolean {
  return Boolean(
    currentLecturerId && effectiveAdvisorId && currentLecturerId === effectiveAdvisorId,
  );
}

/**
 * Lấy tên hiển thị Giảng viên hướng dẫn của sinh viên (hỗ trợ cả đồng hướng dẫn từ file nguồn).
 * Ưu tiên:
 * 1. GVHD override riêng của sinh viên.
 * 2. Đồng hướng dẫn từ file nguồn (sourceWorkbook: metaLecturerNames).
 * 3. GVHD mặc định của nhóm (defaultAdvisorId).
 * 4. GVHD theo sinh viên từ file nguồn (advisorNameFromSource).
 */
export function getStudentAdvisorDisplayName(
  member: GroupMember,
  student: Student,
  group: PblGroup,
  lecturers: Lecturer[],
  sourceWorkbooks?: SourceWorkbook[],
): string {
  const lecturerById = new Map(lecturers.map((l) => [l.id, l.displayName]));
  const lecturerByName = new Map(
    lecturers.map((l) => [l.displayName.trim().toLowerCase(), l.displayName]),
  );

  // 1. Override riêng của sinh viên
  if (member.advisorOverrideId) {
    const overrideName = lecturerById.get(member.advisorOverrideId);
    if (overrideName) return overrideName;
  }

  // 2. Đồng hướng dẫn từ file nguồn
  const wbId = student.sourceWorkbookId || group.sourceWorkbookId;
  if (wbId && sourceWorkbooks) {
    const wb = sourceWorkbooks.find((w) => w.id === wbId);
    if (wb) {
      const names = wb.metaLecturerNames?.length
        ? wb.metaLecturerNames
        : wb.metaLecturerName
          ? [wb.metaLecturerName]
          : [];
      if (names.length > 0) {
        const displayNames = names.map(
          (name) => lecturerByName.get(name.trim().toLowerCase()) || name.trim(),
        );
        return displayNames.join(" & ");
      }
    }
  }

  // 3. GVHD mặc định của nhóm
  if (group.defaultAdvisorId) {
    const defaultName = lecturerById.get(group.defaultAdvisorId);
    if (defaultName) return defaultName;
  }

  // 4. GVHD theo sinh viên từ file nguồn
  if (student.advisorNameFromSource) {
    return student.advisorNameFromSource.trim();
  }

  return "—";
}

/** Lấy trạng thái rà soát hiện hành theo từng sinh viên + người rà soát. */
export function findReview<T extends { studentId: string; reviewerId: string }>(
  reviews: T[],
  studentId: string,
  reviewerId: string,
): T | undefined {
  return reviews.find(
    (review) => review.studentId === studentId && review.reviewerId === reviewerId,
  );
}

/** Trạng thái hiển thị theo sinh viên (ưu tiên bản ghi của người đang xem). */
export function reviewStatusForStudent(
  reviews: Array<{ studentId: string; reviewerId: string; status: ReviewStatus }>,
  studentId: string,
  currentReviewerId: string | null,
): ReviewStatus {
  const own = currentReviewerId
    ? reviews.find(
        (review) =>
          review.studentId === studentId && review.reviewerId === currentReviewerId,
      )
    : undefined;
  if (own) return own.status;

  // Nếu chưa phải người rà soát hiện tại, hiển thị trạng thái mới nhất của sinh viên
  // để GVHD khác trong nhóm vẫn thấy ngữ cảnh. Quyền thao tác vẫn tách biệt.
  const latest = reviews
    .filter((review) => review.studentId === studentId)
    .sort((a, b) => {
      const at = (a as { updatedAt?: string }).updatedAt ?? "";
      const bt = (b as { updatedAt?: string }).updatedAt ?? "";
      return bt.localeCompare(at);
    })[0];
  return latest?.status ?? "pending";
}

/**
 * Trích xuất toàn bộ danh sách ID của các GVHD liên quan đến nhóm:
 * bao gồm GVHD mặc định nhóm, GVHD override của thành viên, GVHD từ cột file nguồn,
 * và các GVHD đồng hướng dẫn của file nguồn.
 * Dùng để loại trừ triệt để khi phân công chấm (chống GVHD tự chấm).
 */
export function getGroupAdvisorIds(
  group: PblGroup,
  members: GroupMember[],
  students: Student[],
  lecturers: Lecturer[],
  sourceWorkbooks?: SourceWorkbook[],
): string[] {
  const advisorIds = new Set<string>();
  if (group.defaultAdvisorId) {
    advisorIds.add(group.defaultAdvisorId);
  }

  const studentMap = new Map(students.map((s) => [s.id, s]));
  const lecturerMapByName = new Map(
    lecturers.map((l) => [l.displayName.trim().toLowerCase(), l.id]),
  );
  const workbookMap = new Map((sourceWorkbooks ?? []).map((wb) => [wb.id, wb]));

  for (const member of members) {
    if (member.groupId !== group.id) continue;
    if (member.advisorOverrideId) {
      advisorIds.add(member.advisorOverrideId);
    }
    const student = studentMap.get(member.studentId);
    if (student?.advisorNameFromSource) {
      const id = lecturerMapByName.get(
        student.advisorNameFromSource.trim().toLowerCase(),
      );
      if (id) advisorIds.add(id);
    }
    if (student?.sourceWorkbookId) {
      const wb = workbookMap.get(student.sourceWorkbookId);
      const names = wb?.metaLecturerNames?.length
        ? wb.metaLecturerNames
        : wb?.metaLecturerName
          ? [wb.metaLecturerName]
          : [];
      for (const name of names) {
        const id = lecturerMapByName.get(name.trim().toLowerCase());
        if (id) advisorIds.add(id);
      }
    }
  }

  return Array.from(advisorIds);
}
