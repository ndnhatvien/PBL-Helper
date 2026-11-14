export interface AssignmentGroupInput {
  id: string;
  groupCode: string;
  studentCount: number;
  excludedLecturerIds?: string[];
  sourceWorkbookId?: string;
}

export type BalanceMode = "students" | "groups";

export interface AssignmentResult {
  assignments: Record<string, string>;
  workload: Array<{
    lecturerId: string;
    groupCount: number;
    studentCount: number;
    workbookIds?: string[];
  }>;
  unassignedGroupIds: string[];
}

interface LecturerState {
  lecturerId: string;
  groupCount: number;
  studentCount: number;
  groups: AssignmentGroupInput[];
  clusterCounts: Map<string, number>;
}

/**
 * Gợi ý phân công nhóm PBL cho giảng viên chấm.
 *
 * Quy tắc bắt buộc & tiêu chí tối ưu:
 * 1. Giảng viên chấm KHÔNG ĐƯỢC CHẤM nhóm/sinh viên mình hướng dẫn (loại trừ excludedLecturerIds).
 * 2. Nhóm là đơn vị phân công, không chia nhỏ thành viên của một nhóm.
 * 3. Gom cụm theo bảng điểm / lớp học phần: Ưu tiên tối đa 1 giảng viên chấm các nhóm thuộc
 *    cùng 1 bảng điểm (hạn chế tối đa việc bị phân tán qua nhiều bảng điểm khác nhau).
 * 4. Cân bằng khối lượng:
 *    - Chế độ "groups": Chênh lệch số nhóm giữa các GV <= 1 (hoặc nhỏ nhất có thể theo ràng buộc).
 *    - Chế độ "students": Cân bằng tổng số sinh viên phụ trách, ưu tiên thứ hai là số nhóm.
 * 5. Tự động tinh chỉnh (defragmentation / swap pass) để giảm số bảng điểm mà mỗi GV phải phụ trách.
 */
