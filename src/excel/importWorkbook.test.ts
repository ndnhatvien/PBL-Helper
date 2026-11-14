import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  analyzeWorkbook,
  detectMapping,
  findCrossFileDuplicateIssues,
  mergeDuplicatePendingWorkbooks,
  parseRowsWithMapping,
  pendingHasBlockingErrors,
} from "./importWorkbook";
import { buildFinalExports } from "./finalExport";
import {
  addBatch,
  autoCreateGroupsFromSource,
  commitSourceWorkbooks,
  deleteLecturer,
  deleteSourceWorkbook,
  renameLecturer,
  resetAndRecreateGroupsFromSource,
  updateSourceWorkbookAdvisors,
} from "../store/actions";
import { createEmptyData } from "../store/store";
import { buildScenario } from "../test/scenario";
import { arrayBufferToBase64 } from "../utils/base64";
import type { PendingWorkbook } from "../types";
import {
  makeSourceWorkbook,
  makeTestBatch,
  pendingFrom,
  readWorkbook,
  sheetMatrix,
  type TestStudentInput,
} from "../test/helpers";

const sampleStudents: TestStudentInput[] = [
  { mssv: "1001", name: "Nguyễn Văn An", className: "24DT1" },
  { mssv: "1002", name: "Trần Thị Bình", className: "24DT1" },
];

