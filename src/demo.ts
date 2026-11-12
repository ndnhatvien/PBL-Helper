import * as XLSX from "xlsx";
import type { Lecturer } from "./types";
import type { AppData } from "./store/store";
import { buildBatch } from "./store/store";
import {
  applyAssignments,
  commitSourceWorkbooks,
  createGroup,
  updateMemberOverride,
} from "./store/actions";
import { analyzeWorkbook } from "./excel/importWorkbook";
import { arrayBufferToBase64 } from "./utils/base64";
import { createId, nowIso } from "./utils/id";

interface DemoStudent {
  mssv: string;
  name: string;
  className: string;
}

function buildDemoWorkbook(
  title: string,
  courseCode: string,
  courseName: string,
  students: DemoStudent[],
): { fileName: string; base64: string; fileSize: number; sheetName: string } {
  const rows: unknown[][] = [
    [title],
    ["Mã lớp học phần", courseCode, "Tên lớp học phần", courseName],
    ["STT", "MSSV", "Họ tên", "Lớp sinh hoạt", "Nhóm", "CK"],
    ...students.map((student, index) => [
      index + 1,
      student.mssv,
      student.name,
      student.className,
      "",
      "",
    ]),
  ];
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = [
    { wch: 6 },
    { wch: 14 },
    { wch: 26 },
    { wch: 16 },
    { wch: 10 },
    { wch: 10 },
  ];
  XLSX.utils.book_append_sheet(workbook, sheet, "Bảng điểm thành phần");
  const buffer = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const fileName = `DEMO_${courseCode}_${title.includes("lớp A") ? "A" : "B"}.xlsx`;
  return {
    fileName,
    base64: arrayBufferToBase64(buffer),
    fileSize: buffer.byteLength,
    sheetName: "Bảng điểm thành phần",
  };
}

/**
 * Tạo đợt demo hoàn toàn tách biệt (batch.isDemo = true), đi qua đúng pipeline
 * đọc Excel → nhập sinh viên → tạo nhóm → gán GVHD → phân công GV chấm.
 */
export function createDemoData(source: AppData): { data: AppData; error?: string } {
  const batch = buildBatch(
    {
      name: "[DEMO] Đợt chấm PBL minh họa",
      term: "HK1 2026–2027",
      examDate: new Date().toISOString().slice(0, 10),
      note: "Dữ liệu minh họa, không dùng dữ liệu sinh viên thật.",
      scoreConfig: { min: 0, max: 10, decimals: 1, isDemoDefault: true },
    },
    true,
  );

  let data: AppData = {
    ...source,
    batches: [...source.batches, batch],
    activeBatchId: batch.id,
    currentRole: "coordinator",
    currentLecturerId: null,
  };

  const files = [
    buildDemoWorkbook(
      "Bảng điểm PBL - lớp A",
      "106337026102438B",
      "PBL 2: Thiết kế mạch điện tử",
      [
        { mssv: "DEMO001", name: "Nguyễn Văn An", className: "24DT1" },
        { mssv: "DEMO002", name: "Trần Thị Bình", className: "24DT1" },
        { mssv: "DEMO003", name: "Lê Minh Châu", className: "24DT2" },
      ],
    ),
    buildDemoWorkbook(
      "Bảng điểm PBL - lớp B",
      "106337026102439B",
      "PBL 2: Thiết kế hệ thống nhúng",
      [
        { mssv: "DEMO004", name: "Phạm Quốc Dũng", className: "24DT2" },
        { mssv: "DEMO005", name: "Hoàng Ngọc Em", className: "24DT3" },
        { mssv: "DEMO006", name: "Đỗ Gia Hân", className: "24DT3" },
      ],
    ),
  ];

  const pending = files.map((file) =>
    analyzeWorkbook({
      fileName: file.fileName,
      fileSize: file.fileSize,
      base64: file.base64,
      sheetName: file.sheetName,
    }).pending,
  );

  const imported = commitSourceWorkbooks(data, batch.id, pending);
  if (imported.error) return { data: source, error: imported.error };
  data = imported.data;

  const now = nowIso();
  const lecturers: Lecturer[] = [
    {
      id: createId("lec"),
      batchId: batch.id,
      displayName: "GVHD Nguyễn A",
      email: "gvhd.a@example.edu.vn",
      active: true,
      room: "F201",
    },
    {
      id: createId("lec"),
      batchId: batch.id,
      displayName: "GVHD Trần B",
      email: "gvhd.b@example.edu.vn",
      active: true,
      room: "F202",
    },
    {
      id: createId("lec"),
      batchId: batch.id,
      displayName: "GV Chấm C",
      email: "gv.c@example.edu.vn",
      active: true,
      room: "F203",
    },
  ];
  data = { ...data, lecturers: [...data.lecturers, ...lecturers] };
  const [advisorA, advisorB, graderC] = lecturers;

  const batchStudents = data.students.filter((student) => student.batchId === batch.id);
  const byMssv = new Map(batchStudents.map((student) => [student.mssv, student]));
  const ids = (mssvs: string[]) =>
    mssvs
      .map((mssv) => byMssv.get(mssv)?.id)
      .filter((id): id is string => Boolean(id));

  const group1 = createGroup(
    data,
    batch.id,
    "PBL01",
    ids(["DEMO001", "DEMO004"]),
    advisorA.id,
  );
  if (group1.error) return { data: source, error: group1.error };
  data = group1.data;

  const group2 = createGroup(
    data,
    batch.id,
    "PBL02",
    ids(["DEMO002", "DEMO003"]),
    advisorB.id,
  );
  if (group2.error) return { data: source, error: group2.error };
  data = group2.data;

  const group3 = createGroup(
    data,
    batch.id,
    "PBL03",
    ids(["DEMO005", "DEMO006"]),
    advisorA.id,
  );
  if (group3.error) return { data: source, error: group3.error };
  data = group3.data;

  const memberDemo004 = data.members.find(
    (member) => member.studentId === byMssv.get("DEMO004")?.id,
  );
  if (memberDemo004) {
    const overridden = updateMemberOverride(data, memberDemo004.id, advisorB.id);
    if (overridden.error) return { data: source, error: overridden.error };
    data = overridden.data;
  }

  const assignments: Record<string, string> = {};
  for (const group of data.groups.filter((item) => item.batchId === batch.id)) {
    assignments[group.id] = graderC.id;
  }
  data = applyAssignments(data, assignments);

  data = {
    ...data,
    importRuns: [
      ...data.importRuns,
      {
        id: createId("run"),
        batchId: batch.id,
        kind: "source",
        fileName: "DEMO_SEED",
        createdAt: now,
        status: "success",
        validationReport: [
          "Đã tạo dữ liệu demo: 2 file nguồn, 6 sinh viên, 3 nhóm, 2 GVHD và 1 giảng viên chấm.",
        ],
      },
    ],
  };

  return { data };
}
