export interface AssignmentGroupInput {
  id: string;
  groupCode: string;
  studentCount: number;
}

export type BalanceMode = "students" | "groups";

export interface AssignmentResult {
  assignments: Record<string, string>;
  workload: Array<{
    lecturerId: string;
    groupCount: number;
    studentCount: number;
  }>;
}

/**
 * Gợi ý phân công nhóm PBL cho giảng viên chấm.
 *
 * Quy tắc bắt buộc:
 * - Nhóm là đơn vị phân công, không chia thành viên của một nhóm.
 * - Sắp xếp nhóm giảm dần theo sĩ số.
 * - Mặc định chọn giảng viên có tổng sinh viên ít nhất; hòa thì ít nhóm hơn;
 *   vẫn hòa thì theo thứ tự ổn định của danh sách giảng viên.
 * - Chế độ "groups" ưu tiên cân bằng số nhóm trước, rồi số sinh viên.
 */
export function suggestAssignment(
  groups: AssignmentGroupInput[],
  lecturerIds: string[],
  mode: BalanceMode = "students",
): AssignmentResult {
  if (lecturerIds.length === 0) {
    return { assignments: {}, workload: [] };
  }

  const workload = lecturerIds.map((lecturerId) => ({
    lecturerId,
    groupCount: 0,
    studentCount: 0,
  }));
  const workloadById = new Map(workload.map((item) => [item.lecturerId, item]));

  const sortedGroups = [...groups].sort((a, b) => {
    if (b.studentCount !== a.studentCount) return b.studentCount - a.studentCount;
    return a.groupCode.localeCompare(b.groupCode, "vi");
  });

  const assignments: Record<string, string> = {};

  for (const group of sortedGroups) {
    let chosen = workload[0];
    for (const candidate of workload) {
      const primary =
        mode === "students"
          ? candidate.studentCount - chosen.studentCount
          : candidate.groupCount - chosen.groupCount;
      const secondary =
        mode === "students"
          ? candidate.groupCount - chosen.groupCount
          : candidate.studentCount - chosen.studentCount;

      if (primary < 0 || (primary === 0 && secondary < 0)) {
        chosen = candidate;
      }
    }

    assignments[group.id] = chosen.lecturerId;
    const target = workloadById.get(chosen.lecturerId);
    if (target) {
      target.groupCount += 1;
      target.studentCount += group.studentCount;
    }
  }

  return { assignments, workload };
}
