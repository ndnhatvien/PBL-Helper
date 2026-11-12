import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { filterBatchContext } from "../domain/selectors";
import { buildGradedImportPreview } from "./gradedImport";
import { exportGraderWorkbooks, parseGradedWorkbook } from "./grader";
import { buildScenario } from "../test/scenario";
import { readWorkbook, rewriteGradedScores } from "../test/helpers";
import { addLecturer, commitGradedImport, updateLecturer } from "../store/actions";

function graderExport(scenario: ReturnType<typeof buildScenario>) {
  const context = filterBatchContext(scenario.data, scenario.batch.id);
  const files = exportGraderWorkbooks({
    batch: scenario.batch,
    students: context.students,
    groups: context.groups,
    members: context.members,
    lecturers: context.lecturers,
    scores: context.scores,
    graders: [scenario.lecturers.graderC],
  });
  expect(files).toHaveLength(1);
  return files[0];
}

function previewFor(
  scenario: ReturnType<typeof buildScenario>,
  files: ReturnType<typeof parseGradedWorkbook>[],
) {
  const context = filterBatchContext(scenario.data, scenario.batch.id);
  return buildGradedImportPreview({
    files,
    batch: scenario.batch,
    students: context.students,
    groups: context.groups,
    members: context.members,
    scores: context.scores,
    lecturers: context.lecturers,
  });
}

describe("xuất phiếu chấm", () => {
  it("mỗi file chỉ chứa nhóm được giao và có studentKey ẩn ổn định", () => {
    const scenario = buildScenario();
    const file = graderExport(scenario);
    expect(file.fileName).toContain("GV_Cham_C");
    expect(file.groupCount).toBe(1);
    expect(file.studentCount).toBe(2);

    const parsed = parseGradedWorkbook(file.buffer, file.fileName, scenario.batch);
    expect(parsed.errors).toEqual([]);
    expect(parsed.graderIdFromFile).toBe(scenario.lecturers.graderC.id);
    expect(parsed.batchIdFromFile).toBe(scenario.batch.id);
    expect(parsed.roomFromFile).toBe("F201");
    expect(parsed.rows).toHaveLength(2);
    const keys = parsed.rows.map((row) => row.studentKey);
    expect(keys).toContain(scenario.studentAId);
    expect(keys).toContain(scenario.studentBId);

    const workbook = readWorkbook(file.buffer);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    expect((sheet["!cols"] as Array<{ hidden?: boolean }>)[0]?.hidden).toBe(true);

    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
    const roomRow = matrix.find((row) => row[0] === "Phòng");
    expect(roomRow).toBeDefined();
    expect(roomRow?.[1]).toBe("F201");
  });

  it("xuất đúng phòng mặc định '—' khi giảng viên chưa được gán phòng", () => {
    const scenario = buildScenario();
    const noRoomGrader = { ...scenario.lecturers.graderC, room: "" };
    const context = filterBatchContext(scenario.data, scenario.batch.id);
    const files = exportGraderWorkbooks({
      batch: scenario.batch,
      students: context.students,
      groups: context.groups,
      members: context.members,
      lecturers: context.lecturers,
      scores: context.scores,
      graders: [noRoomGrader],
    });

    const parsed = parseGradedWorkbook(files[0].buffer, files[0].fileName, scenario.batch);
    expect(parsed.roomFromFile).toBeNull();

    const workbook = readWorkbook(files[0].buffer);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
    const roomRow = matrix.find((row) => row[0] === "Phòng");
    expect(roomRow?.[1]).toBe("—");
  });

  it("hỗ trợ thêm và cập nhật phòng chấm cho giảng viên", () => {
    const scenario = buildScenario();
    const addResult = addLecturer(
      scenario.data,
      scenario.batch.id,
      "GV Mới D",
      "d@example.edu.vn",
      "A105",
    );
    expect(addResult.error).toBeUndefined();
    const newLec = addResult.data.lecturers.find((l) => l.displayName === "GV Mới D");
    expect(newLec?.room).toBe("A105");

    const updatedData = updateLecturer(addResult.data, newLec!.id, { room: "B202" });
    const updatedLec = updatedData.lecturers.find((l) => l.id === newLec!.id);
    expect(updatedLec?.room).toBe("B202");
  });
});

