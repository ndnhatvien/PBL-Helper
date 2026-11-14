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
 * 3. Cân bằng khối lượng tuyệt đối:
 *    - Chế độ "groups" (mặc định): Chênh lệch số nhóm giữa các GV tối đa <= 1 (công bằng tuyệt đối).
 *    - Chế độ "students": Cân bằng số sinh viên, đồng thời giữ chênh lệch số nhóm <= 2.
 * 4. Gom cụm theo bảng điểm (Bin Packing & Block Consolidation):
 *    - Ưu tiên tối đa 1 giảng viên chấm các nhóm thuộc cùng 1 bảng điểm.
 *    - Chống bỏ đói giảng viên hướng dẫn (Anti-Starvation): Giảng viên hướng dẫn các lớp lớn
 *      được ưu tiên nhận các bảng điểm khác sớm để không bị dồn mảnh vụn về sau.
 * 5. Tinh chỉnh đa chặng (Multi-hop BFS Augmenting Path) đảm bảo đạt mức cân bằng tối ưu toán học.
 */
export function suggestAssignment(
  groups: AssignmentGroupInput[],
  lecturerIds: string[],
  mode: BalanceMode = "groups",
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

  for (let clusterIdx = 0; clusterIdx < clusterList.length; clusterIdx += 1) {
    const cluster = clusterList[clusterIdx];

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
          // TIER 2: Chọn GV bắt đầu nhận cụm này:
          // 2a. Nếu có GV đang nhận dở dang (0 < groupCount < targetGroupsMax), ưu tiên lấp đầy
          // 2b. Nếu chọn GV mới tinh (groupCount === 0), dùng chiến lược Anti-Starvation (Least Slack):
          //     Người nào có ít cơ hội chấm ở các bảng điểm còn lại sẽ được ưu tiên nhận trước!
          const underQuota = eligibleIds.filter((id) => {
            const s = states.get(id)!;
            if (mode === "groups") return s.groupCount < targetGroupsMax;
            return s.studentCount < targetStudents;
          });

          const candidatesForTier2 = underQuota.length > 0 ? underQuota : eligibleIds;

          const partiallyFilled = candidatesForTier2.filter((id) => {
            const s = states.get(id)!;
            return s.groupCount > 0 && s.groupCount < targetGroupsMax;
          });

          if (partiallyFilled.length > 0) {
            partiallyFilled.sort((a, b) => {
              const sa = states.get(a)!;
              const sb = states.get(b)!;
              if (mode === "groups") {
                if (sb.groupCount !== sa.groupCount) return sb.groupCount - sa.groupCount;
              } else {
                if (sb.studentCount !== sa.studentCount) return sb.studentCount - sa.studentCount;
              }
              return lecturerIds.indexOf(a) - lecturerIds.indexOf(b);
            });
            chosenCandidateId = partiallyFilled[0];
          } else {
            // Tính số nhóm ở các cụm còn lại mà mỗi ứng viên có thể nhận (Anti-Starvation)
            const remainingClusters = clusterList.slice(clusterIdx);
            const futureSlack = new Map<string, number>();

            for (const candId of candidatesForTier2) {
              let eligibleFutureGroups = 0;
              for (const rc of remainingClusters) {
                const hasExclusion = rc.groups.some((g) =>
                  (g.excludedLecturerIds ?? []).includes(candId),
                );
                if (!hasExclusion) {
                  eligibleFutureGroups += rc.totalGroups;
                }
              }
              const s = states.get(candId)!;
              const needed = targetGroupsMax - s.groupCount;
              futureSlack.set(candId, eligibleFutureGroups - needed);
            }

            candidatesForTier2.sort((a, b) => {
              const sa = states.get(a)!;
              const sb = states.get(b)!;

              // Ưu tiên người có ít dư địa tương lai nhất (ít slack nhất) để không bị đói
              const slackA = futureSlack.get(a) ?? 0;
              const slackB = futureSlack.get(b) ?? 0;
              if (slackA !== slackB) return slackA - slackB;

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
        // Fallback khi không có thông tin bảng điểm (cid === "_default")
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

  // --- BƯỚC TINH CHỈNH 1: CÂN BẰNG TẢI TRỌNG CHẶT CHẼ (Multi-hop BFS Augmenting Path) ---
  // Tìm đường chuyển nhóm từ GV có nhiều nhóm nhất sang GV có ít nhóm nhất cho đến khi chênh lệch <= 1
  let changed = true;
  let iteration = 0;
  while (changed && iteration < 200) {
    changed = false;
    iteration += 1;

    let maxState: LecturerState | null = null;
    let minState: LecturerState | null = null;

    for (const id of lecturerIds) {
      const s = states.get(id)!;
      if (!maxState || s.groupCount > maxState.groupCount) maxState = s;
      if (!minState || s.groupCount < minState.groupCount) minState = s;
    }

    if (!maxState || !minState) break;

    const allowedDiff = mode === "groups" ? 1 : 2;
    if (maxState.groupCount - minState.groupCount <= allowedDiff) break;

    interface TransferEdge {
      fromId: string;
      toId: string;
      group: AssignmentGroupInput;
    }

    const queue: string[] = [maxState.lecturerId];
    const visited = new Set<string>([maxState.lecturerId]);
    const parentEdge = new Map<string, TransferEdge>();
    let destId: string | null = null;

    while (queue.length > 0) {
      const currId = queue.shift()!;
      const currState = states.get(currId)!;

      if (currState.groupCount < maxState.groupCount - allowedDiff) {
        destId = currId;
        break;
      }

      for (const g of currState.groups) {
        const excluded = new Set(g.excludedLecturerIds ?? []);
        for (const nextId of lecturerIds) {
          if (nextId === currId || visited.has(nextId)) continue;
          if (excluded.has(nextId)) continue;

          visited.add(nextId);
          parentEdge.set(nextId, {
            fromId: currId,
            toId: nextId,
            group: g,
          });
          queue.push(nextId);
        }
      }
    }

    if (destId) {
      let cur = destId;
      while (cur !== maxState.lecturerId) {
        const edge = parentEdge.get(cur)!;
        const g = edge.group;
        const fromState = states.get(edge.fromId)!;
        const toState = states.get(edge.toId)!;
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

        cur = edge.fromId;
      }
      changed = true;
    }
  }

  // --- BƯỚC TINH CHỈNH 2: GOM CỤM BẢNG ĐIỂM (Block Defragmentation Swaps) ---
  // Hoán đổi khối nhóm giữa 2 GV nếu làm tăng độ tập trung bảng điểm (giảm phân tán)
  let swapChanged = true;
  let swapIteration = 0;

  while (swapChanged && swapIteration < 60) {
    swapChanged = false;
    swapIteration += 1;

    for (let i = 0; i < lecturerIds.length; i += 1) {
      for (let j = i + 1; j < lecturerIds.length; j += 1) {
        const s1 = states.get(lecturerIds[i])!;
        const s2 = states.get(lecturerIds[j])!;

        const clusters1 = Array.from(s1.clusterCounts.keys()).filter((k) => k !== "_default");
        const clusters2 = Array.from(s2.clusterCounts.keys()).filter((k) => k !== "_default");

        for (const c1 of clusters1) {
          for (const c2 of clusters2) {
            if (c1 === c2) continue;

            // Tìm các nhóm c1 thuộc s1 mà s2 đủ điều kiện chấm
            const c1Groups = s1.groups.filter(
              (g) => clusterOf(g) === c1 && !(g.excludedLecturerIds ?? []).includes(s2.lecturerId),
            );
            // Tìm các nhóm c2 thuộc s2 mà s1 đủ điều kiện chấm
            const c2Groups = s2.groups.filter(
              (g) => clusterOf(g) === c2 && !(g.excludedLecturerIds ?? []).includes(s1.lecturerId),
            );

            if (c1Groups.length === 0 || c2Groups.length === 0) continue;

            // Hoán đổi tối đa k nhóm
            const k = Math.min(c1Groups.length, c2Groups.length);
            const swap1 = c1Groups.slice(0, k);
            const swap2 = c2Groups.slice(0, k);

            if (mode === "students") {
              const st1 = swap1.reduce((sum, g) => sum + g.studentCount, 0);
              const st2 = swap2.reduce((sum, g) => sum + g.studentCount, 0);
              if (Math.abs(st1 - st2) > 3) continue;
            }

            // Tính độ tập trung trước hoán đổi (Sum of squared cluster counts)
            const count1_c1_before = s1.clusterCounts.get(c1) ?? 0;
            const count1_c2_before = s1.clusterCounts.get(c2) ?? 0;
            const count2_c1_before = s2.clusterCounts.get(c1) ?? 0;
            const count2_c2_before = s2.clusterCounts.get(c2) ?? 0;

            const scoreBefore =
              count1_c1_before * count1_c1_before +
              count1_c2_before * count1_c2_before +
              count2_c1_before * count2_c1_before +
              count2_c2_before * count2_c2_before;

            const count1_c1_after = count1_c1_before - k;
            const count1_c2_after = count1_c2_before + k;
            const count2_c1_after = count2_c1_before + k;
            const count2_c2_after = count2_c2_before - k;

            const scoreAfter =
              count1_c1_after * count1_c1_after +
              count1_c2_after * count1_c2_after +
              count2_c1_after * count2_c1_after +
              count2_c2_after * count2_c2_after;

            // Nếu hoán đổi làm tăng độ tập trung bảng điểm rõ rệt
            if (scoreAfter > scoreBefore) {
              const swap1Ids = new Set(swap1.map((g) => g.id));
              const swap2Ids = new Set(swap2.map((g) => g.id));

              for (const g of swap1) assignments[g.id] = s2.lecturerId;
              for (const g of swap2) assignments[g.id] = s1.lecturerId;

              const st1 = swap1.reduce((sum, g) => sum + g.studentCount, 0);
              const st2 = swap2.reduce((sum, g) => sum + g.studentCount, 0);

              s1.studentCount += st2 - st1;
              s2.studentCount += st1 - st2;

              s1.groups = s1.groups.filter((g) => !swap1Ids.has(g.id)).concat(swap2);
              s2.groups = s2.groups.filter((g) => !swap2Ids.has(g.id)).concat(swap1);

              if (count1_c1_after <= 0) s1.clusterCounts.delete(c1);
              else s1.clusterCounts.set(c1, count1_c1_after);
              s1.clusterCounts.set(c2, count1_c2_after);

              if (count2_c2_after <= 0) s2.clusterCounts.delete(c2);
              else s2.clusterCounts.set(c2, count2_c2_after);
              s2.clusterCounts.set(c1, count2_c1_after);

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
