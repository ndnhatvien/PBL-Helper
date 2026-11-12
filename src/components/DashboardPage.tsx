import { useState } from "react";
import type { ExamBatch } from "../types";
import type { AppData } from "../store/store";
import type { DashboardStats } from "../domain/selectors";
import { buildBatch } from "../store/store";
import { addBatch } from "../store/actions";
import {
  Badge,
  EmptyState,
  Notice,
  PageHeader,
  ProgressBar,
  StatCard,
} from "./shared";

interface DashboardProps {
  data: AppData;
  batch: ExamBatch | null;
  stats: DashboardStats;
  onDataChange: (next: AppData) => void;
  onCreateDemo: () => void;
  onReset: () => void;
  onNavigate: (page: string) => void;
  notice: { tone: "info" | "success" | "warning" | "danger"; text: string } | null;
  onCloseNotice: () => void;
}

export function DashboardPage({
  data,
  batch,
  stats,
  onDataChange,
  onCreateDemo,
  onReset,
  onNavigate,
  notice,
  onCloseNotice,
}: DashboardProps) {
  const [name, setName] = useState("");
  const [term, setTerm] = useState("");
  const [examDate, setExamDate] = useState("");
  const [note, setNote] = useState("");
  const [minimum, setMinimum] = useState("0");
  const [maximum, setMaximum] = useState("10");
  const [decimals, setDecimals] = useState("1");
  const [confirmed, setConfirmed] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (!name.trim()) {
      setFormError("Vui lòng nhập tên đợt thi.");
      return;
    }
    const min = Number(minimum);
    const max = Number(maximum);
    const dec = Number(decimals);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
      setFormError("Thang điểm không hợp lệ: điểm tối thiểu phải nhỏ hơn tối đa.");
      return;
    }
    if (!Number.isInteger(dec) || dec < 0 || dec > 3) {
      setFormError("Số chữ số thập phân phải là số nguyên từ 0 đến 3.");
      return;
    }
    if (!confirmed) {
      setFormError(
        "Cần xác nhận cấu hình thang điểm trước khi tạo đợt (không dùng mặc định ngầm).",
      );
      return;
    }
    const batch = buildBatch({
      name,
      term,
      examDate,
      note,
      scoreConfig: {
        min,
        max,
        decimals: dec,
        isDemoDefault: false,
      },
    });
    onDataChange(addBatch(data, batch));
    setName("");
    setTerm("");
    setExamDate("");
    setNote("");
    setConfirmed(false);
  }

  return (
    <div className="page">
      <PageHeader
        title="Tổng quan đợt chấm"
        description="Theo dõi dữ liệu nguồn, nhóm PBL, phân công chấm và tiến độ rà soát điểm."
        actions={
          <>
            <button type="button" className="button secondary" onClick={() => onNavigate("import")}>
              Nhập Excel
            </button>
            <button type="button" className="button" onClick={onCreateDemo}>
              Tạo dữ liệu demo
            </button>
          </>
        }
      />

      {notice ? (
        <Notice tone={notice.tone} onClose={onCloseNotice}>
          {notice.text}
        </Notice>
      ) : null}

      <div className="banner banner-warning">
        <strong>Lưu ý phạm vi MVP:</strong> ứng dụng chạy cục bộ trên trình duyệt, lưu dữ liệu
        trong localStorage của máy hiện tại. Bộ chọn vai trò chỉ để mô phỏng luồng nghiệp vụ,
        <strong> không phải đăng nhập hay phân quyền an toàn</strong>. Không đưa dữ liệu sinh viên
        thật lên môi trường dùng chung trước khi bổ sung xác thực, phân quyền phía máy chủ và RLS.
      </div>

      {batch ? (
        <>
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>{batch.name}</h2>
                <p>
                  {batch.term || "Chưa ghi học kỳ"} ·{" "}
                  {batch.examDate || "Chưa ghi ngày thi"} ·{" "}
                  <Badge tone={batch.isDemo ? "purple" : "info"}>
                    {batch.isDemo ? "DỮ LIỆU DEMO" : "ĐỢT THẬT"}
                  </Badge>
                </p>
              </div>
              <div className="score-config">
                Thang điểm: <strong>{batch.scoreConfig.min}–{batch.scoreConfig.max}</strong>,{" "}
                {batch.scoreConfig.decimals} chữ số thập phân
                {batch.scoreConfig.isDemoDefault ? (
                  <Badge tone="warning">cấu hình demo</Badge>
                ) : null}
              </div>
            </div>

            <div className="stat-grid">
              <StatCard label="File nguồn" value={stats.sourceCount} />
              <StatCard label="Tổng sinh viên" value={stats.studentCount} />
              <StatCard label="Nhóm PBL" value={stats.groupCount} />
              <StatCard label="Giảng viên chấm" value={stats.graderCount} />
              <StatCard
                label="Đã có điểm"
                value={stats.scoredCount}
                tone="success"
                hint={
                  stats.studentCount > 0
                    ? `${Math.round((stats.scoredCount / stats.studentCount) * 100)}% sinh viên`
                    : undefined
                }
              />
              <StatCard
                label="Chờ rà soát"
                value={stats.pendingReview}
                tone="warning"
              />
              <StatCard label="Đã duyệt" value={stats.approved} tone="success" />
              <StatCard
                label="Cần kiểm tra lại"
                value={stats.needsChanges}
                tone="danger"
              />
            </div>

            <div className="progress-grid">
              <ProgressBar
                label="Tiến độ nhập điểm"
                value={stats.scoredCount}
                max={stats.studentCount}
              />
              <ProgressBar
                label="Tiến độ rà soát (đã duyệt)"
                value={stats.approved}
                max={stats.studentCount}
              />
            </div>

            <div className="quick-actions">
              <button type="button" className="button secondary" onClick={() => onNavigate("groups")}>
                Quản lý nhóm PBL
              </button>
              <button type="button" className="button secondary" onClick={() => onNavigate("assignment")}>
                Phân công chấm
              </button>
              <button type="button" className="button secondary" onClick={() => onNavigate("grader-export")}>
                Xuất file chấm
              </button>
              <button type="button" className="button secondary" onClick={() => onNavigate("graded-import")}>
                Nhập điểm đã chấm
              </button>
              <button type="button" className="button secondary" onClick={() => onNavigate("review")}>
                GVHD rà soát
              </button>
              <button type="button" className="button secondary" onClick={() => onNavigate("final-export")}>
                Xuất danh sách cuối
              </button>
            </div>
          </section>

          <div className="two-column">
            <section className="panel">
              <h2>Cảnh báo dữ liệu</h2>
              {stats.warnings.length === 0 ? (
                <EmptyState title="Không có cảnh báo">Dữ liệu đang nhất quán.</EmptyState>
              ) : (
                <ul className="warning-list">
                  {stats.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}
            </section>

            <section className="panel">
              <h2>Quy trình gợi ý</h2>
              <ol className="steps">
                <li>Nhập một hoặc nhiều file Excel, chọn sheet và ánh xạ cột.</li>
                <li>Tạo nhóm PBL, gán GVHD mặc định và GVHD ngoại lệ nếu có.</li>
                <li>Thêm giảng viên chấm, dùng gợi ý cân bằng và chỉnh thủ công.</li>
                <li>Xuất phiếu chấm theo từng giảng viên.</li>
                <li>Nhập các file đã chấm, kiểm tra xung đột rồi xác nhận.</li>
                <li>GVHD rà soát theo từng sinh viên.</li>
                <li>Xuất lại từng file nguồn với điểm đã cập nhật.</li>
              </ol>
            </section>
          </div>
        </>
      ) : (
        <EmptyState title="Chưa có đợt thi">
          Tạo đợt thi mới bên dưới hoặc bấm <strong>Tạo dữ liệu demo</strong> để xem toàn bộ luồng.
        </EmptyState>
      )}

      <div className="two-column">
        <section className="panel">
          <h2>Tạo đợt thi mới</h2>
          <form className="form-grid" onSubmit={handleCreate}>
            <label className="field field-span-2">
              <span>Tên đợt thi *</span>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="VD: Chấm PBL HK1 2026–2027" />
            </label>
            <label className="field">
              <span>Học kỳ</span>
              <input value={term} onChange={(event) => setTerm(event.target.value)} placeholder="VD: HK1 2026–2027" />
            </label>
            <label className="field">
              <span>Ngày thi</span>
              <input type="date" value={examDate} onChange={(event) => setExamDate(event.target.value)} />
            </label>
            <label className="field field-span-2">
              <span>Ghi chú</span>
              <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} />
            </label>
            <label className="field">
              <span>Điểm tối thiểu</span>
              <input type="number" step="0.1" value={minimum} onChange={(event) => setMinimum(event.target.value)} />
            </label>
            <label className="field">
              <span>Điểm tối đa</span>
              <input type="number" step="0.1" value={maximum} onChange={(event) => setMaximum(event.target.value)} />
            </label>
            <label className="field">
              <span>Số chữ số thập phân</span>
              <input type="number" min={0} max={3} value={decimals} onChange={(event) => setDecimals(event.target.value)} />
            </label>
            <label className="checkbox-line field-span-2">
              <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
              <span>
                Tôi xác nhận cấu hình thang điểm <strong>{minimum}–{maximum}</strong>, tối đa{" "}
                {decimals} chữ số thập phân cho đợt này. Các giá trị đang điền chỉ là mẫu, không phải mặc định ngầm.
              </span>
            </label>
            {formError ? <p className="form-error field-span-2">{formError}</p> : null}
            <div className="field-span-2">
              <button type="submit" className="button">Tạo đợt thi</button>
            </div>
          </form>
        </section>

        <section className="panel">
          <h2>Các đợt đã có</h2>
          {data.batches.length === 0 ? (
            <EmptyState title="Chưa có đợt thi" />
          ) : (
            <ul className="batch-list">
              {data.batches.map((item) => (
                <li key={item.id} className={item.id === batch?.id ? "active" : ""}>
                  <div>
                    <strong>{item.name}</strong>
                    <span>
                      {item.term || "—"} · {item.isDemo ? "Demo" : "Thật"} ·{" "}
                      {data.students.filter((student) => student.batchId === item.id).length} sinh viên
                    </span>
                  </div>
                  <button
                    type="button"
                    className="button small secondary"
                    onClick={() => onDataChange({ ...data, activeBatchId: item.id, currentRole: "coordinator", currentLecturerId: null })}
                  >
                    {item.id === batch?.id ? "Đang chọn" : "Chọn"}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <hr />
          <h3>Dữ liệu cục bộ</h3>
          <p className="muted">
            Toàn bộ dữ liệu và file gốc (dạng base64) nằm trong localStorage của trình duyệt này.
            Xóa dữ liệu trình duyệt sẽ mất dữ liệu. Dung lượng localStorage thường giới hạn khoảng 5–10 MB.
          </p>
          <button
            type="button"
            className="button danger"
            onClick={() => {
              if (window.confirm("Xóa toàn bộ dữ liệu cục bộ? Thao tác không thể hoàn tác.")) {
                onReset();
              }
            }}
          >
            Xóa toàn bộ dữ liệu cục bộ
          </button>
        </section>
      </div>
    </div>
  );
}
