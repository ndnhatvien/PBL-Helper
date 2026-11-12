import type { AdvisorSource, ReviewStatus } from "../types";

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
