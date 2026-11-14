import { useMemo, useState } from "react";
import type { BalanceMode } from "../domain/assignment";
import { suggestAssignment } from "../domain/assignment";
import type { BatchContext } from "../domain/selectors";
import { getGroupViews } from "../domain/selectors";
import type { AppData } from "../store/store";
import type { ExamBatch } from "../types";
import { applyAssignments, updateGroup, updateLecturer } from "../store/actions";
import { Badge, EditableRoomCell, EmptyState, Notice, PageHeader } from "./shared";
import { LecturersPanel } from "./LecturersPanel";

export function AssignmentPage({
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
  const [mode, setMode] = useState<BalanceMode>("students");
  const groupViews = useMemo(() => getGroupViews(context), [context]);
  const activeLecturers = context.lecturers.filter((lecturer) => lecturer.active);
  const lecturerById = useMemo(
    () => new Map(context.lecturers.map((lecturer) => [lecturer.id, lecturer])),
    [context.lecturers],
  );

  const workload = useMemo(
    () =>
      activeLecturers
        .map((lecturer) => {
          const groups = groupViews.filter(
            (view) => view.group.graderId === lecturer.id,
          );
          return {
            lecturer,
            groupCount: groups.length,
            studentCount: groups.reduce(
              (total, view) => total + view.studentCount,
              0,
            ),
          };
        })
        .sort((a, b) => b.studentCount - a.studentCount),
    [activeLecturers, groupViews],
  );

  if (!batch) {
    return (
      <div className="page">
        <PageHeader title="Phân công giảng viên chấm" description="Chọn đợt thi trước." />
        <EmptyState title="Chưa có đợt thi" />
      </div>
    );
  }

  function handleSuggest() {
    if (groupViews.length === 0) {
      onNotice("danger", "Chưa có nhóm PBL để phân công.");
      return;
    }
    if (activeLecturers.length === 0) {
      onNotice("danger", "Chưa có giảng viên đang hoạt động. Hãy thêm giảng viên trước.");
      return;
    }
    const result = suggestAssignment(
      groupViews.map((view) => ({
        id: view.group.id,
        groupCode: view.group.groupCode,
        studentCount: view.studentCount,
        sourceWorkbookId:
          view.members[0]?.student.sourceWorkbookId ||
          context.students.find((s) =>
            context.members.some(
              (m) => m.groupId === view.group.id && m.studentId === s.id,
            ),
          )?.sourceWorkbookId,
      })),
      activeLecturers.map((lecturer) => lecturer.id),
      mode,
    );
    setData(applyAssignments(data, result.assignments));
    onNotice(
      "success",
      `Đã gợi ý phân công theo ${mode === "students" ? "số sinh viên" : "số nhóm"}. Có thể chỉnh thủ công từng nhóm.`,
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="Phân công giảng viên chấm"
        description="Cân bằng khối lượng theo số sinh viên (mặc định) hoặc theo số nhóm. Nhóm PBL luôn là đơn vị nguyên vẹn."
        actions={
          <button type="button" className="button secondary" onClick={() => onNavigate("grader-export")}>
            Sang xuất file chấm
          </button>
        }
      />

      {notice ? (
        <Notice tone={notice.tone} onClose={onCloseNotice}>
          {notice.text}
        </Notice>
      ) : null}

      <LecturersPanel data={data} batch={batch} onDataChange={setData} onNotice={onNotice} />

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Gợi ý phân công</h2>
            <p className="muted">
              Thuật toán sắp xếp nhóm giảm dần theo sĩ số, chọn giảng viên có tổng sinh viên ít
              nhất; hòa thì ưu tiên người ít nhóm hơn, sau đó theo thứ tự ổn định.
            </p>
          </div>
          <Badge tone="info">{groupViews.length} nhóm</Badge>
        </div>

        <div className="radio-row">
          <label className="checkbox-line">
            <input
              type="radio"
              name="balance-mode"
              checked={mode === "students"}
              onChange={() => setMode("students")}
            />
            <span>Cân bằng theo số sinh viên (mặc định)</span>
          </label>
          <label className="checkbox-line">
            <input
              type="radio"
              name="balance-mode"
              checked={mode === "groups"}
              onChange={() => setMode("groups")}
            />
            <span>Cân bằng theo số nhóm</span>
          </label>
          <button type="button" className="button" onClick={handleSuggest}>
            Gợi ý phân công
          </button>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Giảng viên chấm</th>
                <th>Email</th>
                <th>Phòng chấm</th>
                <th>Số nhóm</th>
                <th>Số sinh viên</th>
              </tr>
            </thead>
            <tbody>
              {workload.map((row) => (
                <tr key={row.lecturer.id}>
                  <td>{row.lecturer.displayName}</td>
                  <td>{row.lecturer.email || "—"}</td>
                  <td>
                    <EditableRoomCell
                      value={row.lecturer.room ?? ""}
                      onSave={(next) => {
                        setData(updateLecturer(data, row.lecturer.id, { room: next }));
                        onNotice(
                          "success",
                          `Đã cập nhật phòng chấm cho ${row.lecturer.displayName}: ${next || "(trống)"}`,
                        );
                      }}
                    />
                  </td>
                  <td>{row.groupCount}</td>
                  <td>{row.studentCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h2>Điều chỉnh thủ công</h2>
        {groupViews.length === 0 ? (
          <EmptyState title="Chưa có nhóm PBL">Tạo nhóm trước khi phân công.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nhóm</th>
                  <th>Số sinh viên</th>
                  <th>GVHD mặc định</th>
                  <th>Giảng viên chấm</th>
                </tr>
              </thead>
              <tbody>
                {groupViews.map((view) => (
                  <tr key={view.group.id}>
                    <td>
                      {view.group.groupCode}
                      {view.sizeWarning ? (
                        <small className="cell-sub">{view.sizeWarning}</small>
                      ) : null}
                    </td>
                    <td>{view.studentCount}</td>
                    <td>
                      {view.group.defaultAdvisorId
                        ? lecturerById.get(view.group.defaultAdvisorId)?.displayName ?? "—"
                        : "—"}
                    </td>
                    <td>
                      <select
                        value={view.group.graderId ?? ""}
                        onChange={(event) => {
                          const result = updateGroup(data, view.group.id, {
                            graderId: event.target.value || null,
                          });
                          if (result.error) onNotice("danger", result.error);
                          else setData(result.data);
                        }}
                      >
                        <option value="">— Chưa phân công —</option>
                        {context.lecturers.map((lecturer) => (
                          <option key={lecturer.id} value={lecturer.id}>
                            {lecturer.displayName}
                            {lecturer.active ? "" : " (tạm ẩn)"}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