describe("đọc file Excel mẫu", () => {
  it("đọc đúng sheet, header, mapping, metadata và 36 sinh viên", () => {
    const filePath = path.resolve(process.cwd(), "mau", "Bang_diem_106337026102438B_CK.xlsx");
    const bytes = new Uint8Array(readFileSync(filePath));
    const pending = analyzeWorkbook({
      fileName: "Bang_diem_106337026102438B_CK.xlsx",
      fileSize: bytes.byteLength,
      base64: arrayBufferToBase64(bytes.buffer as ArrayBuffer),
    }).pending;

    expect(pending.sheetName).toBe("Bảng điểm thành phần");
    expect(pending.headerRow).toBe(2);
    expect(pending.mapping).toEqual({
      mssv: 1,
      name: 2,
      className: 3,
      courseCode: null,
      courseName: null,
      groupCode: 4,
      advisor: null,
      score: 5,
    });
    expect(pending.metaCourseCode).toBe("106337026102438B");
    expect(pending.metaCourseName).toBe("PBL 2: Thiết kế mạch điện tử");
    expect(pending.rows).toHaveLength(36);
    expect(pending.rows[0]?.mssv).toBe("106210004");
    expect(pending.rows[0]?.courseCode).toBe("106337026102438B");
    expect(pending.rows[35]?.mssv).toBe("106240207");
    expect(pending.errors).toEqual([]);
    expect(pending.warnings.join(" ")).toContain("lặp lại tiêu đề");
    expect(pendingHasBlockingErrors(pending)).toBe(false);
    expect(pending.sourceTemplate).toBe("bang_diem");
  });

  it("đọc toàn bộ 7 file mẫu DSTS trong ./mau/Danh sachs PBL2/ và xuất điểm lại đúng cột Điểm (Số)", () => {
    const dirPath = path.resolve(process.cwd(), "mau", "Danh sachs PBL2");
    const fileNames = readdirSync(dirPath)
      .filter((f) => f.endsWith(".xlsx"))
      .sort();
    expect(fileNames).toHaveLength(7);

    const pendings = fileNames.map((fileName) => {
      const bytes = new Uint8Array(readFileSync(path.join(dirPath, fileName)));
      return analyzeWorkbook({
        fileName,
        fileSize: bytes.byteLength,
        base64: arrayBufferToBase64(bytes.buffer as ArrayBuffer),
      }).pending;
    });

    for (const pending of pendings) {
      expect(pending.sourceTemplate).toBe("dsts");
      expect(pending.headerRow).toBe(9);
      expect(pending.mapping.mssv).toBe(1);
      expect(pending.mapping.name).toBe(2);
      expect(pending.mapping.className).toBe(3);
      expect(pending.mapping.score).toBe(5);
      expect(pending.headers[6]).toBe("Điểm (Chữ)");
      expect(pending.metaCourseCode).toBeTruthy();
      expect(pending.metaCourseName).toContain("PBL 2");
      expect(pending.metaLecturerName).toBeTruthy();
      expect(pendingHasBlockingErrors(pending)).toBe(false);
    }

    expect(pendings[0]?.metaCourseCode).toBe("106337026102438A");
    expect(pendings[0]?.metaLecturerName).toBe("Huỳnh Thanh Tùng");
    expect(pendings[0]?.rows).toHaveLength(42);

    const totalRows = pendings.reduce((sum, item) => sum + item.rows.length, 0);
    expect(totalRows).toBe(231);
    expect(findCrossFileDuplicateIssues(pendings, [])).toEqual([]);

    // Nhập vào đợt thi và kiểm tra tự động thêm 7 giảng viên từ metadata DSTS
    const batch = makeTestBatch("Đợt DSTS PBL2");
    const initialData = addBatch(createEmptyData(), batch);
    const committed = commitSourceWorkbooks(initialData, batch.id, pendings);
    expect(committed.error).toBeUndefined();
    expect(committed.data.students).toHaveLength(231);
    expect(committed.data.lecturers).toHaveLength(7);

    // Xuất lại điểm cho sinh viên đầu tiên của file DSTS đầu tiên
    const firstStudent = committed.data.students[0];
    const exported = buildFinalExports({
      batch,
      sourceWorkbooks: [committed.data.sourceWorkbooks[0]],
      students: committed.data.students.filter(
        (s) => s.sourceWorkbookId === committed.data.sourceWorkbooks[0].id,
      ),
      scores: [
        {
          id: "score_1",
          batchId: batch.id,
          studentId: firstStudent.id,
          value: 9.0,
          graderId: null,
          sourceFileName: "test.xlsx",
          updatedAt: new Date().toISOString(),
        },
      ],
      conflicts: [],
    });
    expect(exported.files).toHaveLength(1);
    expect(exported.reports[0]?.updatedRows).toBe(1);
    const outMatrix = sheetMatrix(
      readWorkbook(exported.files[0].buffer),
      committed.data.sourceWorkbooks[0].sheetName,
    );
    expect(outMatrix[firstStudent.sourceRowNumber - 1]?.[5]).toBe(9.0);
  });

  it("hỗ trợ mix giữa 2 mẫu (Bảng điểm thành phần + DSTS) và tự động gộp khi trùng lớp học phần", () => {
    const ckPath = path.resolve(process.cwd(), "mau", "Bang_diem_106337026102438B_CK.xlsx");
    const ckBytes = new Uint8Array(readFileSync(ckPath));
    const ckPending = analyzeWorkbook({
      fileName: "Bang_diem_106337026102438B_CK.xlsx",
      fileSize: ckBytes.byteLength,
      base64: arrayBufferToBase64(ckBytes.buffer as ArrayBuffer),
    }).pending;

    // Giả lập thầy cô đã điền mã nhóm vào file Bảng điểm thành phần 38B
    ckPending.rows[0].groupCode = "N38B_01";
    ckPending.rows[1].groupCode = "N38B_01";

    const dirPath = path.resolve(process.cwd(), "mau", "Danh sachs PBL2");
    const dstsFiles = readdirSync(dirPath)
      .filter((f) => f.endsWith(".xlsx"))
      .sort();
    const dstsPendings = dstsFiles.map((fileName) => {
      const bytes = new Uint8Array(readFileSync(path.join(dirPath, fileName)));
      return analyzeWorkbook({
        fileName,
        fileSize: bytes.byteLength,
        base64: arrayBufferToBase64(bytes.buffer as ArrayBuffer),
      }).pending;
    });

    // Mix tất cả: 1 file mẫu Bảng điểm (38B) + 7 file mẫu DSTS (trong đó có cả 38B trùng 36 SV)
    const mixedAll = [ckPending, ...dstsPendings];
    const crossBefore = findCrossFileDuplicateIssues(mixedAll, []);
    expect(crossBefore).toHaveLength(36);

    const merged = mergeDuplicatePendingWorkbooks(mixedAll, []);
    expect(merged.mergedStudentCount).toBe(36);
    expect(merged.removedFileNames).toEqual(["106337026102438B-_DSTS.xlsx"]);
    expect(merged.workbooks).toHaveLength(7);
    expect(findCrossFileDuplicateIssues(merged.workbooks, [])).toEqual([]);

    // File 38B giữ lại được bổ sung tên giảng viên từ mẫu DSTS và vẫn giữ mã nhóm từ mẫu Bảng điểm
    const kept38B = merged.workbooks.find(
      (wb) => wb.fileName === "Bang_diem_106337026102438B_CK.xlsx",
    );
    expect(kept38B?.metaLecturerName).toBe("Nguyễn Duy Nhật Viễn");
    expect(kept38B?.rows[0]?.groupCode).toBe("N38B_01");

    // Commit và tự tạo nhóm kèm GVHD mặc định từ metadata
    const batch = makeTestBatch("Đợt Mix 2 Mẫu");
    const initialData = addBatch(createEmptyData(), batch);
    const committed = commitSourceWorkbooks(initialData, batch.id, merged.workbooks);
    expect(committed.error).toBeUndefined();
    expect(committed.data.students).toHaveLength(231);
    expect(committed.data.lecturers).toHaveLength(7);

    const autoGroups = autoCreateGroupsFromSource(committed.data, batch.id);
    expect(autoGroups.createdCount).toBe(1);
    const createdGroup = autoGroups.data.groups.find((g) => g.groupCode === "N38B_01");
    const advisor = autoGroups.data.lecturers.find(
      (l) => l.id === createdGroup?.defaultAdvisorId,
    );
    expect(advisor?.displayName).toBe("Nguyễn Duy Nhật Viễn");
  });
});

