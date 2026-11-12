import type {
  AdvisorSource,
  ExamBatch,
  GroupMember,
  GroupView,
  Lecturer,
  PblGroup,
  ReviewRow,
  ReviewStatus,
  Score,
  ScoreConflict,
  ScoreReview,
  SourceWorkbook,
  Student,
} from "../types";
import {
  getAdvisorSource,
  getEffectiveAdvisorId,
  reviewStatusForStudent,
} from "./advisor";

export interface BatchData {
  students: Student[];
  groups: PblGroup[];
  members: GroupMember[];
  lecturers: Lecturer[];
  scores: Score[];
  reviews: ScoreReview[];
  sourceWorkbooks: SourceWorkbook[];
  conflicts: ScoreConflict[];
}

export interface BatchContext extends BatchData {
  batchId: string;
}

export function filterBatchContext(
  data: BatchData,
  batchId: string,
): BatchContext {
  return {
    batchId,
    students: data.students.filter((student) => student.batchId === batchId),
    groups: data.groups.filter((group) => group.batchId === batchId),
    members: data.members.filter((member) =>
      data.groups.some(
        (group) => group.id === member.groupId && group.batchId === batchId,
      ),
    ),
    lecturers: data.lecturers.filter((lecturer) => lecturer.batchId === batchId),
    scores: data.scores.filter((score) => score.batchId === batchId),
    reviews: data.reviews.filter((review) => review.batchId === batchId),
    sourceWorkbooks: data.sourceWorkbooks.filter(
      (workbook) => workbook.batchId === batchId,
    ),
    conflicts: data.conflicts.filter((conflict) => conflict.batchId === batchId),
  };
}

