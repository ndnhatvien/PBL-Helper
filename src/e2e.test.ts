import { describe, expect, it } from "vitest";
import { filterBatchContext, getDashboardStats, getReviewRows } from "./domain/selectors";
import { getEffectiveAdvisorId, canAdvisorReviewStudent } from "./domain/advisor";
import { exportGraderWorkbooks, parseGradedWorkbook } from "./excel/grader";
import { buildGradedImportPreview } from "./excel/gradedImport";
import { buildFinalExports } from "./excel/finalExport";
import { commitGradedImport, saveReview } from "./store/actions";
import { buildScenario } from "./test/scenario";
import { readWorkbook, rewriteGradedScores, sheetMatrix } from "./test/helpers";
import { normalizeText } from "./utils/text";

describe("E2E theo spec mục 11", () => {
  it("chạy trọn luồng nhập Excel → nhóm → GVHD → phân công → xuất → nhập điểm → rà soát → xuất lại", () => {
    const scenario = buildScenario();
    const { advisorA, advisorB, graderC } = scenario.lecturers;
    let data = scenario.data;

    // 1-4: đã nhập 2 file, tạo nhóm xuyên file, gán GVHD A + override B, chấm C.
    const initialContext = filterBatchContext(data, scenario.batch.id);
    expect(initialContext.sourceWorkbooks).toHaveLength(2);
    expect(initialContext.students).toHaveLength(2);
    expect(initialContext.groups).toHaveLength(1);
    const group = initialContext.groups[0];
    expect(group.groupCode).toBe("PBL01");
    expect(group.graderId).toBe(graderC.id);
    expect(group.defaultAdvisorId).toBe(advisorA.id);
    expect(initialContext.members).toHaveLength(2);
    const memberA = initialContext.members.find(
      (member) => member.studentId === scenario.studentAId,
    );
    const memberB = initialContext.members.find(
      (member) => member.studentId === scenario.studentBId,
    );
    expect(
      getEffectiveAdvisorId(memberA?.advisorOverrideId, group.defaultAdvisorId),
    ).toBe(advisorA.id);
    expect(
      getEffectiveAdvisorId(memberB?.advisorOverrideId, group.defaultAdvisorId),
    ).toBe(advisorB.id);
    expect(canAdvisorReviewStudent(advisorA.id, advisorA.id)).toBe(true);
    expect(canAdvisorReviewStudent(advisorA.id, advisorB.id)).toBe(false);
    expect(graderC.id).not.toBe(advisorA.id);
    expect(graderC.id).not.toBe(advisorB.id);

    // 5: xuất file cho C, nhập điểm mẫu và nhập lại (đảo thứ tự dòng).
    const exported = exportGraderWorkbooks({
      batch: scenario.batch,
      students: initialContext.students,
      groups: initialContext.groups,
      members: initialContext.members,
      lecturers: initialContext.lecturers,
      scores: initialContext.scores,
      graders: [graderC],
    });
    expect(exported).toHaveLength(1);
    const gradedBuffer = rewriteGradedScores(
      exported[0].buffer,
      { "1001": 8.5, "2001": 7 },
      { reverseRows: true },
    );
    const parsed = parseGradedWorkbook(
      gradedBuffer,
      "Phieu_cham_GV_Cham_C.xlsx",
      scenario.batch,
    );
    expect(parsed.rows).toHaveLength(2);
    const preview = buildGradedImportPreview({
      files: [parsed],
      batch: scenario.batch,
      students: initialContext.students,
      groups: initialContext.groups,
      members: initialContext.members,
      scores: initialContext.scores,
      lecturers: initialContext.lecturers,
    });
    expect(preview.summary.valid).toBe(2);
    expect(preview.summary.conflicts).toBe(0);
    const committedScores = commitGradedImport(data, scenario.batch.id, preview);
    expect(committedScores.error).toBeUndefined();
    data = committedScores.data;

    // 6: GVHD A thấy điểm cả hai nhưng chỉ rà soát sinh viên thứ nhất.
    let context = filterBatchContext(data, scenario.batch.id);
    const lecturerById = new Map(
      context.lecturers.map((lecturer) => [lecturer.id, lecturer]),
    );
    const rowsForA = getReviewRows(context, advisorA.id, lecturerById);
    expect(rowsForA).toHaveLength(2);
    expect(rowsForA.every((row) => row.score !== null)).toBe(true);
    expect(rowsForA.find((row) => row.student.id === scenario.studentAId)?.canReview).toBe(true);
    expect(rowsForA.find((row) => row.student.id === scenario.studentBId)?.canReview).toBe(false);

    // 7: GVHD B thấy điểm cả hai nhưng chỉ rà soát sinh viên thứ hai.
    const rowsForB = getReviewRows(context, advisorB.id, lecturerById);
    expect(rowsForB).toHaveLength(2);
    expect(rowsForB.every((row) => row.score !== null)).toBe(true);
    expect(rowsForB.find((row) => row.student.id === scenario.studentBId)?.canReview).toBe(true);
    expect(rowsForB.find((row) => row.student.id === scenario.studentAId)?.canReview).toBe(false);

    // 8: duyệt sinh viên 1, yêu cầu kiểm tra sinh viên 2; trạng thái độc lập.
    const approveA = saveReview(
      data,
      scenario.studentAId,
      advisorA.id,
      "approved",
      "Điểm khớp rubric.",
    );
    expect(approveA.error).toBeUndefined();
    data = approveA.data;

    const aReviewsB = saveReview(
      data,
      scenario.studentBId,
      advisorA.id,
      "approved",
      "Không được phép",
    );
    expect(aReviewsB.error).toContain("không phải GVHD hiệu lực");
    data = aReviewsB.data;

    const needsChangesB = saveReview(
      data,
      scenario.studentBId,
      advisorB.id,
      "needs_changes",
      "Cần đối chiếu lại phần báo cáo.",
    );
    expect(needsChangesB.error).toBeUndefined();
    data = needsChangesB.data;

    context = filterBatchContext(data, scenario.batch.id);
    const finalLecturerMap = new Map(
      context.lecturers.map((lecturer) => [lecturer.id, lecturer]),
    );
    const refreshedA = getReviewRows(context, advisorA.id, finalLecturerMap);
    const rowA = refreshedA.find((row) => row.student.id === scenario.studentAId);
    const rowB = refreshedA.find((row) => row.student.id === scenario.studentBId);
    expect(rowA?.review?.status).toBe("approved");
    expect(rowB?.review?.status).toBe("needs_changes");
    expect(rowB?.canReview).toBe(false);
    expect(rowB?.review?.reviewerId).toBe(advisorB.id);
    expect(rowA?.review?.reviewerId).toBe(advisorA.id);

    const stats = getDashboardStats(context, scenario.batch);
    expect(stats.approved).toBe(1);
    expect(stats.needsChanges).toBe(1);
    expect(stats.pendingReview).toBe(0);

    // 9: xuất đủ hai file nguồn, điểm trở về đúng dòng/sinh viên, giữ cột khác.
    const finalResult = buildFinalExports({
      batch: scenario.batch,
      sourceWorkbooks: context.sourceWorkbooks,
      students: context.students,
      scores: context.scores,
      conflicts: context.conflicts,
    });
    expect(finalResult.files).toHaveLength(2);
    expect(finalResult.reports).toHaveLength(2);
    expect(
      finalResult.reports.every(
        (report) => report.updatedRows === 1 && report.missingScores === 0,
      ),
    ).toBe(true);
    expect(
      finalResult.reports.every((report) => report.issues.length === 0),
    ).toBe(true);

    for (const source of context.sourceWorkbooks) {
      const exportedFile = finalResult.files.find(
        (file) => file.workbookId === source.id,
      );
      expect(exportedFile).toBeDefined();
      expect(exportedFile?.fileName).toContain("_da_cap_nhat.xlsx");

      const matrix = sheetMatrix(readWorkbook(exportedFile!.buffer), source.sheetName);
      const headers = matrix[source.headerRow] as unknown[];
      const scoreCol = source.mapping.score;
      expect(scoreCol).not.toBeNull();
      const headerText = normalizeText(headers[scoreCol as number]);
      expect(headerText).toBe("ck");

      const expected =
        source.fileName.includes("_A") ? { mssv: "1001", score: 8.5 } : { mssv: "2001", score: 7 };
      const row = matrix.find(
        (candidate) => String(candidate[source.mapping.mssv as number] ?? "") === expected.mssv,
      );
      expect(row).toBeDefined();
      expect(row?.[scoreCol as number]).toBe(expected.score);
      // Các cột không liên quan vẫn giữ nguyên.
      expect(String(row?.[source.mapping.name as number] ?? "")).toContain(
        expected.mssv === "1001" ? "Nguyễn Văn An" : "Trần Thị Bình",
      );
      expect(String(row?.[source.mapping.className as number] ?? "")).toMatch(/24DT/);
    }
  });
});
