import { describe, expect, it } from "vitest";
import {
  canAdvisorReviewStudent,
  findReview,
  getAdvisorSource,
  getEffectiveAdvisorId,
  getStudentAdvisorDisplayName,
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

describe("getStudentAdvisorDisplayName", () => {
  const lecturers = [
    { id: "l1", batchId: "b1", displayName: "Huỳnh Thanh Tùng", email: "", active: true, createdAt: "", updatedAt: "" },
    { id: "l2", batchId: "b1", displayName: "Trần Văn Thanh", email: "", active: true, createdAt: "", updatedAt: "" },
    { id: "l3", batchId: "b1", displayName: "Nguyễn Văn Nam", email: "", active: true, createdAt: "", updatedAt: "" },
  ];

  it("hiển thị đồng hướng dẫn từ file nguồn", () => {
    const member = { id: "m1", groupId: "g1", studentId: "s1", advisorOverrideId: null, createdAt: "", updatedAt: "" };
    const student = { id: "s1", batchId: "b1", mssv: "101", name: "SV A", className: "", courseCode: "", courseName: "", groupCodeFromSource: "N01", advisorNameFromSource: "", sourceWorkbookId: "wb1", sourceRowNumber: 1, errors: [], warnings: [], createdAt: "", updatedAt: "" } as any;
    const group = { id: "g1", batchId: "b1", groupCode: "T.Tung_T.Thanh_40_N01", defaultAdvisorId: "l1", graderId: null, sourceWorkbookId: "wb1", createdAt: "", updatedAt: "" };
    const workbooks = [
      {
        id: "wb1",
        batchId: "b1",
        fileName: "wb1.xlsx",
        importedAt: "",
        groupPrefix: "T.Tung_T.Thanh_40",
        metaLecturerNames: ["Huỳnh Thanh Tùng", "Trần Văn Thanh"],
        metaLecturerName: "Huỳnh Thanh Tùng, Trần Văn Thanh",
      } as any,
    ];

    expect(getStudentAdvisorDisplayName(member, student, group, lecturers, workbooks)).toBe("Huỳnh Thanh Tùng & Trần Văn Thanh");
  });

  it("ưu tiên GVHD override riêng của sinh viên", () => {
    const member = { id: "m1", groupId: "g1", studentId: "s1", advisorOverrideId: "l3", createdAt: "", updatedAt: "" };
    const student = { id: "s1", batchId: "b1", mssv: "101", name: "SV A", className: "", courseCode: "", courseName: "", groupCodeFromSource: "N01", advisorNameFromSource: "", sourceWorkbookId: "wb1", sourceRowNumber: 1, errors: [], warnings: [], createdAt: "", updatedAt: "" } as any;
    const group = { id: "g1", batchId: "b1", groupCode: "T.Tung_T.Thanh_40_N01", defaultAdvisorId: "l1", graderId: null, sourceWorkbookId: "wb1", createdAt: "", updatedAt: "" };
    const workbooks = [
      {
        id: "wb1",
        batchId: "b1",
        fileName: "wb1.xlsx",
        importedAt: "",
        groupPrefix: "T.Tung_T.Thanh_40",
        metaLecturerNames: ["Huỳnh Thanh Tùng", "Trần Văn Thanh"],
      } as any,
    ];

    expect(getStudentAdvisorDisplayName(member, student, group, lecturers, workbooks)).toBe("Nguyễn Văn Nam");
  });
});
