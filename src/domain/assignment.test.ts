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
});