export function suggestAssignment(
  groups: AssignmentGroupInput[],
  lecturerIds: string[],
  mode: BalanceMode = "students",
): AssignmentResult {
  if (lecturerIds.length === 0) {
    return {
      assignments: {},
      workload: [],
      unassignedGroupIds: groups.map((g) => g.id),
    };
  }

  const states = new Map<string, LecturerState>();
  for (const lecturerId of lecturerIds) {
    states.set(lecturerId, {
      lecturerId,
      groupCount: 0,
      studentCount: 0,
      groups: [],
      clusterCounts: new Map<string, number>(),
    });
  }

  const clusterOf = (group: AssignmentGroupInput): string =>
    group.sourceWorkbookId?.trim() || "_default";

  // Gom nhóm theo cluster (bảng điểm)
  const clusterGroups = new Map<string, AssignmentGroupInput[]>();
  for (const group of groups) {
    const cid = clusterOf(group);
    const list = clusterGroups.get(cid) ?? [];
    list.push(group);
    clusterGroups.set(cid, list);
  }

  // Sắp xếp các cluster theo độ hạn chế (MRV: cụm có ít GV đủ điều kiện hơn sẽ được xếp trước)
  const clusterList = Array.from(clusterGroups.entries()).map(([clusterId, clusterItems]) => {
    const eligibleLecturersCount = lecturerIds.filter((lId) =>
      clusterItems.some((g) => !(g.excludedLecturerIds ?? []).includes(lId)),
    ).length;
    return {
      clusterId,
      groups: clusterItems,
      eligibleLecturersCount,
      totalGroups: clusterItems.length,
      totalStudents: clusterItems.reduce((acc, g) => acc + g.studentCount, 0),
    };
  });

  clusterList.sort((a, b) => {
    if (a.eligibleLecturersCount !== b.eligibleLecturersCount) {
      return a.eligibleLecturersCount - b.eligibleLecturersCount;
    }
    if (b.totalGroups !== a.totalGroups) {
      return b.totalGroups - a.totalGroups;
    }
    return a.clusterId.localeCompare(b.clusterId);
  });

  const totalGroupsCount = groups.length;
  const numLecturers = lecturerIds.length;
  const targetGroupsMax = Math.ceil(totalGroupsCount / numLecturers);
  const targetStudents =
    groups.reduce((acc, g) => acc + g.studentCount, 0) / numLecturers;

  const assignments: Record<string, string> = {};
  const unassignedGroupIds: string[] = [];

  for (const cluster of clusterList) {
    // Sắp xếp nhóm trong cluster
    const sortedInCluster = [...cluster.groups].sort((a, b) => {
      if (mode === "students") {
        if (b.studentCount !== a.studentCount) return b.studentCount - a.studentCount;
      }
      return a.groupCode.localeCompare(b.groupCode, "vi");
    });

    for (const group of sortedInCluster) {
      const excluded = new Set(group.excludedLecturerIds ?? []);
      const eligibleIds = lecturerIds.filter((id) => !excluded.has(id));

      if (eligibleIds.length === 0) {
        unassignedGroupIds.push(group.id);
        continue;
      }

      const cid = clusterOf(group);
      let chosenCandidateId: string | null = null;

      if (cid !== "_default") {
        // TIER 1: Các GV đã có nhóm trong cluster này VÀ chưa đạt ngưỡng quota
        const tier1 = eligibleIds.filter((id) => {
          const s = states.get(id)!;
          const hasInCluster = (s.clusterCounts.get(cid) ?? 0) > 0;
          if (!hasInCluster) return false;
          if (mode === "groups") {
            return s.groupCount < targetGroupsMax;
          }
          return s.studentCount < targetStudents;
        });

        if (tier1.length > 0) {
          // Ưu tiên GV trong Tier 1 có tải trọng thấp nhất
          tier1.sort((a, b) => {
            const sa = states.get(a)!;
            const sb = states.get(b)!;
            if (mode === "groups") {
              if (sa.groupCount !== sb.groupCount) return sa.groupCount - sb.groupCount;
              return sa.studentCount - sb.studentCount;
            }
            if (sa.studentCount !== sb.studentCount) return sa.studentCount - sb.studentCount;
            return sa.groupCount - sb.groupCount;
          });
          chosenCandidateId = tier1[0];
        } else {
          // TIER 2: Chọn GV bắt đầu nhận cụm này theo nguyên lý Bin Packing:
          // 2a. Nếu có GV đang nhận dở dang (0 < groupCount < targetGroupsMax), ưu tiên lấp đầy GV này
          //     để họ đạt đủ quota và đóng gói (không bị phân tán thêm sang bảng điểm thứ 3, thứ 4).
          // 2b. Nếu không có GV nào dở dang, chọn GV mới tinh (groupCount === 0).
          // 2c. Nếu tất cả đều đã đạt quota, chọn GV có tải trọng thấp nhất.
          const underQuota = eligibleIds.filter((id) => {
            const s = states.get(id)!;
            if (mode === "groups") return s.groupCount < targetGroupsMax;
            return s.studentCount < targetStudents;
          });

          const candidatesForTier2 = underQuota.length > 0 ? underQuota : eligibleIds;

          // Phân loại dở dang vs mới tinh
          const partiallyFilled = candidatesForTier2.filter((id) => {
            const s = states.get(id)!;
            return s.groupCount > 0 && s.groupCount < targetGroupsMax;
          });

          if (partiallyFilled.length > 0) {
            // Lấp đầy người gần đủ quota nhất trước
            partiallyFilled.sort((a, b) => {
              const sa = states.get(a)!;
              const sb = states.get(b)!;
              if (mode === "groups") {
                if (sb.groupCount !== sa.groupCount) return sb.groupCount - sa.groupCount; // cao hơn xếp trước (để đóng gói trước)
              } else {
                if (sb.studentCount !== sa.studentCount) return sb.studentCount - sa.studentCount;
              }
              return lecturerIds.indexOf(a) - lecturerIds.indexOf(b);
            });
            chosenCandidateId = partiallyFilled[0];
          } else {
            // Chọn GV mới tinh (0 nhóm)
            candidatesForTier2.sort((a, b) => {
              const sa = states.get(a)!;
              const sb = states.get(b)!;
              if (mode === "groups") {
                if (sa.groupCount !== sb.groupCount) return sa.groupCount - sb.groupCount;
                if (sa.studentCount !== sb.studentCount) return sa.studentCount - sb.studentCount;
              } else {
                if (sa.studentCount !== sb.studentCount) return sa.studentCount - sb.studentCount;
                if (sa.groupCount !== sb.groupCount) return sa.groupCount - sb.groupCount;
              }
              return lecturerIds.indexOf(a) - lecturerIds.indexOf(b);
            });
            chosenCandidateId = candidatesForTier2[0];
          }
        }
      } else {
        // Fallback khi không có cluster (cid === "_default")
        const candidates = [...eligibleIds].sort((a, b) => {
          const sa = states.get(a)!;
          const sb = states.get(b)!;
          if (mode === "groups") {
            if (sa.groupCount !== sb.groupCount) return sa.groupCount - sb.groupCount;
            if (sa.studentCount !== sb.studentCount) return sa.studentCount - sb.studentCount;
          } else {
            if (sa.studentCount !== sb.studentCount) return sa.studentCount - sb.studentCount;
            if (sa.groupCount !== sb.groupCount) return sa.groupCount - sb.groupCount;
          }
          return lecturerIds.indexOf(a) - lecturerIds.indexOf(b);
        });
        chosenCandidateId = candidates[0];
      }

      // Gán nhóm
      assignments[group.id] = chosenCandidateId;
      const chosenState = states.get(chosenCandidateId)!;
      chosenState.groupCount += 1;
      chosenState.studentCount += group.studentCount;
      chosenState.groups.push(group);
      chosenState.clusterCounts.set(cid, (chosenState.clusterCounts.get(cid) ?? 0) + 1);
    }
  }

  // --- BƯỚC TINH CHỈNH 1: CÂN BẰNG TẢI TRỌNG (Workload Leveling) ---
  if (mode === "groups") {
    let changed = true;
    let iteration = 0;
    while (changed && iteration < 30) {
      changed = false;
      iteration += 1;

      // Tìm GV nhiều nhóm nhất và ít nhóm nhất
      let maxState: LecturerState | null = null;
      let minState: LecturerState | null = null;

      for (const id of lecturerIds) {
        const s = states.get(id)!;
        if (!maxState || s.groupCount > maxState.groupCount) maxState = s;
        if (!minState || s.groupCount < minState.groupCount) minState = s;
      }

      if (maxState && minState && maxState.groupCount - minState.groupCount > 1) {
        // Thử chuyển 1 nhóm từ maxState sang minState
        let candidateGroup: AssignmentGroupInput | null = null;

        // Ưu tiên chuyển nhóm thuộc cluster mà minState đã có hoặc làm giảm cluster của maxState
        for (const g of maxState.groups) {
          const excluded = new Set(g.excludedLecturerIds ?? []);
          if (!excluded.has(minState.lecturerId)) {
            candidateGroup = g;
            const cid = clusterOf(g);
            if (minState.clusterCounts.has(cid)) {
              // Nhóm này minState đã phụ trách bảng điểm đó -> lựa chọn hoàn hảo!
              break;
            }
          }
        }

        if (candidateGroup) {
          // Thực hiện chuyển
          const g = candidateGroup;
          const fromState = maxState;
          const toState = minState;
          const cid = clusterOf(g);

          assignments[g.id] = toState.lecturerId;

          fromState.groupCount -= 1;
          fromState.studentCount -= g.studentCount;
          fromState.groups = fromState.groups.filter((item) => item.id !== g.id);
          const fromCount = (fromState.clusterCounts.get(cid) ?? 1) - 1;
          if (fromCount <= 0) fromState.clusterCounts.delete(cid);
          else fromState.clusterCounts.set(cid, fromCount);

          toState.groupCount += 1;
          toState.studentCount += g.studentCount;
          toState.groups.push(g);
          toState.clusterCounts.set(cid, (toState.clusterCounts.get(cid) ?? 0) + 1);

          changed = true;
        }
      }
    }
  }

  // --- BƯỚC TINH CHỈNH 2: GOM CỤM BẢNG ĐIỂM (Defragmentation 2-Opt Swaps) ---
  // Hoán đổi giữa 2 GV nếu giữ nguyên số nhóm/sinh viên nhưng GIẢM số bảng điểm phụ trách
  let swapChanged = true;
  let swapIteration = 0;

  while (swapChanged && swapIteration < 50) {
    swapChanged = false;
    swapIteration += 1;

    for (let i = 0; i < lecturerIds.length; i += 1) {
      for (let j = i + 1; j < lecturerIds.length; j += 1) {
        const s1 = states.get(lecturerIds[i])!;
        const s2 = states.get(lecturerIds[j])!;

        for (const g1 of s1.groups) {
          const c1 = clusterOf(g1);
          if (c1 === "_default") continue;

          const exc2 = new Set(g1.excludedLecturerIds ?? []);
          if (exc2.has(s2.lecturerId)) continue;

          for (const g2 of s2.groups) {
            const c2 = clusterOf(g2);
            if (c2 === "_default" || c1 === c2) continue; // Cùng bảng điểm thì không cần đổi

            const exc1 = new Set(g2.excludedLecturerIds ?? []);
            if (exc1.has(s1.lecturerId)) continue;

            if (mode === "students" && Math.abs(g1.studentCount - g2.studentCount) > 1) {
              continue;
            }

            // Đếm số cluster hiện tại của s1 và s2
            const currentDistinct = s1.clusterCounts.size + s2.clusterCounts.size;

            // Tính số cluster dự kiến nếu hoán đổi g1 và g2
            const s1Counts = new Map(s1.clusterCounts);
            const count1_c1 = (s1Counts.get(c1) ?? 1) - 1;
            if (count1_c1 <= 0) s1Counts.delete(c1);
            else s1Counts.set(c1, count1_c1);
            s1Counts.set(c2, (s1Counts.get(c2) ?? 0) + 1);

            const s2Counts = new Map(s2.clusterCounts);
            const count2_c2 = (s2Counts.get(c2) ?? 1) - 1;
            if (count2_c2 <= 0) s2Counts.delete(c2);
            else s2Counts.set(c2, count2_c2);
            s2Counts.set(c1, (s2Counts.get(c1) ?? 0) + 1);

            const newDistinct = s1Counts.size + s2Counts.size;

            if (newDistinct < currentDistinct) {
              // Hoán đổi thành công làm giảm phân tán bảng điểm!
              assignments[g1.id] = s2.lecturerId;
              assignments[g2.id] = s1.lecturerId;

              s1.studentCount += g2.studentCount - g1.studentCount;
              s2.studentCount += g1.studentCount - g2.studentCount;

              s1.groups = s1.groups.filter((g) => g.id !== g1.id).concat(g2);
              s2.groups = s2.groups.filter((g) => g.id !== g2.id).concat(g1);

              s1.clusterCounts = s1Counts;
              s2.clusterCounts = s2Counts;

              swapChanged = true;
              break;
            }
          }
          if (swapChanged) break;
        }
        if (swapChanged) break;
      }
      if (swapChanged) break;
    }
  }

  const workload = lecturerIds.map((lecturerId) => {
    const s = states.get(lecturerId)!;
    return {
      lecturerId,
      groupCount: s.groupCount,
      studentCount: s.studentCount,
      workbookIds: Array.from(s.clusterCounts.keys()).filter((k) => k !== "_default"),
    };
  });

  return { assignments, workload, unassignedGroupIds };
}
