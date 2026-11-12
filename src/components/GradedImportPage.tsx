import { useMemo, useState } from "react";
import type { BatchContext } from "../domain/selectors";
import type { AppData } from "../store/store";
import type {
  ExamBatch,
  GradedFileParse,
  GradedImportPreview,
} from "../types";
import { buildGradedImportPreview } from "../excel/gradedImport";
import { parseGradedWorkbook } from "../excel/grader";
import { commitGradedImport } from "../store/actions";
import { Badge, EmptyState, Notice, PageHeader, StatCard } from "./shared";

export function GradedImportPage({
  data,
  setData,
  context,
  batch,
  onNavigate,
  onNotice,
  notice,
  onCloseNotice,
}: {
  data: AppData;
  setData: React.Dispatch<React.SetStateAction<AppData>>;
  context: BatchContext;
  batch: ExamBatch | null;
  onNavigate: (page: string) => void;
  onNotice: (tone: "info" | "success" | "warning" | "danger", text: string) => void;
  notice: { tone: "info" | "success" | "warning" | "danger"; text: string } | null;
  onCloseNotice: () => void;
}) {
  const [files, setFiles] = useState<GradedFileParse[]>([]);
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const preview: GradedImportPreview | null = useMemo(() => {
    if (!batch || files.length === 0) return null;
    return buildGradedImportPreview({
      files,
      batch,
      students: context.students,
      groups: context.groups,
      members: context.members,
      scores: context.scores,
      lecturers: context.lecturers,
    });
  }, [batch, files, context]);

  const unresolvedConflicts = context.conflicts.filter(
    (conflict) => !conflict.resolved,
  );
  const importRuns = data.importRuns
    .filter((run) => run.batchId === batch?.id && run.kind === "graded")
    .slice()
    .reverse()
    .slice(0, 8);

  if (!batch) {
    return (
      <div className="page">
        <PageHeader title="Nhập điểm đã chấm" description="Chọn đợt thi trước." />
        <EmptyState title="Chưa có đợt thi" />
      </div>
    );
  }

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0 || !batch) return;
    setLoading(true);
    setLocalError(null);
    const parsed: GradedFileParse[] = [];
    const errors: string[] = [];
    for (const file of Array.from(fileList)) {
      if (!/\.(xlsx|xls)$/i.test(file.name)) {
        errors.push(`"${file.name}" không phải file Excel.`);
        continue;
      }
      try {
        const buffer = await file.arrayBuffer();
        parsed.push(parseGradedWorkbook(buffer, file.name, batch));
      } catch (error) {
        errors.push(
          `Không đọc được "${file.name}": ${error instanceof Error ? error.message : "lỗi không xác định"}`,
        );
      }
    }
    setFiles((previous) => [...previous, ...parsed]);
    if (errors.length > 0) setLocalError(errors.join(" "));
    if (parsed.length > 0) {
      onNotice(
        "info",
        `Đã đọc ${parsed.length} file điểm. Kiểm tra bản xem trước và xung đột trước khi xác nhận.`,
      );
    }
    setLoading(false);
  }

  function handleCommit() {
    if (!preview) return;
    const result = commitGradedImport(data, batch!.id, preview);
    if (result.error) {
      setLocalError(result.error);
      onNotice("danger", result.error);
      return;
    }
    setData(result.data);
    const committed = preview.summary.valid;
    setFiles([]);
    setLocalError(null);
    onNotice(
      "success",
      `Đã cập nhật ${committed} điểm hợp lệ. ${preview.summary.conflicts > 0 ? `${preview.summary.conflicts} dòng xung đột được giữ lại để xử lý.` : ""}`,
    );
    onNavigate("review");
  }

  return (
    <div className="page">
      <PageHeader
        title="Nhập điểm đã chấm"
        description="Ghép bản ghi theo studentKey (dự phòng MSSV nếu duy nhất), kiểm tra lỗi và xung đột trước khi cập nhật."
        actions={
          <button type="button" className="button secondary" onClick={() => onNavigate("grader-export")}>
            Về xuất file chấm
          </button>
        }
      />

      {notice ? (
        <Notice tone={notice.tone} onClose={onCloseNotice}>
          {notice.text}
        </Notice>
      ) : null}
      {localError ? (
        <Notice tone="danger" onClose={() => setLocalError(null)}>
          {localError}
        </Notice>
      ) : null}

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>1. Chọn file đã chấm</h2>
            <p className="muted">
              Có thể chọn nhiều file cùng lúc. Không dùng thứ tự dòng; mỗi sinh viên được ghép bằng
              cột studentKey ẩn trong file xuất.
            </p>
          </div>
          <Badge tone="info">
            Thang điểm {batch.scoreConfig.min}–{batch.scoreConfig.max}
          </Badge>
        </div>
        <label className="file-drop">
          <input
            type="file"
            accept=".xlsx,.xls"
            multiple
            disabled={loading}
            onChange={(event) => {
              void handleFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <span>{loading ? "Đang đọc file..." : "Bấm để chọn file điểm đã chấm"}</span>
          <small>Hỗ trợ nhiều file; hệ thống sẽ phát hiện điểm xung đột giữa các file.</small>
        </label>
      </section>

      {unresolvedConflicts.length > 0 ? (
        <Notice tone="warning">
          <strong>{unresolvedConflicts.length} xung đột điểm chưa xử lý:</strong>
          <ul>
            {unresolvedConflicts.map((conflict) => (
              <li key={conflict.id}>
                {conflict.mssv} – {conflict.studentName}: {conflict.existingValue ?? "—"} vs{" "}
                {conflict.newValue ?? "—"} (từ {conflict.sourceFileName}). Hãy thống nhất điểm rồi
                nhập lại file đã sửa; hệ thống không tự ghi đè.
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}

      {preview ? (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>2. Bản xem trước thay đổi</h2>
              <p className="muted">
                Chỉ các dòng “Hợp lệ” được ghi khi xác nhận. Dòng lỗi, trùng hoặc xung đột không
                được tự động ghi đè.
              </p>
            </div>
            <button
              type="button"
              className="button"
              disabled={preview.summary.valid === 0 || preview.errors.length > 0}
              onClick={handleCommit}
            >
              Xác nhận cập nhật {preview.summary.valid} điểm
            </button>
          </div>

          <div className="stat-grid">
            <StatCard label="Hợp lệ" value={preview.summary.valid} tone="success" />
            <StatCard label="Không thay đổi" value={preview.summary.unchanged} tone="info" />
            <StatCard label="Xung đột" value={preview.summary.conflicts} tone="danger" />
            <StatCard label="Dòng lỗi" value={preview.summary.errors} tone="warning" />
            <StatCard label="Sinh viên thiếu" value={preview.summary.missing} tone="warning" />
          </div>

          {preview.errors.length > 0 ? (
            <Notice tone="danger">
              <strong>Lỗi cấp file:</strong>
              <ul>
                {preview.errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </Notice>
          ) : null}

          {preview.files.map((file) => (
            <div key={file.fileName} className="file-summary">
              <strong>{file.fileName}</strong>
              <span>
                Giảng viên: {file.graderNameFromFile || "không rõ"}
                {file.roomFromFile ? ` · Phòng: ${file.roomFromFile}` : ""} · {file.rows.length} dòng
              </span>
              {file.warnings.map((warning) => (
                <small key={warning}>⚠ {warning}</small>
              ))}
              {file.errors.map((error) => (
                <small className="error-text" key={error}>⛔ {error}</small>
              ))}
            </div>
          ))}

          {preview.missingByGrader.length > 0 ? (
            <Notice tone="warning">
              <strong>Sinh viên thiếu trong file đã chấm:</strong>
              <ul>
                {preview.missingByGrader.map((item) => (
                  <li key={item.graderName}>
                    {item.graderName}: {item.missing.join(", ")}
                  </li>
                ))}
              </ul>
            </Notice>
          ) : null}

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>File / dòng</th>
                  <th>MSSV</th>
                  <th>Họ tên</th>
                  <th>Điểm cũ</th>
                  <th>Điểm mới</th>
                  <th>Trạng thái</th>
                  <th>Ghi chú kiểm tra</th>
                </tr>
              </thead>
              <tbody>
                {preview.candidates.map((candidate, index) => (
                  <tr key={`${candidate.sourceFileName}-${candidate.rowNumber}-${index}`}>
                    <td>
                      {candidate.sourceFileName}
                      <small className="cell-sub">dòng {candidate.rowNumber}</small>
                    </td>
                    <td>{candidate.mssv || "—"}</td>
                    <td>{candidate.studentName}</td>
                    <td>{candidate.oldValue ?? "—"}</td>
                    <td>{candidate.newValue ?? "—"}</td>
                    <td>
                      {candidate.status === "valid" ? (
                        <Badge tone="success">Hợp lệ</Badge>
                      ) : candidate.status === "unchanged" ? (
                        <Badge tone="info">Không đổi</Badge>
                      ) : candidate.status === "conflict" ? (
                        <Badge tone="danger">Xung đột</Badge>
                      ) : (
                        <Badge tone="warning">Lỗi</Badge>
                      )}
                    </td>
                    <td className="message-cell">
                      {candidate.messages.length === 0
                        ? "—"
                        : candidate.messages.map((message) => (
                            <div key={message}>{message}</div>
                          ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <h2>Lịch sử nhập điểm</h2>
        {importRuns.length === 0 ? (
          <EmptyState title="Chưa có lần nhập điểm nào" />
        ) : (
          <div className="run-list">
            {importRuns.map((run) => (
              <details key={run.id}>
                <summary>
                  <span>{run.fileName}</span>
                  <Badge tone={run.status === "success" ? "success" : "warning"}>
                    {run.status === "success" ? "Thành công" : "Có cảnh báo"}
                  </Badge>
                  <small>{new Date(run.createdAt).toLocaleString("vi-VN")}</small>
                </summary>
                <ul>
                  {run.validationReport.length === 0 ? (
                    <li>Không có lỗi/cảnh báo.</li>
                  ) : (
                    run.validationReport.map((report, index) => (
                      <li key={`${run.id}-${index}`}>{report}</li>
                    ))
                  )}
                </ul>
              </details>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
