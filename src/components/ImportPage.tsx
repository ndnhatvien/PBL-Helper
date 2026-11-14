import { useMemo, useState } from "react";
import type { ColumnMapping, ExamBatch, PendingWorkbook, SourceWorkbook } from "../types";
import type { AppData } from "../store/store";
import {
  commitSourceWorkbooks,
  deleteSourceWorkbook,
  splitLecturerNames,
  updateSourceWorkbookAdvisors,
} from "../store/actions";
import {
  analyzeFile,
  analyzeWorkbook,
  findCrossFileDuplicateIssues,
  mergeDuplicatePendingWorkbooks,
} from "../excel/importWorkbook";
import { Badge, EmptyState, Notice, PageHeader } from "./shared";
import { LecturersPanel } from "./LecturersPanel";

interface ImportPageProps {
  data: AppData;
  setData: React.Dispatch<React.SetStateAction<AppData>>;
  batch: ExamBatch | null;
  onNavigate: (page: string) => void;
  onNotice: (tone: "info" | "success" | "warning" | "danger", text: string) => void;
  notice: { tone: "info" | "success" | "warning" | "danger"; text: string } | null;
  onCloseNotice: () => void;
}

const MAPPING_FIELDS: Array<{
  key: keyof ColumnMapping;
  label: string;
  required?: boolean;
  hint: string;
}> = [
  { key: "mssv", label: "MSSV", required: true, hint: "Bắt buộc" },
  { key: "name", label: "Họ tên", hint: "Nên ánh xạ" },
  { key: "className", label: "Lớp sinh hoạt", hint: "" },
  { key: "courseCode", label: "Mã học phần", hint: "" },
  { key: "courseName", label: "Tên học phần", hint: "" },
  { key: "groupCode", label: "Mã nhóm (nguồn)", hint: "Chỉ để tham khảo" },
  { key: "advisor", label: "GVHD (nếu có cột)", hint: "Giảng viên hướng dẫn" },
  { key: "score", label: "Cột điểm để xuất lại", hint: "Có thể thêm cột mới khi xuất" },
];

