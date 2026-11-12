import { useMemo, useState } from "react";
import type { BatchContext, DashboardStats } from "../domain/selectors";
import { getStudentGroupMap } from "../domain/selectors";
import type { AppData } from "../store/store";
import type { ExamBatch } from "../types";
import {
  buildFinalExports,
  type FinalExportResult,
} from "../excel/finalExport";
import { arrayBufferToBlob, downloadBlob } from "../utils/base64";
import { Badge, EmptyState, Notice, PageHeader, StatCard } from "./shared";

export function FinalExportPage({
  context,
  batch,
  stats,
  onNotice,
  notice,
  onCloseNotice,
}: {
  data: AppData;
  context: BatchContext;
  batch: ExamBatch | null;
  stats: DashboardStats;
  onNotice: (tone: "info" | "success" | "warning" | "danger", text: string) => void;
  notice: { tone: "info" | "success" | "warning" | "danger"; text: string } | null;
  onCloseNotice: () => void;
}) {
  const [result, setResult] = useState<FinalExportResult | null>(null);
  const grouped = useMemo(() => getStudentGroupMap(context), [context]);
  const unscored = context.students.filter(
    (student) => !context.scores.some((score) => score.studentId === student.id),
  );
  const unresolved = context.conflicts.filter((conflict) => !conflict.resolved);
  const missingAdvisor = context.students.filter((student) => {
    const entry = grouped.get(student.id);
    if (!entry) return true;
    return !(entry.member.advisorOverrideId || entry.group.defaultAdvisorId);
  });
  const unassignedGrader = context.groups.filter((group) => !group.graderId);

  if (!batch) {
    return (
      <div className="page">
        <PageHeader title="Xuất danh sách cuối" description="Chọn đợt thi trước." />
        <EmptyState title="Chưa có đợt thi" />
      </div>
    );
  }

  function handleExport() {
    const exportResult = buildFinalExports({
      batch: batch as ExamBatch,
      sourceWorkbooks: context.sourceWorkbooks,
      students: context.students,
      scores: context.scores,
      conflicts: context.conflicts,
    });
    setResult(exportResult);
    onNotice(
      exportResult.files.length > 0 ? "success" : "danger",
      exportResult.files.length > 0
        ? `Đã tạo ${exportResult.files.length} file đầu ra. File nguồn không bị ghi đè.`
        : "Không tạo được file đầu ra. Xem báo cáo lỗi.",
    );
  }

  function downloadAll() {
    if (!result) return;
    result.files.forEach((file, index) => {
      window.setTimeout(() => {
        downloadBlob(arrayBufferToBlob(file.buffer), file.fileName);
      }, index * 250);
    });
  }

  const ready =
    context.sourceWorkbooks.length > 0 &&
    stats.scoredCount > 0 &&
    unresolved.length === 0 &&
    missingAdvisor.length === 0 &&
    unassignedGrader.length === 0;

  return (
    <div className="page">
      <PageHeader
        title="Xuất danh sách cuối"
        description="Tạo một file mới cho mỗi file nguồn, ghi điểm vào đúng sinh viên theo khóa dữ liệu, giữ thứ tự dòng và các cột khác trong khả năng thư viện."
        actions={
          <button type="button" className="button" onClick={handleExport}>
            Tạo {context.sourceWorkbooks.length} file đầu ra
          </button>
        }
      />

      {notice ? (
        <Notice tone={notice.tone} onClose={onCloseNotice}>
          {notice.text}
        </Notice>
      ) : null}

      <div className="stat-grid">
        <StatCard label="File nguồn" value={context.sourceWorkbooks.length} />
        <StatCard
          label="Sinh viên đã có điểm"
          value={stats.scoredCount}
          tone="success"
        />
        <StatCard
          label="Sinh viên chưa có điểm"
          value={unscored.length}
          tone={unscored.length > 0 ? "warning" : "default"}
        />
        <StatCard
          label="Xung đột chưa xử lý"
          value={unresolved.length}
          tone={unresolved.length > 0 ? "danger" : "success"}
        />
      </div>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Checklist hoàn tất</h2>
            <p className="muted">
              Có thể xuất file ngay cả khi còn cảnh báo; báo cáo bên dưới sẽ nêu rõ điểm chưa có và
              xung đột chưa xử lý. Hệ thống không tự động ghi đè xung đột.
            </p>
          </div>
          <Badge tone={ready ? "success" : "warning"}>
            {ready ? "Sẵn sàng" : "Còn cảnh báo"}
          </Badge>
        </div>

        <ul className="checklist">
          <li className={context.sourceWorkbooks.length > 0 ? "ok" : "bad"}>
            {context.sourceWorkbooks.length} file nguồn đã nhập.
          </li>
          <li className={unscored.length === 0 ? "ok" : "warn"}>
            {unscored.length === 0
              ? "Tất cả sinh viên đã có điểm."
              : `${unscored.length} sinh viên chưa có điểm.`}
          </li>
          <li className={unresolved.length === 0 ? "ok" : "bad"}>
            {unresolved.length === 0
              ? "Không có xung đột điểm chưa xử lý."
              : `${unresolved.length} xung đột điểm chưa xử lý.`}
          </li>
          <li className={missingAdvisor.length === 0 ? "ok" : "warn"}>
            {missingAdvisor.length === 0
              ? "Tất cả sinh viên đã có GVHD hiệu lực."
              : `${missingAdvisor.length} sinh viên chưa có GVHD hiệu lực.`}
          </li>
          <li className={unassignedGrader.length === 0 ? "ok" : "warn"}>
            {unassignedGrader.length === 0
              ? "Tất cả nhóm đã được phân công giảng viên chấm."
              : `${unassignedGrader.length} nhóm chưa được phân công giảng viên chấm.`}
          </li>
        </ul>

        {unscored.length > 0 ? (
          <details className="detail-block">
            <summary>Danh sách sinh viên chưa có điểm ({unscored.length})</summary>
            <ul>
              {unscored.slice(0, 50).map((student) => (
                <li key={student.id}>
                  {student.mssv} – {student.name}
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        {unresolved.length > 0 ? (
          <details className="detail-block" open>
            <summary>Xung đột chưa xử lý ({unresolved.length})</summary>
            <ul>
              {unresolved.map((conflict) => (
                <li key={conflict.id}>
                  {conflict.mssv} – {conflict.studentName}: {conflict.existingValue ?? "—"} vs{" "}
                  {conflict.newValue ?? "—"} (từ {conflict.sourceFileName})
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      {result ? (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>File đầu ra đã tạo</h2>
              <p className="muted">
                Mỗi file giữ tên gốc kèm hậu tố _da_cap_nhat. File nguồn ban đầu không bị sửa.
              </p>
            </div>
            <button type="button" className="button secondary" onClick={downloadAll}>
              Tải tất cả ({result.files.length} file)
            </button>
          </div>

          {result.files.length === 0 ? (
            <EmptyState title="Chưa tạo được file">
              Xem báo cáo lỗi bên dưới.
            </EmptyState>
          ) : (
            <div className="download-list">
              {result.files.map((file) => (
                <div className="download-item" key={file.workbookId}>
                  <div>
                    <strong>{file.fileName}</strong>
                    <small>
                      Từ {file.report.fileName} · {file.report.updatedRows} dòng đã cập nhật ·{" "}
                      {file.report.missingScores} sinh viên chưa có điểm
                    </small>
                  </div>
                  <button
                    type="button"
                    className="button small"
                    onClick={() => downloadBlob(arrayBufferToBlob(file.buffer), file.fileName)}
                  >
                    Tải file
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>File nguồn</th>
                  <th>File đầu ra</th>
                  <th>Dòng cập nhật</th>
                  <th>Chưa có điểm</th>
                  <th>Vấn đề còn lại</th>
                </tr>
              </thead>
              <tbody>
                {result.reports.map((report) => (
                  <tr key={report.workbookId}>
                    <td>{report.fileName}</td>
                    <td>{report.outputName}</td>
                    <td>{report.updatedRows}</td>
                    <td>{report.missingScores}</td>
                    <td className="message-cell">
                      {report.issues.length === 0
                        ? "Không có"
                        : report.issues.map((issue) => <div key={issue}>{issue}</div>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <EmptyState title="Chưa tạo file đầu ra">
          Bấm “Tạo {context.sourceWorkbooks.length} file đầu ra” để sinh file. Thao tác này chỉ đọc
          dữ liệu và tạo bản mới, không ghi đè file nguồn.
        </EmptyState>
      )}
    </div>
  );
}
