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

  it("cân bằng theo số nhóm và gom cụm theo bảng điểm (không phân tán qua nhiều bảng điểm)", () => {
    // 3 bảng điểm (wb1: 6 nhóm, wb2: 6 nhóm, wb3: 6 nhóm) = 18 nhóm
    // 3 giảng viên gv1, gv2, gv3. Chế độ cân bằng "groups".
    // Mỗi GV sẽ nhận đúng 6 nhóm và mỗi GV chỉ nhận nhóm từ 1 bảng điểm duy nhất!
    const multiWbGroups: AssignmentGroupInput[] = [];
    for (let i = 1; i <= 6; i += 1) {
      multiWbGroups.push({ id: `wb1_g${i}`, groupCode: `WB1-N${i}`, studentCount: 3, sourceWorkbookId: "wb1" });
      multiWbGroups.push({ id: `wb2_g${i}`, groupCode: `WB2-N${i}`, studentCount: 3, sourceWorkbookId: "wb2" });
      multiWbGroups.push({ id: `wb3_g${i}`, groupCode: `WB3-N${i}`, studentCount: 3, sourceWorkbookId: "wb3" });
    }

    const result = suggestAssignment(multiWbGroups, ["gv1", "gv2", "gv3"], "groups");

    // 1. Cân bằng số nhóm hoàn hảo: mỗi GV nhận đúng 6 nhóm
    for (const item of result.workload) {
      expect(item.groupCount).toBe(6);
      // 2. Mỗi GV chỉ chấm đúng 1 bảng điểm duy nhất (tối ưu hóa gom cụm)
      expect(item.workbookIds?.length).toBe(1);
    }
  });

  it("ưu tiên gom cụm theo bảng điểm ngay cả khi có loại trừ GVHD", () => {
    // wb1 (6 nhóm) do gv1 hướng dẫn -> gv1 bị loại trừ
    // wb2 (6 nhóm) do gv2 hướng dẫn -> gv2 bị loại trừ
    // 2 GV chấm: gv1 và gv2.
    // Kết quả chuẩn: gv1 chấm toàn bộ 6 nhóm wb2, gv2 chấm toàn bộ 6 nhóm wb1!
    const testGroups: AssignmentGroupInput[] = [];
    for (let i = 1; i <= 6; i += 1) {
      testGroups.push({
        id: `wb1_g${i}`,
        groupCode: `WB1-N${i}`,
        studentCount: 3,
        sourceWorkbookId: "wb1",
        excludedLecturerIds: ["gv1"],
      });
      testGroups.push({
        id: `wb2_g${i}`,
        groupCode: `WB2-N${i}`,
        studentCount: 3,
        sourceWorkbookId: "wb2",
        excludedLecturerIds: ["gv2"],
      });
    }

    const result = suggestAssignment(testGroups, ["gv1", "gv2"], "groups");

    expect(result.unassignedGroupIds).toHaveLength(0);
    // gv1 chấm đúng 6 nhóm wb2 (không chấm wb1)
    const gv1Groups = Object.entries(result.assignments).filter(([, lId]) => lId === "gv1").map(([gId]) => gId);
    expect(gv1Groups).toHaveLength(6);
    expect(gv1Groups.every((id) => id.startsWith("wb2_"))).toBe(true);

    // gv2 chấm đúng 6 nhóm wb1 (không chấm wb2)
    const gv2Groups = Object.entries(result.assignments).filter(([, lId]) => lId === "gv2").map(([gId]) => gId);
    expect(gv2Groups).toHaveLength(6);
    expect(gv2Groups.every((id) => id.startsWith("wb1_"))).toBe(true);
  });

  it("phân công cân bằng chặt chẽ khi có nhiều bảng điểm kích thước khác nhau", () => {
    // 4 bảng điểm kích thước khác nhau:
    // wb1: 10 nhóm, wb2: 8 nhóm, wb3: 7 nhóm, wb4: 5 nhóm -> Tổng = 30 nhóm
    // 5 GV: gv1..gv5 -> Target mỗi GV đúng 6 nhóm (chênh lệch max - min = 0)
    const testGroups: AssignmentGroupInput[] = [];
    const sizes = { wb1: 10, wb2: 8, wb3: 7, wb4: 5 };
    for (const [wbId, count] of Object.entries(sizes)) {
      for (let i = 1; i <= count; i += 1) {
        testGroups.push({
          id: `${wbId}_g${i}`,
          groupCode: `${wbId}-N${i}`,
          studentCount: 3,
          sourceWorkbookId: wbId,
        });
      }
    }

    const result = suggestAssignment(testGroups, ["gv1", "gv2", "gv3", "gv4", "gv5"], "groups");

    expect(result.unassignedGroupIds).toHaveLength(0);
    const counts = result.workload.map((w) => w.groupCount);
    // Cực kỳ cân bằng: mỗi GV đúng 6 nhóm
    expect(Math.max(...counts)).toBe(6);
    expect(Math.min(...counts)).toBe(6);

    // Không GV nào phải chấm quá 2 bảng điểm (giảm phân tán tối đa)
    for (const w of result.workload) {
      expect(w.workbookIds?.length).toBeLessThanOrEqual(2);
    }
  });

  it("mô phỏng thực tế 149 nhóm và 8 giảng viên", () => {
    const classSizes = [20, 20, 20, 20, 18, 18, 17, 16]; // Tổng = 149 nhóm
    const lecturers = ["L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8"];
    const groups149: AssignmentGroupInput[] = [];

    classSizes.forEach((size, classIdx) => {
      const wbId = `wb_${classIdx + 1}`;
      const advisorId = lecturers[classIdx];
      for (let i = 1; i <= size; i += 1) {
        groups149.push({
          id: `${wbId}_g${i}`,
          groupCode: `${wbId}-N${i}`,
          studentCount: (i % 3) + 2, // 2-4 SV mỗi nhóm
          sourceWorkbookId: wbId,
          excludedLecturerIds: [advisorId],
        });
      }
    });

    const resultGroups = suggestAssignment(groups149, lecturers, "groups");
    expect(resultGroups.unassignedGroupIds).toHaveLength(0);
    const groupCounts = resultGroups.workload.map((w) => w.groupCount);
    // 149 nhóm / 8 giảng viên: chính xác 5 GV nhận 19 nhóm và 3 GV nhận 18 nhóm
    expect(Math.max(...groupCounts)).toBe(19);
    expect(Math.min(...groupCounts)).toBe(18);
    expect(groupCounts.reduce((a, b) => a + b, 0)).toBe(149);

    // Ưu tiên b: Mỗi giảng viên chấm tối thiểu số bảng điểm (chỉ 1 hoặc 2 bảng điểm)
    for (const w of resultGroups.workload) {
      expect((w.workbookIds ?? []).length).toBeLessThanOrEqual(2);
    }

    const resultStudents = suggestAssignment(groups149, lecturers, "students");
    expect(resultStudents.unassignedGroupIds).toHaveLength(0);
    const sGroupCounts = resultStudents.workload.map((w) => w.groupCount);
    // Chế độ sinh viên vẫn giữ số nhóm cân bằng chặt chẽ
    expect(Math.max(...sGroupCounts) - Math.min(...sGroupCounts)).toBeLessThanOrEqual(3);
  });

  it("bỏ qua các nhóm cấm thi (xxx, XXX, _xxx, X##, _X##) và không phân công chấm thi", () => {
    const mixedGroups: AssignmentGroupInput[] = [
      { id: "g1", groupCode: "T.Nam_41_N01", studentCount: 3, excludedLecturerIds: ["L1"] },
      { id: "g2", groupCode: "T.Nam_41_N02", studentCount: 3, excludedLecturerIds: ["L1"] },
      { id: "g3", groupCode: "T.Nam_41_XXX", studentCount: 1, excludedLecturerIds: ["L1"] }, // Cấm thi dạng XXX
      { id: "g4", groupCode: "xxx", studentCount: 2, excludedLecturerIds: ["L2"] }, // Cấm thi dạng xxx
      { id: "g5", groupCode: "T.Nam_41_X01", studentCount: 1, excludedLecturerIds: ["L1"] }, // Cấm thi dạng X01
      { id: "g6", groupCode: "X02", studentCount: 1, excludedLecturerIds: ["L2"] }, // Cấm thi dạng X02
      { id: "g7", groupCode: "T.Tung_40_N01", studentCount: 3, excludedLecturerIds: ["L2"] },
    ];
    const lecturers = ["L1", "L2", "L3"];

    const result = suggestAssignment(mixedGroups, lecturers, "groups");

    // Các nhóm cấm thi không được phân cho bất kỳ GV nào
    expect(result.assignments["g3"]).toBeUndefined();
    expect(result.assignments["g4"]).toBeUndefined();
    expect(result.assignments["g5"]).toBeUndefined();
    expect(result.assignments["g6"]).toBeUndefined();

    // Các nhóm cấm thi cũng không bị coi là lỗi chưa phân công
    expect(result.unassignedGroupIds).not.toContain("g3");
    expect(result.unassignedGroupIds).not.toContain("g4");
    expect(result.unassignedGroupIds).not.toContain("g5");
    expect(result.unassignedGroupIds).not.toContain("g6");

    // Chỉ có 3 nhóm hợp lệ được phân công
    expect(result.assignments["g1"]).toBeDefined();
    expect(result.assignments["g2"]).toBeDefined();
    expect(result.assignments["g7"]).toBeDefined();
    expect(Object.keys(result.assignments)).toHaveLength(3);
  });
});