function columnLabel(index: number): string {
  let label = "";
  let value = index;
  do {
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return label;
}

export function ImportPage({
  data,
  setData,
  batch,
  onNavigate,
  onNotice,
  notice,
  onCloseNotice,
}: ImportPageProps) {
  const [pending, setPending] = useState<PendingWorkbook[]>([]);
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [editingWorkbook, setEditingWorkbook] = useState<SourceWorkbook | null>(null);
  const [editingAdvisors, setEditingAdvisors] = useState<string[]>([""]);

  const existingStudents = useMemo(
    () => data.students.filter((student) => student.batchId === batch?.id),
    [data.students, batch?.id],
  );
  const sourceWorkbooks = useMemo(
    () => data.sourceWorkbooks.filter((workbook) => workbook.batchId === batch?.id),
    [data.sourceWorkbooks, batch?.id],
  );
  const crossIssues = useMemo(
    () => findCrossFileDuplicateIssues(pending, existingStudents),
    [pending, existingStudents],
  );

  const hasBlockingErrors = useMemo(
    () =>
      pending.some(
        (workbook) =>
          workbook.errors.length > 0 ||
          workbook.rows.length === 0 ||
          workbook.mapping.mssv === null ||
          workbook.rows.some((row) => row.errors.length > 0),
      ) || crossIssues.length > 0,
    [pending, crossIssues],
  );

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0 || !batch) return;
    setLoading(true);
    setLocalError(null);
    const loaded: PendingWorkbook[] = [];
    const errors: string[] = [];
    for (const file of Array.from(files)) {
      if (!/\.(xlsx|xls)$/i.test(file.name)) {
        errors.push(`"${file.name}" không phải file .xlsx/.xls.`);
        continue;
      }
      if (file.size > 8 * 1024 * 1024) {
        errors.push(
          `"${file.name}" lớn hơn 8 MB; có thể vượt giới hạn lưu trữ localStorage.`,
        );
      }
      try {
        loaded.push(await analyzeFile(file));
      } catch (error) {
        errors.push(
          `Không đọc được "${file.name}": ${error instanceof Error ? error.message : "lỗi không xác định"}`,
        );
      }
    }
    setPending((previous) => [...previous, ...loaded]);
    if (errors.length > 0) setLocalError(errors.join(" "));
    if (loaded.length > 0) {
      onNotice(
        "info",
        `Đã đọc ${loaded.length} file. Kiểm tra sheet, ánh xạ cột và bản xem trước trước khi nhập.`,
      );
    }
    setLoading(false);
  }

  function reanalyze(
    workbook: PendingWorkbook,
    options: {
      sheetName?: string;
      mapping?: ColumnMapping;
      metaLecturerName?: string | null;
      metaLecturerNames?: string[];
    },
  ) {
    try {
      const result = analyzeWorkbook({
        fileName: workbook.fileName,
        fileSize: workbook.fileSize,
        base64: workbook.originalBase64,
        sheetName: options.sheetName ?? workbook.sheetName,
        headerRow: options.mapping ? workbook.headerRow : undefined,
        mapping: options.mapping,
        metaLecturerName:
          options.metaLecturerName !== undefined
            ? options.metaLecturerName
            : workbook.metaLecturerName,
        metaLecturerNames:
          options.metaLecturerNames !== undefined
            ? options.metaLecturerNames
            : workbook.metaLecturerNames,
        tempId: workbook.tempId,
      });
      setPending((previous) =>
        previous.map((item) =>
          item.tempId === workbook.tempId ? result.pending : item,
        ),
      );
    } catch (error) {
      setLocalError(
        `Không phân tích lại được "${workbook.fileName}": ${error instanceof Error ? error.message : "lỗi không xác định"}`,
      );
    }
  }

  function handleMappingChange(
    workbook: PendingWorkbook,
    key: keyof ColumnMapping,
    rawValue: string,
  ) {
    const nextMapping: ColumnMapping = {
      ...workbook.mapping,
      [key]: rawValue === "" ? null : Number(rawValue),
    };
    reanalyze(workbook, { mapping: nextMapping });
  }

  function handleUpdateLecturers(
    workbook: PendingWorkbook,
    nextAdvisors: string[],
  ) {
    const validAdvisors = nextAdvisors.map((n) => n.trim()).filter(Boolean);
    const combinedName = validAdvisors.join(", ") || null;
    setPending((previous) =>
      previous.map((item) =>
        item.tempId === workbook.tempId
          ? {
              ...item,
              metaLecturerNames: nextAdvisors,
              metaLecturerName: combinedName,
            }
          : item,
      ),
    );
  }

  function handleImport() {
    if (!batch) return;
    const result = commitSourceWorkbooks(data, batch.id, pending);
    if (result.error) {
      setLocalError(result.error);
      onNotice("danger", result.error);
      return;
    }
    setData(result.data);
    setPending([]);
    setLocalError(null);
    onNotice(
      "success",
      `Đã nhập ${pending.length} file và ${pending.reduce((total, item) => total + item.rows.length, 0)} sinh viên vào đợt.`,
    );
  }

  function startEditWorkbook(wb: SourceWorkbook) {
    const list = wb.metaLecturerNames?.length
      ? [...wb.metaLecturerNames]
      : wb.metaLecturerName
        ? splitLecturerNames(wb.metaLecturerName)
        : [""];
    setEditingWorkbook(wb);
    setEditingAdvisors(list.length > 0 ? list : [""]);
  }

  function handleSaveWorkbookAdvisors() {
    if (!editingWorkbook || !batch) return;
    const result = updateSourceWorkbookAdvisors(
      data,
      batch.id,
      editingWorkbook.id,
      editingAdvisors,
    );
    if (result.error) {
      onNotice("danger", result.error);
      return;
    }
    setData(result.data);
    onNotice("success", `Đã cập nhật GVHD cho file "${editingWorkbook.fileName}".`);
    setEditingWorkbook(null);
  }

  function handleDeleteWorkbook(wb: SourceWorkbook) {
    if (!batch) return;
    const count = data.students.filter((s) => s.sourceWorkbookId === wb.id).length;
    const ok = window.confirm(
      `Bạn có chắc chắn muốn xóa file "${wb.fileName}" khỏi đợt?\n\nThao tác này sẽ xóa ${count} sinh viên thuộc file này cùng các phân nhóm tương ứng.`,
    );
    if (!ok) return;
    const result = deleteSourceWorkbook(data, wb.id);
    if (result.error) {
      onNotice("danger", result.error);
      return;
    }
    setData(result.data);
    onNotice("success", `Đã xóa file "${wb.fileName}".`);
  }

  if (!batch) {
    return (
      <div className="page">
        <PageHeader title="Nhập danh sách Excel" description="Chọn hoặc tạo đợt thi trước khi nhập dữ liệu." />
        <EmptyState title="Chưa có đợt thi">
          Hãy tạo đợt thi ở trang Tổng quan, sau đó quay lại nhập Excel.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="Nhập danh sách SV & GVHD"
        description="Đọc file Excel, gán GVHD (hỗ trợ đồng hướng dẫn), kiểm tra sơ bộ và xem trước lỗi trước khi xác nhận nhập."
        actions={
          <button type="button" className="button secondary" onClick={() => onNavigate("groups")}>
            Sang quản lý nhóm & phân công
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
            <h2>1. Chọn file nguồn</h2>
            <p className="muted">
              Hỗ trợ .xlsx; .xls đọc được nếu SheetJS xử lý ổn định. Mỗi file có thể có nhiều sheet.
            </p>
          </div>
          <Badge tone="info">{batch.name}</Badge>
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
          <span>{loading ? "Đang đọc file..." : "Bấm để chọn một hoặc nhiều file Excel"}</span>
          <small>File gốc sẽ được lưu cục bộ để tạo file đầu ra, không ghi đè file nguồn.</small>
        </label>
      </section>

      {pending.length > 0 ? (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>2. Kiểm tra ánh xạ và xem trước</h2>
              <p className="muted">
                Dữ liệu chỉ được nhập chính thức sau khi bấm xác nhận. Dòng lỗi chặn nhập phải được xử lý.
              </p>
            </div>
            <Badge tone={hasBlockingErrors ? "danger" : "success"}>
              {hasBlockingErrors ? "Còn lỗi chặn nhập" : "Sẵn sàng nhập"}
            </Badge>
          </div>

          {crossIssues.length > 0 ? (
            <Notice tone="danger">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", flexWrap: "wrap" }}>
                <div>
                  <strong>MSSV trùng giữa các file/đợt ({crossIssues.length} vị trí):</strong>
                  <p style={{ margin: "4px 0 8px" }}>
                    Có thể bạn đang chọn đồng thời cả 2 mẫu (Bảng điểm thành phần và Danh sách thi DSTS) của cùng một lớp học phần.
                  </p>
                </div>
                <button
                  type="button"
                  className="button small"
                  onClick={() => {
                    const merged = mergeDuplicatePendingWorkbooks(pending, existingStudents);
                    setPending(merged.workbooks);
                    setLocalError(null);
                    onNotice(
                      "success",
                      `Đã gộp thông tin ${merged.mergedStudentCount} sinh viên trùng${merged.removedFileNames.length > 0 ? ` và loại bỏ ${merged.removedFileNames.length} file trùng (${merged.removedFileNames.join(", ")})` : ""}.`,
                    );
                  }}
                >
                  ⚡ Gộp thông tin & bỏ dòng/file trùng giữa 2 mẫu
                </button>
              </div>
              <ul>
                {crossIssues.slice(0, 10).map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
                {crossIssues.length > 10 ? (
                  <li>... và {crossIssues.length - 10} dòng trùng khác.</li>
                ) : null}
              </ul>
            </Notice>
          ) : null}

          <div className="pending-list">
            {pending.map((workbook) => (
              <PendingWorkbookCard
                key={workbook.tempId}
                workbook={workbook}
                onReanalyze={(options) => reanalyze(workbook, options)}
                onMappingChange={(key, rawValue) =>
                  handleMappingChange(workbook, key, rawValue)
                }
                onUpdateLecturers={(nextAdvisors) =>
                  handleUpdateLecturers(workbook, nextAdvisors)
                }
                onRemove={() =>
                  setPending((previous) =>
                    previous.filter((item) => item.tempId !== workbook.tempId),
                  )
                }
              />
            ))}
          </div>

          <div className="sticky-actions">
            <button
              type="button"
              className="button"
              disabled={hasBlockingErrors}
              onClick={handleImport}
            >
              Xác nhận nhập {pending.length} file
            </button>
            <span className="muted">
              {hasBlockingErrors
                ? "Cần sửa lỗi hoặc ánh xạ MSSV trước khi nhập."
                : "Thao tác này mới ghi dữ liệu vào đợt."}
            </span>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <h2>File nguồn đã nhập</h2>
        {sourceWorkbooks.length === 0 ? (
          <EmptyState title="Chưa nhập file nào" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>File</th>
                  <th>Mẫu / Học phần</th>
                  <th>Giảng viên hướng dẫn (GVHD)</th>
                  <th>Sheet</th>
                  <th>Sinh viên</th>
                  <th>Header</th>
                  <th>Nhập lúc</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {sourceWorkbooks.map((workbook) => (
                  <tr key={workbook.id}>
                    <td>
                      <strong>{workbook.fileName}</strong>
                    </td>
                    <td>
                      {workbook.sourceTemplate === "dsts" ? (
                        <Badge tone="purple">DSTS</Badge>
                      ) : workbook.sourceTemplate === "bang_diem" ? (
                        <Badge tone="info">Bảng điểm</Badge>
                      ) : (
                        <Badge tone="neutral">Tùy chỉnh</Badge>
                      )}{" "}
                      <small className="muted">{workbook.metaCourseCode || ""}</small>
                    </td>
                    <td>
                      <div>
                        <strong>{workbook.metaLecturerName || "—"}</strong>
                        {workbook.metaLecturerNames && workbook.metaLecturerNames.length > 1 ? (
                          <small style={{ display: "block", color: "var(--teal)" }}>
                            (Đồng hướng dẫn: {workbook.metaLecturerNames.join(" & ")})
                          </small>
                        ) : null}
                      </div>
                    </td>
                    <td>{workbook.sheetName}</td>
                    <td>
                      {
                        data.students.filter(
                          (student) => student.sourceWorkbookId === workbook.id,
                        ).length
                      }
                    </td>
                    <td>Dòng {workbook.headerRow + 1}</td>
                    <td>{new Date(workbook.importedAt).toLocaleString("vi-VN")}</td>
                    <td>
                      <div style={{ display: "flex", gap: "6px" }}>
                        <button
                          type="button"
                          className="button small secondary"
                          title="Sửa GVHD của file nếu nhập sai hoặc thiếu GVHD đồng hướng dẫn"
                          onClick={() => startEditWorkbook(workbook)}
                        >
                          ✏️ Sửa GVHD
                        </button>
                        <button
                          type="button"
                          className="button small ghost"
                          style={{ color: "var(--red)" }}
                          title="Xóa file này khỏi đợt"
                          onClick={() => handleDeleteWorkbook(workbook)}
                        >
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Datalist gợi ý tên giảng viên có sẵn trong đợt */}
      <datalist id="batch-lecturer-suggestions">
        {data.lecturers
          .filter((l) => l.batchId === batch?.id)
          .map((l) => (
            <option key={l.id} value={l.displayName} />
          ))}
      </datalist>

      {/* Modal sửa GVHD cho file nguồn đã nhập */}
      {editingWorkbook ? (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(16, 42, 67, 0.45)",
            backdropFilter: "blur(3px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "20px",
          }}
          onClick={() => setEditingWorkbook(null)}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: "14px",
              boxShadow: "0 20px 40px rgba(0,0,0,0.2)",
              maxWidth: "600px",
              width: "100%",
              padding: "24px",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                marginBottom: "16px",
              }}
            >
              <div>
                <h3 style={{ margin: "0 0 4px 0" }}>✏️ Sửa GVHD file đã nhập</h3>
                <p className="muted" style={{ margin: 0 }}>
                  File: <strong>{editingWorkbook.fileName}</strong> (
                  {
                    data.students.filter(
                      (s) => s.sourceWorkbookId === editingWorkbook.id,
                    ).length
                  }{" "}
                  sinh viên)
                </p>
              </div>
              <button
                type="button"
                className="button small ghost"
                onClick={() => setEditingWorkbook(null)}
                title="Đóng"
              >
                ✕
              </button>
            </div>

            <div
              style={{
                background: "var(--teal-soft)",
                padding: "10px 14px",
                borderRadius: "8px",
                marginBottom: "16px",
                fontSize: "0.88rem",
                color: "var(--teal)",
                border: "1px solid rgba(15, 118, 110, 0.2)",
              }}
            >
              💡 Hệ thống hỗ trợ 1 hoặc 2 GVHD (đồng hướng dẫn). Nếu tên mới chưa có trong đợt, hệ thống sẽ tự động thêm vào danh sách giảng viên và cập nhật phân nhóm liên quan.
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "12px",
                marginBottom: "20px",
              }}
            >
              {editingAdvisors.map((adv, idx) => (
                <label className="field" key={idx} style={{ margin: 0 }}>
                  <span>
                    {idx === 0
                      ? "GVHD chính (GVHD 1) *"
                      : `GVHD đồng hướng dẫn (GVHD ${idx + 1})`}
                  </span>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <input
                      type="text"
                      list="batch-lecturer-suggestions"
                      value={adv}
                      placeholder={`Nhập hoặc chọn tên GVHD ${idx + 1}...`}
                      onChange={(e) => {
                        const next = [...editingAdvisors];
                        next[idx] = e.target.value;
                        setEditingAdvisors(next);
                      }}
                    />
                    {idx > 0 ? (
                      <button
                        type="button"
                        className="button small ghost"
                        title="Xóa GVHD đồng hướng dẫn này"
                        onClick={() => {
                          const next = editingAdvisors.filter((_, i) => i !== idx);
                          setEditingAdvisors(next.length > 0 ? next : [""]);
                        }}
                      >
                        ✕
                      </button>
                    ) : null}
                  </div>
                </label>
              ))}

              {editingAdvisors.length < 2 ? (
                <div>
                  <button
                    type="button"
                    className="button small secondary"
                    onClick={() =>
                      setEditingAdvisors([...editingAdvisors, ""])
                    }
                  >
                    + Thêm GVHD đồng hướng dẫn
                  </button>
                </div>
              ) : null}
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "10px",
              }}
            >
              <button
                type="button"
                className="button secondary"
                onClick={() => setEditingWorkbook(null)}
              >
                Hủy
              </button>
              <button
                type="button"
                className="button"
                onClick={handleSaveWorkbookAdvisors}
              >
                Lưu thay đổi
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <LecturersPanel
        data={data}
        batch={batch}
        onDataChange={setData}
        onNotice={onNotice}
      />
    </div>
  );
}

function PendingWorkbookCard({
  workbook,
  onReanalyze,
  onMappingChange,
  onUpdateLecturers,
  onRemove,
}: {
  workbook: PendingWorkbook;
  onReanalyze: (options: {
    sheetName?: string;
    mapping?: ColumnMapping;
    metaLecturerName?: string | null;
    metaLecturerNames?: string[];
  }) => void;
  onMappingChange: (key: keyof ColumnMapping, rawValue: string) => void;
  onUpdateLecturers: (nextAdvisors: string[]) => void;
  onRemove: () => void;
}) {
  const [rowFilter, setRowFilter] = useState<
    "all" | "error" | "missing_group" | "warning" | "valid"
  >("all");
  const [showAllRows, setShowAllRows] = useState(false);

  const currentAdvisors = useMemo(() => {
    if (workbook.metaLecturerNames !== undefined && workbook.metaLecturerNames.length > 0) {
      return workbook.metaLecturerNames;
    }
    if (workbook.metaLecturerName) {
      return [workbook.metaLecturerName];
    }
    return [""];
  }, [workbook.metaLecturerNames, workbook.metaLecturerName]);

  function handleAdvisorChange(index: number, value: string) {
    const next = [...currentAdvisors];
    while (next.length <= index) next.push("");
    next[index] = value;
    onUpdateLecturers(next);
  }

  function handleAddCoAdvisor() {
    const next = [...currentAdvisors];
    while (next.length < 1) next.push("");
    if (next.length < 2) {
      next.push("");
    }
    onUpdateLecturers(next);
  }

  function handleRemoveAdvisor(index: number) {
    const next = currentAdvisors.filter((_, i) => i !== index);
    onUpdateLecturers(next.length > 0 ? next : [""]);
  }

  const errorRows = useMemo(
    () => workbook.rows.filter((r) => r.errors.length > 0),
    [workbook.rows],
  );

  const missingGroupRows = useMemo(
    () =>
      workbook.mapping.groupCode !== null
        ? workbook.rows.filter((r) => !r.groupCode)
        : [],
    [workbook.rows, workbook.mapping.groupCode],
  );

  const warningRows = useMemo(
    () =>
      workbook.rows.filter(
        (r) =>
          r.errors.length === 0 &&
          (r.warnings.length > 0 ||
            (!r.groupCode && workbook.mapping.groupCode !== null)),
      ),
    [workbook.rows, workbook.mapping.groupCode],
  );

  const validRows = useMemo(
    () =>
      workbook.rows.filter(
        (r) =>
          r.errors.length === 0 &&
          r.warnings.length === 0 &&
          (workbook.mapping.groupCode === null || Boolean(r.groupCode)),
      ),
    [workbook.rows, workbook.mapping.groupCode],
  );

  const filteredRows = useMemo(() => {
    if (rowFilter === "error") return errorRows;
    if (rowFilter === "missing_group") return missingGroupRows;
    if (rowFilter === "warning") return warningRows;
    if (rowFilter === "valid") return validRows;
    return workbook.rows;
  }, [
    rowFilter,
    errorRows,
    missingGroupRows,
    warningRows,
    validRows,
    workbook.rows,
  ]);

  const displayLimit = showAllRows ? filteredRows.length : 25;
  const displayRows = filteredRows.slice(0, displayLimit);
  const validation = workbook.validation;

  return (
    <article className="pending-card">
      <div className="pending-header">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <h3>{workbook.fileName}</h3>
            {workbook.sourceTemplate === "dsts" ? (
              <Badge tone="purple">Mẫu DSTS (Danh sách thi)</Badge>
            ) : workbook.sourceTemplate === "bang_diem" ? (
              <Badge tone="info">Mẫu Bảng điểm</Badge>
            ) : (
              <Badge tone="neutral">Mẫu tùy chỉnh</Badge>
            )}
          </div>
          <p className="muted">
            {workbook.rows.length} dòng dữ liệu · header ở dòng {workbook.headerRow + 1}
          </p>
        </div>
        <button
          type="button"
          className="button small ghost"
          onClick={onRemove}
        >
          Bỏ file này
        </button>
      </div>

      <div className="form-grid">
        <label className="field">
          <span>Sheet</span>
          <select
            value={workbook.sheetName}
            onChange={(event) =>
              onReanalyze({ sheetName: event.target.value })
            }
          >
            {workbook.sheetNames.map((sheet) => (
              <option key={sheet} value={sheet}>
                {sheet}
              </option>
            ))}
          </select>
        </label>
        {workbook.metaCourseCode ? (
          <div className="field">
            <span>Mã học phần đọc từ sheet</span>
            <strong>{workbook.metaCourseCode}</strong>
          </div>
        ) : null}
        {workbook.metaCourseName ? (
          <div className="field">
            <span>Tên học phần đọc từ sheet</span>
            <strong>{workbook.metaCourseName}</strong>
          </div>
        ) : null}
      </div>

      <div
        style={{
          marginTop: "12px",
          marginBottom: "12px",
          padding: "12px",
          background: "var(--surface-sunken)",
          borderRadius: "8px",
          border: "1px solid var(--border-soft)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "8px",
            flexWrap: "wrap",
            gap: "8px",
          }}
        >
          <div>
            <strong>👨‍🏫 Giảng viên hướng dẫn (GVHD) của file</strong>
            <small style={{ display: "block", color: "var(--muted)" }}>
              Hệ thống hỗ trợ 1 hoặc 2 giảng viên cùng hướng dẫn (đồng hướng dẫn). GVHD sẽ được lưu và tự động loại trừ khi phân công chấm.
            </small>
          </div>
          {currentAdvisors.length < 2 ? (
            <button
              type="button"
              className="button small secondary"
              onClick={handleAddCoAdvisor}
            >
              + Thêm GVHD đồng hướng dẫn
            </button>
          ) : null}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              currentAdvisors.length > 1 ? "1fr 1fr" : "1fr",
            gap: "12px",
          }}
        >
          {currentAdvisors.map((adv, idx) => (
            <label className="field" key={idx} style={{ margin: 0 }}>
              <span>
                {idx === 0
                  ? "GVHD chính (GVHD 1)"
                  : `GVHD đồng hướng dẫn (GVHD ${idx + 1})`}
              </span>
              <div style={{ display: "flex", gap: "6px" }}>
                <input
                  type="text"
                  list="batch-lecturer-suggestions"
                  value={adv}
                  placeholder={`Nhập tên GVHD ${idx + 1}...`}
                  onChange={(e) => handleAdvisorChange(idx, e.target.value)}
                />
                {idx > 0 ? (
                  <button
                    type="button"
                    className="button small ghost"
                    title="Xóa GVHD đồng hướng dẫn"
                    onClick={() => handleRemoveAdvisor(idx)}
                  >
                    ✕
                  </button>
                ) : null}
              </div>
            </label>
          ))}
        </div>
      </div>

      <div className="mapping-grid">
        {MAPPING_FIELDS.map((field) => (
          <label className="field" key={field.key}>
            <span>
              {field.label} {field.required ? <b className="required">*</b> : null}
            </span>
            <select
              value={workbook.mapping[field.key] ?? ""}
              onChange={(event) =>
                onMappingChange(field.key, event.target.value)
              }
            >
              <option value="">— Không ánh xạ —</option>
              {workbook.headers.map((header, index) => (
                <option value={index} key={`${field.key}-${index}`}>
                  Cột {columnLabel(index)}
                  {header ? ` – ${header}` : " (trống)"}
                </option>
              ))}
            </select>
            {field.hint ? <small>{field.hint}</small> : null}
          </label>
        ))}
      </div>

      {/* Báo cáo kiểm tra sơ bộ dữ liệu */}
      {validation ? (
        <div className="inspection-card">
          <div className="inspection-header">
            <strong>Báo cáo kiểm tra sơ bộ dữ liệu file</strong>
            {validation.errorRowCount > 0 ? (
              <Badge tone="danger">Có lỗi chặn nhập</Badge>
            ) : validation.hasRiskOfMisassignment ? (
              <Badge tone="warning">Cảnh báo nguy cơ phân chấm sai</Badge>
            ) : (
              <Badge tone="success">Dữ liệu an toàn</Badge>
            )}
          </div>

          <div className="inspection-metrics">
            <div className="inspection-metric">
              <span className="metric-label">Thông tin Nhóm PBL</span>
              {validation.groupInspection.hasGroupColumn ? (
                <div>
                  <strong className="metric-val">
                    {validation.groupInspection.groupCount} nhóm
                  </strong>
                  <div className="metric-sub">
                    {validation.groupInspection.assignedStudentCount} SV đã có nhóm
                    {validation.groupInspection.missingGroupCount > 0 ? (
                      <span className="text-danger">
                        {" "}· {validation.groupInspection.missingGroupCount} SV thiếu nhóm
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div>
                  <span className="badge badge-warning">Chưa ánh xạ cột Nhóm</span>
                  <div className="metric-sub">Cần gán nhóm thủ công sau khi nhập</div>
                </div>
              )}
            </div>

            <div className="inspection-metric">
              <span className="metric-label">Mã số sinh viên (MSSV)</span>
              <div>
                <strong className="metric-val">
                  {validation.validRowCount}/{workbook.rows.length} hợp lệ
                </strong>
                <div className="metric-sub">
                  {validation.mssvIssues.emptyCount > 0
                    ? `${validation.mssvIssues.emptyCount} trống · `
                    : ""}
                  {validation.mssvIssues.duplicateCount > 0
                    ? `${validation.mssvIssues.duplicateCount} trùng · `
                    : ""}
                  {validation.mssvIssues.placeholderCount > 0
                    ? `${validation.mssvIssues.placeholderCount} mã giả · `
                    : ""}
                  {validation.mssvIssues.formatIssueCount > 0
                    ? `${validation.mssvIssues.formatIssueCount} định dạng lạ`
                    : "Định dạng tốt"}
                </div>
              </div>
            </div>

            <div className="inspection-metric">
              <span className="metric-label">Học phần & Lớp</span>
              <div>
                <strong className="metric-val">
                  {workbook.metaCourseCode || workbook.mapping.courseCode !== null
                    ? workbook.metaCourseCode || "Đã ánh xạ mã HP"
                    : "Chưa có mã HP"}
                </strong>
                <div className="metric-sub">
                  {workbook.metaCourseName || workbook.mapping.courseName !== null
                    ? workbook.metaCourseName || "Đã ánh xạ tên HP"
                    : "Chưa có tên HP"}
                </div>
              </div>
            </div>
          </div>

          {validation.criticalNotes.length > 0 ? (
            <div className="inspection-alerts">
              <div className="alert-title">⚠️ Lưu ý để tránh phân chấm sai:</div>
              <ul>
                {validation.criticalNotes.map((note, index) => (
                  <li key={index}>{note}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {workbook.errors.length > 0 ? (
        <div className="inline-errors">
          {workbook.errors.map((error) => (
            <p key={error}>⛔ {error}</p>
          ))}
        </div>
      ) : null}
      {workbook.warnings.length > 0 ? (
        <div className="inline-warnings">
          {workbook.warnings.map((warning) => (
            <p key={warning}>⚠ {warning}</p>
          ))}
        </div>
      ) : null}

      {/* Thanh công cụ lọc dòng xem trước */}
      <div className="preview-toolbar">
        <div className="filter-tabs">
          <button
            type="button"
            className={`tab-btn ${rowFilter === "all" ? "active" : ""}`}
            onClick={() => setRowFilter("all")}
          >
            Tất cả ({workbook.rows.length})
          </button>
          <button
            type="button"
            className={`tab-btn tab-danger ${rowFilter === "error" ? "active" : ""}`}
            onClick={() => setRowFilter("error")}
            disabled={errorRows.length === 0}
          >
            Lỗi chặn ({errorRows.length})
          </button>
          {workbook.mapping.groupCode !== null ? (
            <button
              type="button"
              className={`tab-btn tab-warning ${rowFilter === "missing_group" ? "active" : ""}`}
              onClick={() => setRowFilter("missing_group")}
              disabled={missingGroupRows.length === 0}
            >
              Thiếu nhóm ({missingGroupRows.length})
            </button>
          ) : null}
          <button
            type="button"
            className={`tab-btn tab-warning ${rowFilter === "warning" ? "active" : ""}`}
            onClick={() => setRowFilter("warning")}
            disabled={warningRows.length === 0}
          >
            Cảnh báo ({warningRows.length})
          </button>
          <button
            type="button"
            className={`tab-btn ${rowFilter === "valid" ? "active" : ""}`}
            onClick={() => setRowFilter("valid")}
          >
            Hợp lệ ({validRows.length})
          </button>
        </div>

        <small className="muted">
          Đang hiển thị {displayRows.length}/{filteredRows.length} dòng
        </small>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Dòng</th>
              <th>MSSV</th>
              <th>Họ tên</th>
              <th>Lớp</th>
              <th>Mã HP</th>
              <th>Nhóm nguồn</th>
              <th>GVHD</th>
              <th>Trạng thái kiểm tra</th>
            </tr>
          </thead>
          <tbody>
            {displayRows.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ textAlign: "center", padding: "16px", color: "var(--muted)" }}>
                  Không có dòng nào theo bộ lọc này.
                </td>
              </tr>
            ) : (
              displayRows.map((row) => {
                const isMissingGroup =
                  workbook.mapping.groupCode !== null && !row.groupCode;
                const hasError = row.errors.length > 0;
                const hasWarning = row.warnings.length > 0;
                const rowAdvisor =
                  row.advisorName ||
                  (workbook.metaLecturerNames?.length
                    ? workbook.metaLecturerNames.filter(Boolean).join(", ")
                    : workbook.metaLecturerName || "");

                return (
                  <tr
                    key={`${workbook.tempId}-${row.sourceRowNumber}`}
                    style={{
                      background: hasError
                        ? "var(--red-soft)"
                        : isMissingGroup
                          ? "var(--amber-soft)"
                          : undefined,
                    }}
                  >
                    <td>{row.sourceRowNumber}</td>
                    <td>
                      <strong>{row.mssv || "—"}</strong>
                    </td>
                    <td>{row.name || "—"}</td>
                    <td>{row.className || "—"}</td>
                    <td>{row.courseCode || "—"}</td>
                    <td>
                      {row.groupCode ? (
                        <Badge tone="info">{row.groupCode}</Badge>
                      ) : workbook.mapping.groupCode !== null ? (
                        <Badge tone="danger">Chưa có nhóm</Badge>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{rowAdvisor || "—"}</td>
                    <td>
                      {hasError ? (
                        <Badge tone="danger">{row.errors.join("; ")}</Badge>
                      ) : isMissingGroup ? (
                        <Badge tone="warning">Thiếu mã nhóm</Badge>
                      ) : hasWarning ? (
                        <Badge tone="warning">{row.warnings.join("; ")}</Badge>
                      ) : (
                        <Badge tone="success">Hợp lệ</Badge>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {filteredRows.length > 25 ? (
        <div style={{ marginTop: "8px", textAlign: "center" }}>
          <button
            type="button"
            className="button small secondary"
            onClick={() => setShowAllRows(!showAllRows)}
          >
            {showAllRows
              ? "Thu gọn còn 25 dòng đầu"
              : `Xem tất cả ${filteredRows.length} dòng`}
          </button>
        </div>
      ) : null}
    </article>
  );
}
