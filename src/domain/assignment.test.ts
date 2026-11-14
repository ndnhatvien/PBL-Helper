import { describe, expect, it } from "vitest";
import { suggestAssignment, type AssignmentGroupInput } from "./assignment";

const groups: AssignmentGroupInput[] = [
  { id: "g1", groupCode: "PBL01", studentCount: 3 },
  { id: "g2", groupCode: "PBL02", studentCount: 2 },
  { id: "g3", groupCode: "PBL03", studentCount: 3 },
  { id: "g4", groupCode: "PBL04", studentCount: 2 },
  { id: "g5", groupCode: "PBL05", studentCount: 3 },
  { id: "g6", groupCode: "PBL06", studentCount: 3 },
];

describe("phân công giảng viên chấm", () => {
  it("cân bằng theo số sinh viên và không chia nhóm", () => {
    const result = suggestAssignment(groups, ["gv1", "gv2", "gv3"], "students");
    expect(Object.keys(result.assignments)).toHaveLength(groups.length);

    // Mỗi nhóm có đúng một giảng viên.
    for (const group of groups) {
      expect(result.assignments[group.id]).toBeTruthy();
    }

    const totals = new Map<string, number>();
    for (const group of groups) {
      const grader = result.assignments[group.id];
      totals.set(grader, (totals.get(grader) ?? 0) + group.studentCount);
    }
    const counts = [...totals.values()].sort((a, b) => a - b);
    expect(counts[counts.length - 1] - counts[0]).toBeLessThanOrEqual(3);
    expect([...totals.values()].reduce((a, b) => a + b, 0)).toBe(16);
  });

  it("cân bằng theo số nhóm khi được chọn", () => {
    const result = suggestAssignment(groups, ["gv1", "gv2"], "groups");
    const groupCounts = result.workload.map((item) => item.groupCount);
    expect(Math.max(...groupCounts) - Math.min(...groupCounts)).toBeLessThanOrEqual(1);
    expect(groupCounts.reduce((a, b) => a + b, 0)).toBe(groups.length);
  });

  it("xác định và ổn định khi hòa", () => {
    const first = suggestAssignment(groups, ["gv1", "gv2"], "students");
    const second = suggestAssignment(groups, ["gv1", "gv2"], "students");
    expect(first.assignments).toEqual(second.assignments);
  });

  it("không trả phân công khi không có giảng viên", () => {
    const result = suggestAssignment(groups, [], "students");
    expect(result.assignments).toEqual({});
    expect(result.workload).toEqual([]);
  });

  it("không phân công giảng viên chấm nhóm mà mình hướng dẫn (chống GVHD tự chấm)", () => {
    // Nhóm g1 có GVHD là gv1 và gv2 (đồng hướng dẫn). Chỉ có gv3 được phép chấm g1.
    const testGroups: AssignmentGroupInput[] = [
      { id: "g1", groupCode: "PBL01", studentCount: 3, excludedLecturerIds: ["gv1", "gv2"] },
      { id: "g2", groupCode: "PBL02", studentCount: 3, excludedLecturerIds: ["gv3"] },
    ];
    const result = suggestAssignment(testGroups, ["gv1", "gv2", "gv3"], "students");
    expect(result.assignments["g1"]).toBe("gv3");
    expect(result.assignments["g2"]).not.toBe("gv3");
  });

  it("không tự ý phân công nếu tất cả giảng viên hiện có đều là GVHD của nhóm", () => {
    // Nhóm g1 có 2 GVHD đồng hướng dẫn là gv1 và gv2. Trong đợt chỉ có gv1 và gv2.
    const testGroups: AssignmentGroupInput[] = [
      { id: "g1", groupCode: "PBL01", studentCount: 3, excludedLecturerIds: ["gv1", "gv2"] },
    ];
    const result = suggestAssignment(testGroups, ["gv1", "gv2"], "students");
    expect(result.assignments["g1"]).toBeUndefined();
    expect(result.unassignedGroupIds).toContain("g1");
  });
});
