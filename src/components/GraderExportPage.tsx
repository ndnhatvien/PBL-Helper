import { useMemo, useState } from "react";
import type { BatchContext } from "../domain/selectors";
import { getGroupViews } from "../domain/selectors";
import type { AppData } from "../store/store";
import type { ExamBatch, Lecturer } from "../types";
import { exportGraderWorkbooks, type GraderExportFile } from "../excel/grader";
import { updateLecturer } from "../store/actions";
import { downloadBlob, arrayBufferToBlob } from "../utils/base64";
import { Badge, EditableRoomCell, EmptyState, Notice, PageHeader, StatCard } from "./shared";

export function GraderExportPage({
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
  setData: (next: AppData) => void;
  context: BatchContext;
  batch: ExamBatch | null;
  onNavigate: (page: string) => void;
  onNotice: (tone: "info" | "success" | "warning" | "danger", text: string) => void;
  notice: { tone: "info" | "success" | "warning" | "danger"; text: string } | null;
  onCloseNotice: () => void;
}) {
  const [lastExport, setLastExport] = useState<GraderExportFile[]>([]);
  const groupViews = useMemo(() => getGroupViews(context), [context]);
  const assigned = useMemo(
    () =>
      groupViews
        .filter((view) => view.group.graderId)
        .reduce<Map<string, { groupCount: number; studentCount: number }>>(
          (map, view) => {
            const current = map.get(view.group.graderId as string) ?? {
              groupCount: 0,
              studentCount: 0,
            };
            current.groupCount += 1;
            current.studentCount += view.studentCount;
            map.set(view.group.graderId as string, current);
            return map;
          },
          new Map(),
        ),
    [groupViews],
  );
  const graders = context.lecturers.filter((lecturer) => assigned.has(lecturer.id));
  const unassignedGroups = groupViews.filter((view) => !view.group.graderId);
  const missingRoomCount = graders.filter((g) => !g.room?.trim()).length;

  if (!batch) {
    return (
      <div className="page">
        <PageHeader title="Xuất file chấm" description="Chọn đợt thi trước." />
        <EmptyState title="Chưa có đợt thi" />
      </div>
    );
  }

  function exportFor(targets: Lecturer[]) {
    const files = exportGraderWorkbooks({
      batch: batch as ExamBatch,
      students: context.students,
      groups: context.groups,
      members: context.members,
      lecturers: context.lecturers,
      scores: context.scores,
      graders: targets,
      sourceWorkbooks: context.sourceWorkbooks,
    });
    setLastExport(files);
    files.forEach((file, index) => {
      window.setTimeout(() => {
        downloadBlob(arrayBufferToBlob(file.buffer), file.fileName);
      }, index * 250);
    });
    onNotice(
      "success",
      `Đã tạo ${files.length} file chấm. Nếu trình duyệt chặn tải nhiều file, hãy dùng nút tải từng file bên dưới.`,
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="Xuất phiếu chấm theo giảng viên"
        description="Mỗi giảng viên chấm nhận một file Excel chỉ chứa các nhóm được giao. File có cột studentKey ẩn để đối soát khi nhập lại."
        actions={
          <button type="button" className="button secondary" onClick={() => onNavigate("graded-import")}>
            Sang nhập điểm đã chấm
          </button>
        }
      />

      {notice ? (
        <Notice tone={notice.tone} onClose={onCloseNotice}>
          {notice.text}
        </Notice>
      ) : null}

      <div className="stat-grid">
        <StatCard label="Giảng viên đã phân công" value={graders.length} />
        <StatCard
          label="Nhóm đã phân công"
          value={groupViews.length - unassignedGroups.length}
          tone="success"
        />
        <StatCard
          label="Nhóm chưa phân công"
          value={unassignedGroups.length}
          tone={unassignedGroups.length > 0 ? "danger" : "default"}
        />
      </div>

      {unassignedGroups.length > 0 ? (
        <Notice tone="warning">
          Còn {unassignedGroups.length} nhóm chưa được phân công giảng viên chấm:{" "}
          {unassignedGroups.map((view) => view.group.groupCode).join(", ")}. Các nhóm này sẽ không
          xuất hiện trong phiếu chấm.
        </Notice>
      ) : null}

      {missingRoomCount > 0 ? (
        <Notice tone="info">
          Có {missingRoomCount} giảng viên chấm chưa có thông tin phòng chấm (địa điểm báo cáo). Bạn có thể nhập/sửa trực tiếp tại cột &quot;Phòng chấm&quot; bên dưới trước khi tải file.
        </Notice>
      ) : null}

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>File theo giảng viên</h2>
            <p className="muted">
              Không dùng số thứ tự dòng Excel làm khóa nhận diện. Khóa ổn định nằm ở cột A (ẩn).
            </p>
          </div>
          {graders.length > 0 ? (
            <button type="button" className="button" onClick={() => exportFor(graders)}>
              Tải tất cả ({graders.length} file)
            </button>
          ) : null}
        </div>

        {graders.length === 0 ? (
          <EmptyState title="Chưa có giảng viên nào được phân công">
            Vào trang Phân công chấm để gợi ý hoặc gán thủ công.
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Giảng viên</th>
                  <th>Phòng chấm</th>
                  <th>Số nhóm</th>
                  <th>Số sinh viên</th>
                  <th>Tên file dự kiến</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {graders.map((grader) => {
                  const stats = assigned.get(grader.id);
                  return (
                    <tr key={grader.id}>
                      <td>{grader.displayName}</td>
                      <td>
                        <EditableRoomCell
                          value={grader.room ?? ""}
                          placeholder="Chưa xếp phòng"
                          onSave={(next) => {
                            setData(updateLecturer(data, grader.id, { room: next }));
                            onNotice(
                              "success",
                              `Đã cập nhật phòng chấm cho ${grader.displayName}: ${next || "(trống)"}`,
                            );
                          }}
                        />
                      </td>
                      <td>{stats?.groupCount ?? 0}</td>
                      <td>{stats?.studentCount ?? 0}</td>
                      <td>
                        <code>Phieu_cham_{grader.displayName}.xlsx</code>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="button small"
                          onClick={() => exportFor([grader])}
                        >
                          Tải file
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {lastExport.length > 0 ? (
        <section className="panel">
          <h2>File vừa tạo</h2>
          <div className="download-list">
            {lastExport.map((file) => (
              <div className="download-item" key={file.grader.id}>
                <div>
                  <strong>{file.fileName}</strong>
                  <small>
                    {file.groupCount} nhóm · {file.studentCount} sinh viên · Phòng: {file.grader.room?.trim() ? file.grader.room.trim() : "Chưa có"}
                  </small>
                </div>
                <button
                  type="button"
                  className="button small secondary"
                  onClick={() => downloadBlob(arrayBufferToBlob(file.buffer), file.fileName)}
                >
                  Tải lại
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="panel">
        <h2>Hướng dẫn gửi giảng viên</h2>
        <ul className="plain-list">
          <li>Mỗi giảng viên chỉ nhận file chứa nhóm của mình, không thấy dữ liệu nhóm khác.</li>
          <li>Thông tin phòng chấm (địa điểm báo cáo) hiển thị ở dòng đầu phiếu để sinh viên và giảng viên biết nơi tập trung.</li>
          <li>Giảng viên chỉ nhập cột <strong>Điểm</strong>, không sửa cột khóa hoặc dòng mã đợt.</li>
          <li>Thang điểm hiện tại: <Badge tone="info">{batch.scoreConfig.min}–{batch.scoreConfig.max}</Badge>, tối đa {batch.scoreConfig.decimals} chữ số thập phân.</li>
          <li>Sau khi nhận lại, điều phối viên nhập file ở trang “Nhập điểm đã chấm” để kiểm tra trước khi ghi.</li>
        </ul>
      </section>
    </div>
  );
}
