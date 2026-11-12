import type { ExamBatch, Lecturer } from "../types";
import type { AppData } from "../store/store";
import { createEmptyData } from "../store/store";
import {
  addBatch,
  applyAssignments,
  commitSourceWorkbooks,
  createGroup,
  updateMemberOverride,
} from "../store/actions";
import { createId } from "../utils/id";
import { makeSourceWorkbook, makeTestBatch, pendingFrom } from "./helpers";

export interface TestScenario {
  batch: ExamBatch;
  data: AppData;
  lecturers: { advisorA: Lecturer; advisorB: Lecturer; graderC: Lecturer };
  groupId: string;
  studentAId: string;
  studentBId: string;
  memberBId: string;
}

/**
 * Kịch bản chuẩn của spec mục 11:
 * 2 file nguồn, nhóm 2 sinh viên từ 2 file, GVHD mặc định A,
 * override GVHD B cho sinh viên thứ hai, giảng viên chấm C.
 */
export function buildScenario(): TestScenario {
  const batch = makeTestBatch();
  let data = addBatch(createEmptyData(), batch);

  const fileA = makeSourceWorkbook("Bảng điểm A", "HP001", "PBL Thiết kế mạch", [
    { mssv: "1001", name: "Nguyễn Văn An", className: "24DT1" },
  ]);
  const fileB = makeSourceWorkbook("Bảng điểm B", "HP002", "PBL Hệ thống nhúng", [
    { mssv: "2001", name: "Trần Thị Bình", className: "24DT2" },
  ]);

  const imported = commitSourceWorkbooks(data, batch.id, [
    pendingFrom(fileA),
    pendingFrom(fileB),
  ]);
  if (imported.error) throw new Error(imported.error);
  data = imported.data;

  const advisorA: Lecturer = {
    id: createId("lec"),
    batchId: batch.id,
    displayName: "GVHD Nguyễn A",
    email: "a@example.edu.vn",
    active: true,
  };
  const advisorB: Lecturer = {
    id: createId("lec"),
    batchId: batch.id,
    displayName: "GVHD Trần B",
    email: "b@example.edu.vn",
    active: true,
  };
  const graderC: Lecturer = {
    id: createId("lec"),
    batchId: batch.id,
    displayName: "GV Chấm C",
    email: "c@example.edu.vn",
    active: true,
    room: "F201",
  };
  data = {
    ...data,
    lecturers: [...data.lecturers, advisorA, advisorB, graderC],
  };

  const studentA = data.students.find(
    (student) => student.batchId === batch.id && student.mssv === "1001",
  );
  const studentB = data.students.find(
    (student) => student.batchId === batch.id && student.mssv === "2001",
  );
  if (!studentA || !studentB) throw new Error("Thiếu sinh viên test");

  const created = createGroup(
    data,
    batch.id,
    "PBL01",
    [studentA.id, studentB.id],
    advisorA.id,
  );
  if (created.error) throw new Error(created.error);
  data = created.data;

  const group = data.groups.find(
    (item) => item.batchId === batch.id && item.groupCode === "PBL01",
  );
  const memberB = data.members.find((member) => member.studentId === studentB.id);
  if (!group || !memberB) throw new Error("Thiếu nhóm test");

  const overridden = updateMemberOverride(data, memberB.id, advisorB.id);
  if (overridden.error) throw new Error(overridden.error);
  data = overridden.data;

  data = applyAssignments(data, { [group.id]: graderC.id });

  return {
    batch,
    data,
    lecturers: { advisorA, advisorB, graderC },
    groupId: group.id,
    studentAId: studentA.id,
    studentBId: studentB.id,
    memberBId: memberB.id,
  };
}