describe("nhập điểm đã chấm", () => {
  it("ghép theo studentKey dù đảo thứ tự dòng và cập nhật điểm", () => {
    const scenario = buildScenario();
    const file = graderExport(scenario);
    const rewritten = rewriteGradedScores(
      file.buffer,
      { "1001": 8.5, "2001": 7 },
      { reverseRows: true },
    );
    const parsed = parseGradedWorkbook(rewritten, "file_dao_dong.xlsx", scenario.batch);
    expect(parsed.errors).toEqual([]);
    const preview = previewFor(scenario, [parsed]);
    expect(preview.summary.errors).toBe(0);
    expect(preview.summary.valid).toBe(2);
    expect(preview.summary.conflicts).toBe(0);

    const committed = commitGradedImport(scenario.data, scenario.batch.id, preview);
    expect(committed.error).toBeUndefined();
    const scores = committed.data.scores.filter(
      (score) => score.batchId === scenario.batch.id,
    );
    expect(scores).toHaveLength(2);
    expect(scores.find((score) => score.studentId === scenario.studentAId)?.value).toBe(8.5);
    expect(scores.find((score) => score.studentId === scenario.studentBId)?.value).toBe(7);

    const context = filterBatchContext(committed.data, scenario.batch.id);
    const reexport = exportGraderWorkbooks({
      batch: scenario.batch,
      students: context.students,
      groups: context.groups,
      members: context.members,
      lecturers: context.lecturers,
      scores: context.scores,
      graders: [scenario.lecturers.graderC],
    });
    const reparsed = parseGradedWorkbook(
      reexport[0].buffer,
      "re-export.xlsx",
      scenario.batch,
    );
    expect(reparsed.rows.find((row) => row.studentKey === scenario.studentAId)?.value).toBe(8.5);
  });

  it("không tự ghi đè khi hai file có điểm xung đột", () => {
    const scenario = buildScenario();
    const file = graderExport(scenario);
    const first = parseGradedWorkbook(
      rewriteGradedScores(file.buffer, { "1001": 8.5, "2001": 7 }),
      "file_1.xlsx",
      scenario.batch,
    );
    const second = parseGradedWorkbook(
      rewriteGradedScores(file.buffer, { "1001": 8.5, "2001": 9 }),
      "file_2.xlsx",
      scenario.batch,
    );
    const preview = previewFor(scenario, [first, second]);
    expect(preview.summary.conflicts).toBe(2);
    expect(preview.summary.valid).toBe(1);
    expect(preview.summary.unchanged).toBe(1);

    const committed = commitGradedImport(scenario.data, scenario.batch.id, preview);
    expect(committed.error).toBeUndefined();
    expect(
      committed.data.scores.find((score) => score.studentId === scenario.studentAId)?.value,
    ).toBe(8.5);
    expect(
      committed.data.scores.find((score) => score.studentId === scenario.studentBId),
    ).toBeUndefined();
    expect(
      committed.data.conflicts.filter(
        (conflict) => conflict.batchId === scenario.batch.id && !conflict.resolved,
      ).length,
    ).toBeGreaterThan(0);
  });

  it("báo dòng trùng, sinh viên lạ, điểm sai định dạng và ngoài phạm vi", () => {
    const scenario = buildScenario();
    const file = graderExport(scenario);
    const mutated = rewriteGradedScores(
      file.buffer,
      { "1001": "sai", "2001": 11 },
      {
        duplicateFirst: true,
        appendRows: [
          [
            "unknown-key",
            "PBL01",
            "9999",
            "Người Lạ",
            "24DT9",
            "HP999",
            "PBL X",
            "—",
            "—",
            5,
            "",
          ],
        ],
      },
    );
    const parsed = parseGradedWorkbook(mutated, "loi.xlsx", scenario.batch);
    const preview = previewFor(scenario, [parsed]);
    expect(preview.summary.errors).toBeGreaterThanOrEqual(4);
    const messages = preview.candidates.flatMap((candidate) => candidate.messages);
    expect(messages.some((message) => message.includes("trùng trong file"))).toBe(true);
    expect(messages.some((message) => message.includes("Không tìm thấy sinh viên"))).toBe(true);
    expect(messages.some((message) => message.includes("sai định dạng"))).toBe(true);
    expect(messages.some((message) => message.includes("ngoài phạm vi"))).toBe(true);
  });

  it("báo sinh viên thiếu trong file của giảng viên", () => {
    const scenario = buildScenario();
    const file = graderExport(scenario);
    const partial = rewriteGradedScores(
      file.buffer,
      { "1001": 8.5 },
      { omitMssv: ["2001"] },
    );
    const parsed = parseGradedWorkbook(partial, "thieu.xlsx", scenario.batch);
    const preview = previewFor(scenario, [parsed]);
    expect(preview.summary.valid).toBe(1);
    expect(preview.summary.missing).toBe(1);
    expect(preview.missingByGrader[0]?.missing.join(" ")).toContain("2001");
  });

  it("chặn nhập file sai đợt", () => {
    const scenario = buildScenario();
    const file = graderExport(scenario);
    const otherBatch = { ...scenario.batch, id: "batch_khac" };
    const parsed = parseGradedWorkbook(file.buffer, "sai_dot.xlsx", otherBatch);
    expect(parsed.errors.join(" ")).toContain("đợt khác");
    const preview = buildGradedImportPreview({
      files: [parsed],
      batch: otherBatch,
      students: [],
      groups: [],
      members: [],
      scores: [],
      lecturers: [],
    });
    const committed = commitGradedImport(scenario.data, scenario.batch.id, preview);
    expect(committed.error).toContain("lỗi cấp file");
  });
});