export function latestReviewForStudent(
  reviews: ScoreReview[],
  studentId: string,
): ScoreReview | null {
  return (
    reviews
      .filter((review) => review.studentId === studentId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null
  );
}

export function getGroupViews(context: BatchContext): GroupView[] {
  const studentById = new Map(
    context.students.map((student) => [student.id, student]),
  );
  const lecturerById = new Map(
    context.lecturers.map((lecturer) => [lecturer.id, lecturer]),
  );
  const scoreByStudent = new Map(
    context.scores.map((score) => [score.studentId, score]),
  );

  return context.groups
    .map((group) => {
      const members = context.members
        .filter((member) => member.groupId === group.id)
        .map((member) => {
          const student = studentById.get(member.studentId);
          if (!student) return null;
          const advisorId = getEffectiveAdvisorId(
            member.advisorOverrideId,
            group.defaultAdvisorId,
          );
          const advisorSource: AdvisorSource = getAdvisorSource(
            member.advisorOverrideId,
            group.defaultAdvisorId,
          );
          return {
            member,
            student,
            advisorId,
            advisorName: advisorId ? lecturerById.get(advisorId)?.displayName ?? "—" : "—",
            advisorSource,
            score: scoreByStudent.get(student.id)?.value ?? null,
            review: latestReviewForStudent(context.reviews, student.id),
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
        .sort((a, b) => a.student.mssv.localeCompare(b.student.mssv, "vi"));

      const size = members.length;
      return {
        group,
        members,
        studentCount: size,
        sizeWarning:
          size < 2 || size > 3
            ? `Nhóm có ${size} sinh viên (khuyến nghị 2–3).`
            : null,
        missingAdvisorCount: members.filter((member) => !member.advisorId).length,
      };
    })
    .sort((a, b) => a.group.groupCode.localeCompare(b.group.groupCode, "vi"));
}

export function getStudentGroupMap(
  context: BatchContext,
): Map<string, { group: PblGroup; member: GroupMember }> {
  const groupById = new Map(context.groups.map((group) => [group.id, group]));
  const map = new Map<string, { group: PblGroup; member: GroupMember }>();
  for (const member of context.members) {
    const group = groupById.get(member.groupId);
    if (group) map.set(member.studentId, { group, member });
  }
  return map;
}

export function getAvailableStudents(context: BatchContext): Student[] {
  const grouped = getStudentGroupMap(context);
  return context.students
    .filter((student) => !grouped.has(student.id))
    .sort((a, b) => a.mssv.localeCompare(b.mssv, "vi"));
}

export function getReviewRows(
  context: BatchContext,
  currentLecturerId: string | null,
  lecturerById: Map<string, Lecturer>,
): ReviewRow[] {
  if (!currentLecturerId) return [];
  const rows: ReviewRow[] = [];
  const studentById = new Map(
    context.students.map((student) => [student.id, student]),
  );
  const scoreByStudent = new Map(
    context.scores.map((score) => [score.studentId, score]),
  );
  const groupById = new Map(context.groups.map((group) => [group.id, group]));
  const visibleGroupIds = new Set<string>();

  for (const member of context.members) {
    const group = groupById.get(member.groupId);
    if (!group) continue;
    const effective = getEffectiveAdvisorId(
      member.advisorOverrideId,
      group.defaultAdvisorId,
    );
    if (effective === currentLecturerId) visibleGroupIds.add(group.id);
  }

  for (const groupId of visibleGroupIds) {
    const group = groupById.get(groupId);
    if (!group) continue;
    const members = context.members
      .filter((member) => member.groupId === groupId)
      .map((member) => {
        const student = studentById.get(member.studentId);
        if (!student) return null;
        const advisorId = getEffectiveAdvisorId(
          member.advisorOverrideId,
          group.defaultAdvisorId,
        );
        const ownReview =
          context.reviews.find(
            (review) =>
              review.studentId === student.id &&
              review.reviewerId === currentLecturerId,
          ) ?? null;
        const row: ReviewRow = {
          student,
          group,
          member,
          advisorId,
          advisorName: advisorId
            ? lecturerById.get(advisorId)?.displayName ?? "—"
            : "Chưa gán",
          advisorSource: getAdvisorSource(
            member.advisorOverrideId,
            group.defaultAdvisorId,
          ),
          score: scoreByStudent.get(student.id)?.value ?? null,
          review: ownReview ?? latestReviewForStudent(context.reviews, student.id),
          canReview: Boolean(advisorId && advisorId === currentLecturerId),
        };
        return row;
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .sort((a, b) => a.student.mssv.localeCompare(b.student.mssv, "vi"));
    rows.push(...members);
  }

  return rows.sort((a, b) => {
    const groupCompare = (a.group?.groupCode ?? "").localeCompare(
      b.group?.groupCode ?? "",
      "vi",
    );
    return groupCompare || a.student.mssv.localeCompare(b.student.mssv, "vi");
  });
}

export interface DashboardStats {
  sourceCount: number;
  studentCount: number;
  groupCount: number;
  graderCount: number;
  scoredCount: number;
  pendingReview: number;
  approved: number;
  needsChanges: number;
  ungroupedCount: number;
  unassignedAdvisorCount: number;
  unassignedGraderCount: number;
  conflictCount: number;
  warnings: string[];
}

export function getDashboardStats(
  context: BatchContext,
  batch: ExamBatch | null,
): DashboardStats {
  const grouped = getStudentGroupMap(context);
  const groupViews = getGroupViews(context);
  const scoreStudentIds = new Set(context.scores.map((score) => score.studentId));
  const latestByStudent = new Map<string, ScoreReview>();
  for (const review of context.reviews) {
    const current = latestByStudent.get(review.studentId);
    if (!current || current.updatedAt < review.updatedAt) {
      latestByStudent.set(review.studentId, review);
    }
  }

  const counts: Record<ReviewStatus, number> = {
    pending: 0,
    approved: 0,
    needs_changes: 0,
  };
  for (const student of context.students) {
    const status = latestByStudent.get(student.id)?.status ?? "pending";
    counts[status] += 1;
  }

  const graderIds = new Set(
    context.groups
      .map((group) => group.graderId)
      .filter((id): id is string => Boolean(id)),
  );
  const unassignedAdvisorCount = groupViews.reduce(
    (total, view) => total + view.missingAdvisorCount,
    0,
  );
  const unassignedGraderCount = context.groups.filter(
    (group) => !group.graderId,
  ).length;
  const conflictCount = context.conflicts.filter(
    (conflict) => !conflict.resolved,
  ).length;

  const warnings: string[] = [];
  if (!batch) warnings.push("Chưa có đợt thi nào được chọn.");
  if (context.students.length === 0) warnings.push("Đợt thi chưa có sinh viên.");
  const ungrouped = context.students.filter(
    (student) => !grouped.has(student.id),
  ).length;
  if (ungrouped > 0) warnings.push(`${ungrouped} sinh viên chưa vào nhóm PBL.`);
  for (const view of groupViews) {
    if (view.sizeWarning) warnings.push(`${view.group.groupCode}: ${view.sizeWarning}`);
    if (view.missingAdvisorCount > 0) {
      warnings.push(
        `${view.group.groupCode}: ${view.missingAdvisorCount} sinh viên chưa có GVHD hiệu lực.`,
      );
    }
  }
  if (unassignedGraderCount > 0) {
    warnings.push(`${unassignedGraderCount} nhóm chưa được phân công giảng viên chấm.`);
  }
  const unscored = context.students.filter(
    (student) => !scoreStudentIds.has(student.id),
  ).length;
  if (unscored > 0) warnings.push(`${unscored} sinh viên chưa có điểm.`);
  if (conflictCount > 0) {
    warnings.push(`${conflictCount} xung đột điểm chưa được xử lý.`);
  }
  if (batch?.scoreConfig.isDemoDefault) {
    warnings.push(
      "Đang dùng cấu hình thang điểm demo 0–10, 1 chữ số thập phân. Hãy xác nhận lại trước khi dùng dữ liệu thật.",
    );
  }

  return {
    sourceCount: context.sourceWorkbooks.length,
    studentCount: context.students.length,
    groupCount: context.groups.length,
    graderCount: graderIds.size,
    scoredCount: context.students.length - unscored,
    pendingReview: counts.pending,
    approved: counts.approved,
    needsChanges: counts.needs_changes,
    ungroupedCount: ungrouped,
    unassignedAdvisorCount,
    unassignedGraderCount,
    conflictCount,
    warnings,
  };
}

export function studentReviewStatus(
  reviews: ScoreReview[],
  studentId: string,
  reviewerId: string | null,
): ReviewStatus {
  return reviewStatusForStudent(reviews, studentId, reviewerId);
}
