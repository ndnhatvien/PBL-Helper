import { describe, expect, it } from "vitest";
import {
  canAdvisorReviewStudent,
  findReview,
  getAdvisorSource,
  getEffectiveAdvisorId,
  reviewStatusForStudent,
} from "./advisor";

describe("GVHD hiệu lực (policy both)", () => {
  it("ưu tiên GVHD override của sinh viên hơn GVHD mặc định của nhóm", () => {
    expect(getEffectiveAdvisorId("advisor-b", "advisor-a")).toBe("advisor-b");
    expect(getAdvisorSource("advisor-b", "advisor-a")).toBe("student_override");
  });

  it("dùng GVHD mặc định khi sinh viên không có override", () => {
    expect(getEffectiveAdvisorId(null, "advisor-a")).toBe("advisor-a");
    expect(getEffectiveAdvisorId(undefined, "advisor-a")).toBe("advisor-a");
    expect(getAdvisorSource(null, "advisor-a")).toBe("group_default");
  });

  it("trả unassigned khi cả hai đều trống", () => {
    expect(getEffectiveAdvisorId(null, null)).toBeNull();
    expect(getAdvisorSource(null, null)).toBe("unassigned");
  });
});

describe("quyền rà soát tách biệt quyền xem", () => {
  it("chỉ đúng GVHD hiệu lực mới được rà soát", () => {
    expect(canAdvisorReviewStudent("a", "a")).toBe(true);
    expect(canAdvisorReviewStudent("a", "b")).toBe(false);
    expect(canAdvisorReviewStudent("a", null)).toBe(false);
    expect(canAdvisorReviewStudent(null, null)).toBe(false);
  });

  it("trạng thái rà soát được tra theo studentId + reviewerId, không theo nhóm", () => {
    const reviews = [
      {
        studentId: "sv1",
        reviewerId: "gv-a",
        status: "approved" as const,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        studentId: "sv2",
        reviewerId: "gv-b",
        status: "needs_changes" as const,
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    ];
    expect(findReview(reviews, "sv1", "gv-a")?.status).toBe("approved");
    expect(findReview(reviews, "sv2", "gv-a")).toBeUndefined();
    expect(reviewStatusForStudent(reviews, "sv1", "gv-a")).toBe("approved");
    expect(reviewStatusForStudent(reviews, "sv2", "gv-b")).toBe("needs_changes");
    expect(reviewStatusForStudent(reviews, "sv2", "gv-a")).toBe("needs_changes");
    expect(reviewStatusForStudent(reviews, "sv1", "gv-b")).toBe("approved");
  });

  it("hai sinh viên trong cùng nhóm có trạng thái độc lập", () => {
    const reviews = [
      {
        studentId: "sv1",
        reviewerId: "gv-a",
        status: "approved" as const,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    expect(reviewStatusForStudent(reviews, "sv1", "gv-a")).toBe("approved");
    expect(reviewStatusForStudent(reviews, "sv2", "gv-a")).toBe("pending");
  });
});