describe("đọc nhiều file và phát hiện trùng MSSV", () => {
  it("import được dữ liệu từ hai file khác nhau", () => {
    const first = pendingFrom(
      makeSourceWorkbook("Bảng điểm A", "HP001", "PBL A", sampleStudents),
    );
    const second = pendingFrom(
      makeSourceWorkbook("Bảng điểm B", "HP002", "PBL B", [
        { mssv: "2001", name: "Lê Văn Cường", className: "24DT2" },
      ]),
    );
    expect(first.rows).toHaveLength(2);
    expect(second.rows).toHaveLength(1);
    expect(first.rows[0]?.courseName).toBe("PBL A");
    expect(second.rows[0]?.courseCode).toBe("HP002");
    expect(findCrossFileDuplicateIssues([first, second], [])).toEqual([]);
  });

  it("báo trùng MSSV giữa hai file trước khi nhập", () => {
    const first = pendingFrom(
      makeSourceWorkbook("Bảng điểm A", "HP001", "PBL A", sampleStudents),
    );
    const second = pendingFrom(
      makeSourceWorkbook("Bảng điểm B", "HP002", "PBL B", [
        { mssv: "1001", name: "Nguyễn Văn An (trùng)", className: "24DT2" },
      ]),
    );
    const issues = findCrossFileDuplicateIssues([first, second], []);
    expect(issues[0]).toContain("1001");
    expect(issues[0]).toContain("xuất hiện ở cả");
  });

  it("báo trùng MSSV trong cùng sheet và chặn nhập", () => {
    const pending = pendingFrom(
      makeSourceWorkbook("Bảng điểm A", "HP001", "PBL A", [
        { mssv: "1001", name: "An", className: "24DT1" },
        { mssv: "1001", name: "An lần 2", className: "24DT1" },
      ]),
    );
    expect(pending.rows.every((row) => row.errors.length > 0)).toBe(true);
    expect(pendingHasBlockingErrors(pending)).toBe(true);
  });

  it("báo MSSV trống và vẫn hiển thị dòng lỗi thay vì bỏ im lặng", () => {
    const result = parseRowsWithMapping(
      [
        ["MSSV", "Họ tên", "Lớp sinh hoạt"],
        ["", "Sinh viên thiếu mã", "24DT1"],
        ["1002", "Hợp lệ", "24DT1"],
      ],
      0,
      {
        mssv: 0,
        name: 1,
        className: 2,
        courseCode: null,
        courseName: null,
        groupCode: null,
        advisor: null,
        score: null,
      },
      null,
      null,
    );
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]?.errors[0]).toContain("MSSV trống");
    expect(result.rows[1]?.errors).toEqual([]);
  });

  it("phát hiện MSSV giả (placeholder) như 'N/A', 'chưa có' và báo lỗi chặn", () => {
    const result = parseRowsWithMapping(
      [
        ["MSSV", "Họ tên", "Lớp sinh hoạt"],
        ["N/A", "Sinh viên A", "24DT1"],
        ["chua co", "Sinh viên B", "24DT1"],
        ["1022001", "Sinh viên C", "24DT1"],
      ],
      0,
      {
        mssv: 0,
        name: 1,
        className: 2,
        courseCode: null,
        courseName: null,
        groupCode: null,
        advisor: null,
        score: null,
      },
      null,
      null,
    );
    expect(result.rows[0]?.errors[0]).toContain("giá trị giữ chỗ");
    expect(result.rows[1]?.errors[0]).toContain("giá trị giữ chỗ");
    expect(result.rows[2]?.errors).toEqual([]);
  });

  it("phát hiện bất thường định dạng MSSV: khoảng trắng ở giữa, nghi ngờ nhầm cột STT", () => {
    const result = parseRowsWithMapping(
      [
        ["MSSV", "Họ tên", "Lớp sinh hoạt"],
        ["102 2001", "Sinh viên có khoảng trắng", "24DT1"],
        ["1", "Sinh viên số 1", "24DT1"],
      ],
      0,
      {
        mssv: 0,
        name: 1,
        className: 2,
        courseCode: null,
        courseName: null,
        groupCode: null,
        advisor: null,
        score: null,
      },
      null,
      null,
    );
    expect(result.rows[0]?.warnings[0]).toContain("khoảng trắng ở giữa");
    expect(result.rows[1]?.warnings[0]).toContain("nhầm cột STT");
  });

  it("kiểm tra sơ bộ thông tin nhóm: phát hiện thiếu mã nhóm và nhóm 1 thành viên", () => {
    const result = parseRowsWithMapping(
      [
        ["MSSV", "Họ tên", "Lớp sinh hoạt", "Nhóm"],
        ["1001", "Nguyễn Văn An", "24DT1", "PBL01"],
        ["1002", "Trần Thị Bình", "24DT1", "PBL01"],
        ["1003", "Lê Văn Cường", "24DT1", "PBL02"], // Nhóm 1 SV
        ["1004", "Phạm Thị Dung", "24DT1", ""], // Thiếu nhóm
      ],
      0,
      {
        mssv: 0,
        name: 1,
        className: 2,
        courseCode: null,
        courseName: null,
        groupCode: 3,
        advisor: null,
        score: null,
      },
      null,
      null,
    );

    expect(result.validation.groupInspection.hasGroupColumn).toBe(true);
    expect(result.validation.groupInspection.groupCount).toBe(2);
    expect(result.validation.groupInspection.assignedStudentCount).toBe(3);
    expect(result.validation.groupInspection.missingGroupCount).toBe(1);
    expect(result.validation.groupInspection.singleStudentGroups).toContain("PBL02");
    expect(result.rows[3]?.warnings.some((w) => w.includes("Thiếu thông tin nhóm"))).toBe(true);
    expect(result.validation.hasRiskOfMisassignment).toBe(true);
    expect(result.validation.criticalNotes.length).toBeGreaterThan(0);
  });

  it("tự động tạo nhóm từ mã nhóm nguồn cho sinh viên hợp lệ", () => {
    const scenario = buildScenario();
    // Thêm sinh viên chưa vào nhóm có mã nhóm nguồn
    const student1 = {
      ...scenario.data.students[0],
      id: "stu_test_1",
      mssv: "9901",
      groupCodeFromSource: "AUTO_01",
    };
    const student2 = {
      ...scenario.data.students[0],
      id: "stu_test_2",
      mssv: "9902",
      groupCodeFromSource: "AUTO_01",
    };
    const studentNoGroup = {
      ...scenario.data.students[0],
      id: "stu_test_3",
      mssv: "9903",
      groupCodeFromSource: "",
    };

    const dataWithStudents = {
      ...scenario.data,
      students: [...scenario.data.students, student1, student2, studentNoGroup],
    };

    const autoResult = autoCreateGroupsFromSource(dataWithStudents, scenario.batch.id);
    expect(autoResult.createdCount).toBe(1);
    expect(autoResult.skippedCount).toBe(1); // 1 sinh viên thiếu nhóm

    const createdGroup = autoResult.data.groups.find((g) => g.groupCode === "AUTO_01");
    expect(createdGroup).toBeDefined();
    const members = autoResult.data.members.filter((m) => m.groupId === createdGroup!.id);
    expect(members).toHaveLength(2);
  });

  it("nhận diện cột GVHD và gán đúng advisor cho nhóm tự động", () => {
    const matrix = [
      ["STT", "MSSV", "Họ tên", "Lớp", "Nhóm", "GVHD"],
      [1, "101", "Nguyễn Văn A", "20DT1", "GRP01", "TS. Trần Văn B"],
      [2, "102", "Lê Văn C", "20DT1", "GRP01", "TS. Trần Văn B"],
    ];
    const headerRow = 0;
    const mapping = detectMapping(matrix[0].map(String));
    expect(mapping.advisor).toBe(5);

    const parsed = parseRowsWithMapping(matrix, headerRow, mapping, "HP01", "Học phần 1");
    expect(parsed.rows[0].advisorName).toBe("TS. Trần Văn B");
  });

  it("nhập file với GVHD đồng hướng dẫn và lọc bỏ chuỗi rỗng", () => {
    const scenario = buildScenario();
    const pendingWb: PendingWorkbook = {
      tempId: "pending_coadvisor",
      fileName: "test_coadvisor.xlsx",
      fileSize: 1024,
      originalBase64: "",
      sheetNames: ["Sheet1"],
      sheetName: "Sheet1",
      headerRow: 0,
      dataStartRow: 1,
      headers: ["MSSV", "Họ tên"],
      mapping: {
        mssv: 0,
        name: 1,
        className: null,
        courseCode: null,
        courseName: null,
        groupCode: null,
        advisor: null,
        score: null,
      },
      rows: [
        {
          sourceRowNumber: 1,
          mssv: "2011001",
          name: "Sinh viên Đồng hướng dẫn",
          className: "20DT1",
          courseCode: "",
          courseName: "",
          groupCode: "",
          originalRowData: [],
          errors: [],
          warnings: [],
        },
      ],
      metaCourseCode: null,
      metaCourseName: null,
      metaLecturerName: "ThS. Nguyễn Văn A",
      metaLecturerNames: ["ThS. Nguyễn Văn A", "TS. Lê Thị B", ""],
      errors: [],
      warnings: [],
    };

    const res = commitSourceWorkbooks(scenario.data, scenario.batch.id, [pendingWb]);
    expect(res.error).toBeUndefined();
    const wb = res.data.sourceWorkbooks.find((w) => w.fileName === "test_coadvisor.xlsx");
    expect(wb).toBeDefined();
    expect(wb?.metaLecturerNames).toEqual(["ThS. Nguyễn Văn A", "TS. Lê Thị B"]);
    expect(wb?.metaLecturerName).toBe("ThS. Nguyễn Văn A, TS. Lê Thị B");

    const lecturerNames = res.data.lecturers.map((l) => l.displayName);
    expect(lecturerNames).toContain("ThS. Nguyễn Văn A");
    expect(lecturerNames).toContain("TS. Lê Thị B");
    expect(lecturerNames).not.toContain("");
  });

  it("sửa GVHD của file nguồn đã nhập (updateSourceWorkbookAdvisors)", () => {
    const scenario = buildScenario();
    const wb = scenario.data.sourceWorkbooks[0];
    expect(wb).toBeDefined();

    // Sửa GVHD thành GVHD mới và thêm GVHD đồng hướng dẫn
    const updated = updateSourceWorkbookAdvisors(scenario.data, scenario.batch.id, wb.id, [
      "TS. Giảng Viên Mới",
      "ThS. Đồng Hướng Dẫn",
    ]);

    expect(updated.error).toBeUndefined();
    const targetWb = updated.data.sourceWorkbooks.find((w) => w.id === wb.id);
    expect(targetWb?.metaLecturerNames).toEqual(["TS. Giảng Viên Mới", "ThS. Đồng Hướng Dẫn"]);
    expect(targetWb?.metaLecturerName).toBe("TS. Giảng Viên Mới, ThS. Đồng Hướng Dẫn");

    // Giảng viên mới tự động được tạo trong đợt
    const lecNames = updated.data.lecturers.map((l) => l.displayName);
    expect(lecNames).toContain("TS. Giảng Viên Mới");
    expect(lecNames).toContain("ThS. Đồng Hướng Dẫn");
  });

  it("đổi tên giảng viên (renameLecturer) và đồng bộ sang file nguồn", () => {
    const scenario = buildScenario();
    const lecturer = scenario.data.lecturers[0];
    expect(lecturer).toBeDefined();

    const oldName = lecturer.displayName;
    const renamed = renameLecturer(scenario.data, scenario.batch.id, lecturer.id, "TS. Tên Sau Khi Sửa");
    expect(renamed.error).toBeUndefined();

    const updatedLec = renamed.data.lecturers.find((l) => l.id === lecturer.id);
    expect(updatedLec?.displayName).toBe("TS. Tên Sau Khi Sửa");

    // File nguồn có chứa tên cũ được cập nhật sang tên mới
    for (const wb of renamed.data.sourceWorkbooks) {
      if (wb.metaLecturerNames?.includes(oldName)) {
        throw new Error("File nguồn vẫn còn tên cũ");
      }
    }
  });

  it("xóa file nguồn đã nhập và dọn sạch sinh viên liên quan (deleteSourceWorkbook)", () => {
    const scenario = buildScenario();
    const wb = scenario.data.sourceWorkbooks[0];
    expect(wb).toBeDefined();

    const deleted = deleteSourceWorkbook(scenario.data, wb.id);
    expect(deleted.error).toBeUndefined();
    expect(deleted.data.sourceWorkbooks.find((w) => w.id === wb.id)).toBeUndefined();

    // Không còn sinh viên nào thuộc workbook bị xóa
    const studentsInDeleted = deleted.data.students.filter((s) => s.sourceWorkbookId === wb.id);
    expect(studentsInDeleted).toHaveLength(0);
  });

  it("xóa giảng viên chưa phân công (deleteLecturer)", () => {
    const scenario = buildScenario();
    // Tạo 1 giảng viên mới chưa gắn với nhóm hay file nào
    const newLec = {
      id: "lec_test_unused",
      batchId: scenario.batch.id,
      displayName: "TS. Chưa Phân Công",
      email: "",
      active: true,
      room: "",
    };
    const dataWithLec = {
      ...scenario.data,
      lecturers: [...scenario.data.lecturers, newLec],
    };

    const deleted = deleteLecturer(dataWithLec, scenario.batch.id, "lec_test_unused");
    expect(deleted.error).toBeUndefined();
    expect(deleted.data.lecturers.find((l) => l.id === "lec_test_unused")).toBeUndefined();
  });

  it("phân tách nhóm chính xác khi nhiều bảng điểm có cùng mã nhóm (không bị gộp nhầm thành ít nhóm hơn)", () => {
    const batch = makeTestBatch("Đợt 3 Bảng Điểm");
    let data = addBatch(createEmptyData(), batch);

    // Tạo 3 bảng điểm (Lớp 21.11, Lớp 21.12, Lớp 21.13)
    // Mỗi lớp đều có Nhóm 1 và Nhóm 2 -> Tổng cộng phải là 6 nhóm độc lập
    const students = [
      // Bảng điểm 1
      { mssv: "101", name: "SV 1A", className: "21Nh11", courseCode: "21.11", groupCode: "1", advisorName: "GVHD A", sourceRowNumber: 1, errors: [], warnings: [], originalRowData: [] },
      { mssv: "102", name: "SV 2A", className: "21Nh11", courseCode: "21.11", groupCode: "2", advisorName: "GVHD A", sourceRowNumber: 2, errors: [], warnings: [], originalRowData: [] },
      // Bảng điểm 2
      { mssv: "201", name: "SV 1B", className: "21Nh12", courseCode: "21.12", groupCode: "1", advisorName: "GVHD B", sourceRowNumber: 1, errors: [], warnings: [], originalRowData: [] },
      { mssv: "202", name: "SV 2B", className: "21Nh12", courseCode: "21.12", groupCode: "2", advisorName: "GVHD B", sourceRowNumber: 2, errors: [], warnings: [], originalRowData: [] },
      // Bảng điểm 3
      { mssv: "301", name: "SV 1C", className: "21Nh13", courseCode: "21.13", groupCode: "1", advisorName: "GVHD C", sourceRowNumber: 1, errors: [], warnings: [], originalRowData: [] },
      { mssv: "302", name: "SV 2C", className: "21Nh13", courseCode: "21.13", groupCode: "2", advisorName: "GVHD C", sourceRowNumber: 2, errors: [], warnings: [], originalRowData: [] },
    ];

    const wb1: PendingWorkbook = {
      tempId: "p1", fileName: "LHP_21.11.xlsx", fileSize: 1024, originalBase64: "", sheetNames: ["S1"], sheetName: "S1",
      headerRow: 0, dataStartRow: 1, headers: ["MSSV"], mapping: { mssv: 0, name: null, className: null, courseCode: null, courseName: null, groupCode: null, advisor: null, score: null },
      rows: students.slice(0, 2), metaCourseCode: "21.11", metaLecturerName: "GVHD A", errors: [], warnings: [],
    };
    const wb2: PendingWorkbook = {
      tempId: "p2", fileName: "LHP_21.12.xlsx", fileSize: 1024, originalBase64: "", sheetNames: ["S1"], sheetName: "S1",
      headerRow: 0, dataStartRow: 1, headers: ["MSSV"], mapping: { mssv: 0, name: null, className: null, courseCode: null, courseName: null, groupCode: null, advisor: null, score: null },
      rows: students.slice(2, 4), metaCourseCode: "21.12", metaLecturerName: "GVHD B", errors: [], warnings: [],
    };
    const wb3: PendingWorkbook = {
      tempId: "p3", fileName: "LHP_21.13.xlsx", fileSize: 1024, originalBase64: "", sheetNames: ["S1"], sheetName: "S1",
      headerRow: 0, dataStartRow: 1, headers: ["MSSV"], mapping: { mssv: 0, name: null, className: null, courseCode: null, courseName: null, groupCode: null, advisor: null, score: null },
      rows: students.slice(4, 6), metaCourseCode: "21.13", metaLecturerName: "GVHD C", errors: [], warnings: [],
    };

    const commitRes = commitSourceWorkbooks(data, batch.id, [wb1, wb2, wb3]);
    expect(commitRes.error).toBeUndefined();
    data = commitRes.data;

    // Tự động tạo nhóm từ nguồn
    const autoRes = autoCreateGroupsFromSource(data, batch.id);
    expect(autoRes.createdCount).toBe(6); // Đúng 6 nhóm (không bị gộp thành 2 nhóm!)
    data = autoRes.data;

    const batchGroups = data.groups.filter((g) => g.batchId === batch.id);
    expect(batchGroups).toHaveLength(6);

    // Kiểm tra tên nhóm được gắn tiền tố mã học phần rõ ràng
    const groupCodes = batchGroups.map((g) => g.groupCode).sort();
    expect(groupCodes).toContain("21.11 - Nhóm 1");
    expect(groupCodes).toContain("21.11 - Nhóm 2");
    expect(groupCodes).toContain("21.12 - Nhóm 1");
    expect(groupCodes).toContain("21.12 - Nhóm 2");
    expect(groupCodes).toContain("21.13 - Nhóm 1");
    expect(groupCodes).toContain("21.13 - Nhóm 2");

    // Kiểm tra tính năng reset và làm mới lại nhóm
    const resetRes = resetAndRecreateGroupsFromSource(data, batch.id);
    expect(resetRes.error).toBeUndefined();
    expect(resetRes.createdCount).toBe(6);
    expect(resetRes.data.groups.filter((g) => g.batchId === batch.id)).toHaveLength(6);
  });
});
