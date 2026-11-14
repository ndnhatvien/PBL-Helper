import { useMemo, useState } from "react";
import type { ExamBatch, GroupView } from "../types";
import type { AppData } from "../store/store";
import type { BatchContext } from "../domain/selectors";
import { getAvailableStudents, getGroupViews } from "../domain/selectors";
import type { BalanceMode } from "../domain/assignment";
import { suggestAssignment } from "../domain/assignment";
import { getGroupAdvisorIds } from "../domain/advisor";
import {
  addGroupMember,
  applyAssignments,
  autoCreateGroupsFromSource,
  createGroup,
  deleteGroup,
  removeGroupMember,
  updateGroup,
  updateLecturer,
  updateMemberOverride,
} from "../store/actions";
import {
  Badge,
  EditableRoomCell,
  EmptyState,
  Notice,
  PageHeader,
} from "./shared";
import { LecturersPanel } from "./LecturersPanel";

interface GroupsPageProps {
  data: AppData;
  setData: React.Dispatch<React.SetStateAction<AppData>>;
  context: BatchContext;
  batch: ExamBatch | null;
  onNavigate: (page: string) => void;
  onNotice: (tone: "info" | "success" | "warning" | "danger", text: string) => void;
  notice: { tone: "info" | "success" | "warning" | "danger"; text: string } | null;
  onCloseNotice: () => void;
}

function advisorSourceLabel(source: "student_override" | "group_default" | "unassigned") {
  if (source === "student_override") return <Badge tone="purple">GVHD riêng</Badge>;
  if (source === "group_default") return <Badge tone="info">Mặc định nhóm</Badge>;
  return <Badge tone="danger">Chưa gán</Badge>;
}

export function GroupsPage({
  data,
  setData,
  context,
  batch,
  onNavigate,
  onNotice,
  notice,
  onCloseNotice,
}: GroupsPageProps) {
  const [groupCode, setGroupCode] = useState("");
  const [advisorId, setAdvisorId] = useState("");
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [mode, setMode] = useState<BalanceMode>("students");

  const availableStudents = useMemo(() => getAvailableStudents(context), [context]);
  const availableWithGroup = useMemo(
    () => availableStudents.filter((s) => s.groupCodeFromSource?.trim()),
    [availableStudents],
  );
  const groupViews = useMemo(() => getGroupViews(context), [context]);
  const activeLecturers = context.lecturers.filter((lecturer) => lecturer.active);
  const lecturerById = useMemo(
    () => new Map(context.lecturers.map((lecturer) => [lecturer.id, lecturer])),
    [context.lecturers],
  );
  const workbookById = useMemo(
    () => new Map(context.sourceWorkbooks.map((workbook) => [workbook.id, workbook])),
    [context.sourceWorkbooks],
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
        <PageHeader
          title="Quản lý nhóm PBL & Phân công chấm"
          description="Chọn đợt thi trước."
        />
        <EmptyState title="Chưa có đợt thi" />
      </div>
    );
  }

  function toggleStudent(studentId: string) {
    setSelectedStudentIds((previous) =>
      previous.includes(studentId)
        ? previous.filter((id) => id !== studentId)
        : [...previous, studentId],
    );
  }

  function handleCreateGroup(event: React.FormEvent) {
    event.preventDefault();
    const result = createGroup(
      data,
      batch!.id,
      groupCode,
      selectedStudentIds,
      advisorId || null,
    );
    if (result.error) {
      onNotice("danger", result.error);
      return;
    }
    setData(result.data);
    setGroupCode("");
    setAdvisorId("");
    setSelectedStudentIds([]);
    onNotice("success", "Đã tạo nhóm PBL.");
  }

  function commitGroupUpdate(result: { data: AppData; error?: string }) {
    if (result.error) {
      onNotice("danger", result.error);
      return;
    }
    setData(result.data);
  }

  function handleSuggest() {
    if (groupViews.length === 0) {
      onNotice("danger", "Chưa có nhóm PBL để phân công.");
      return;
    }
    if (activeLecturers.length === 0) {
      onNotice(
        "danger",
        "Chưa có giảng viên đang hoạt động. Hãy thêm giảng viên trước.",
      );
      return;
    }
    const result = suggestAssignment(
      groupViews.map((view) => ({
        id: view.group.id,
        groupCode: view.group.groupCode,
        studentCount: view.studentCount,
        excludedLecturerIds: getGroupAdvisorIds(
          view.group,
          context.members,
          context.students,
          context.lecturers,
          data.sourceWorkbooks,
        ),
      })),
      activeLecturers.map((lecturer) => lecturer.id),
      mode,
    );
    setData(applyAssignments(data, result.assignments));
    onNotice(
      "success",
      `Đã gợi ý phân công theo ${mode === "students" ? "số sinh viên" : "số nhóm"} (đã loại trừ toàn bộ GVHD của từng nhóm). Bạn có thể điều chỉnh thủ công từng nhóm bên dưới.`,
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="Quản lý nhóm PBL & Phân công chấm"
        description="Tạo nhóm PBL, gán GVHD (quy chế: GVHD không chấm sinh viên mình hướng dẫn) và phân công cân bằng giảng viên chấm."
        actions={
          <button
            type="button"
            className="button secondary"
            onClick={() => onNavigate("grader-export")}
          >
            Sang xuất file chấm
          </button>
        }
      />

      {notice ? (
        <Notice tone={notice.tone} onClose={onCloseNotice}>
          {notice.text}
        </Notice>
      ) : null}

      <LecturersPanel
        data={data}
        batch={batch}
        onDataChange={setData}
        onNotice={onNotice}
      />

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Phân công giảng viên chấm &amp; Cân bằng khối lượng</h2>
            <p className="muted">
              Cân bằng khối lượng theo số sinh viên (mặc định) hoặc theo số nhóm. Hệ thống tuyệt đối không phân công GVHD chấm nhóm mình hướng dẫn.
            </p>
          </div>
          <Badge tone="info">
            {groupViews.length} nhóm · {activeLecturers.length} GV hoạt động
          </Badge>
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
            ⚡ Gợi ý phân công tự động
          </button>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Giảng viên chấm</th>
                <th>Email</th>
                <th>Phòng chấm</th>
                <th>Số nhóm phụ trách</th>
                <th>Số sinh viên phụ trách</th>
              </tr>
            </thead>
            <tbody>
              {workload.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    style={{
                      textAlign: "center",
                      padding: "16px",
                      color: "var(--muted)",
                    }}
                  >
                    Chưa có giảng viên đang hoạt động.
                  </td>
                </tr>
              ) : (
                workload.map((row) => (
                  <tr key={row.lecturer.id}>
                    <td>
                      <strong>{row.lecturer.displayName}</strong>
                    </td>
                    <td>{row.lecturer.email || "—"}</td>
                    <td>
                      <EditableRoomCell
                        value={row.lecturer.room ?? ""}
                        onSave={(next) => {
                          setData(
                            updateLecturer(data, row.lecturer.id, {
                              room: next,
                            }),
                          );
                          onNotice(
                            "success",
                            `Đã cập nhật phòng chấm cho ${row.lecturer.displayName}: ${next || "(trống)"}`,
                          );
                        }}
                      />
                    </td>
                    <td>
                      <Badge tone={row.groupCount > 0 ? "info" : "neutral"}>
                        {row.groupCount} nhóm
                      </Badge>
                    </td>
                    <td>
                      <Badge tone={row.studentCount > 0 ? "purple" : "neutral"}>
                        {row.studentCount} SV
                      </Badge>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Tạo nhóm mới</h2>
            <p className="muted">
              Nhóm khuyến nghị 2–3 sinh viên. Nhóm ngoài khoảng này vẫn được lưu nhưng sẽ có cảnh báo.
            </p>
          </div>
          <Badge tone="info">{availableStudents.length} sinh viên chưa vào nhóm</Badge>
        </div>

        {availableStudents.length === 0 ? (
          <EmptyState title="Không còn sinh viên chưa vào nhóm">
            Nhập thêm Excel hoặc gỡ sinh viên khỏi nhóm hiện tại nếu cần.
          </EmptyState>
        ) : (
          <div>
            {availableWithGroup.length > 0 ? (
              <div className="source-group-banner">
                <div>
                  <strong>
                    Phát hiện {availableWithGroup.length} sinh viên đã có mã nhóm từ file nguồn Excel
                  </strong>
                  <p>
                    Bạn có thể tự động tạo nhóm theo đúng mã nhóm nguồn để gom nhóm chính xác, tránh phân công chấm nhầm.
                  </p>
                </div>
                <button
                  type="button"
                  className="button small"
                  onClick={() => {
                    const result = autoCreateGroupsFromSource(data, batch.id);
                    if (result.error) {
                      onNotice("danger", result.error);
                    } else {
                      setData(result.data);
                      onNotice("success", result.message);
                    }
                  }}
                >
                  ⚡ Tự động tạo nhóm ({availableWithGroup.length} SV)
                </button>
              </div>
            ) : null}

            <form onSubmit={handleCreateGroup}>
            <div className="form-grid">
              <label className="field">
                <span>Mã nhóm *</span>
                <input
                  value={groupCode}
                  onChange={(event) => setGroupCode(event.target.value)}
                  placeholder="VD: PBL01"
                />
              </label>
              <label className="field">
                <span>GVHD mặc định của nhóm</span>
                <select value={advisorId} onChange={(event) => setAdvisorId(event.target.value)}>
                  <option value="">— Chưa gán —</option>
                  {activeLecturers.map((lecturer) => (
                    <option key={lecturer.id} value={lecturer.id}>
                      {lecturer.displayName}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="student-picker">
              {availableStudents.map((student) => (
                <label
                  className={`student-chip ${selectedStudentIds.includes(student.id) ? "selected" : ""}`}
                  key={student.id}
                >
                  <input
                    type="checkbox"
                    checked={selectedStudentIds.includes(student.id)}
                    onChange={() => toggleStudent(student.id)}
                  />
                  <span>
                    <strong>{student.mssv}</strong> {student.name}
                    <small>
                      {student.className || "—"} ·{" "}
                      {workbookById.get(student.sourceWorkbookId)?.fileName ?? "—"}
                    </small>
                  </span>
                </label>
              ))}
            </div>

            <div className="sticky-actions">
              <button type="submit" className="button" disabled={selectedStudentIds.length === 0}>
                Tạo nhóm với {selectedStudentIds.length} sinh viên
              </button>
            </div>
          </form>
        </div>
      )}
      </section>

      <section className="panel">
        <h2>Danh sách nhóm ({groupViews.length})</h2>
        {groupViews.length === 0 ? (
          <EmptyState title="Chưa có nhóm PBL">Tạo nhóm ở phía trên.</EmptyState>
        ) : (
          <div className="group-list">
            {groupViews.map((view) => (
              <GroupCard
                key={view.group.id}
                view={view}
                context={context}
                data={data}
                availableStudents={availableStudents}
                lecturerById={lecturerById}
                workbookById={workbookById}
                onUpdate={commitGroupUpdate}
                onDataChange={setData}
                onNotice={onNotice}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function GroupCard({
  view,
  context,
  data,
  availableStudents,
  lecturerById,
  workbookById,
  onUpdate,
  onDataChange,
  onNotice,
}: {
  view: GroupView;
  context: BatchContext;
  data: AppData;
  availableStudents: BatchContext["students"];
  lecturerById: Map<string, import("../types").Lecturer>;
  workbookById: Map<string, import("../types").SourceWorkbook>;
  onUpdate: (result: { data: AppData; error?: string }) => void;
  onDataChange: (next: AppData) => void;
  onNotice: (tone: "info" | "success" | "warning" | "danger", text: string) => void;
}) {
  const activeLecturers = context.lecturers.filter((lecturer) => lecturer.active);
  const grader = view.group.graderId ? lecturerById.get(view.group.graderId) : null;
  const groupAdvisorIds = useMemo(
    () =>
      getGroupAdvisorIds(
        view.group,
        context.members,
        context.students,
        context.lecturers,
        data.sourceWorkbooks,
      ),
    [
      view.group,
      context.members,
      context.students,
      context.lecturers,
      data.sourceWorkbooks,
    ],
  );

  const isConflict = Boolean(
    view.group.graderId && groupAdvisorIds.includes(view.group.graderId),
  );

  return (
    <article className="group-card">
      <div className="group-header">
        <div>
          <h3>Nhóm {view.group.groupCode}</h3>
          <p>
            {view.studentCount} sinh viên ·{" "}
            {grader ? (
              <Badge tone={isConflict ? "danger" : "purple"}>
                {isConflict ? "⛔ Xung đột: " : ""}GV chấm: {grader.displayName}
              </Badge>
            ) : (
              <Badge tone="warning">Chưa phân công chấm</Badge>
            )}
            {view.group.defaultAdvisorId ? (
              <small className="muted" style={{ marginLeft: "8px" }}>
                · GVHD nhóm:{" "}
                <strong>
                  {lecturerById.get(view.group.defaultAdvisorId)?.displayName}
                </strong>
              </small>
            ) : null}
          </p>
        </div>
        <div className="group-header-actions">
          <label className="inline-select">
            <span>GVHD mặc định</span>
            <select
              value={view.group.defaultAdvisorId ?? ""}
              onChange={(event) =>
                onUpdate(
                  updateGroup(data, view.group.id, {
                    defaultAdvisorId: event.target.value || null,
                  }),
                )
              }
            >
              <option value="">— Chưa gán —</option>
              {activeLecturers.map((lecturer) => {
                const isGrader = view.group.graderId === lecturer.id;
                return (
                  <option
                    key={lecturer.id}
                    value={lecturer.id}
                    disabled={isGrader}
                  >
                    {lecturer.displayName}
                    {isGrader ? " (Đang là GV chấm)" : ""}
                  </option>
                );
              })}
            </select>
          </label>
          <label className="inline-select">
            <span>Giảng viên chấm</span>
            <select
              value={view.group.graderId ?? ""}
              onChange={(event) =>
                onUpdate(
                  updateGroup(data, view.group.id, {
                    graderId: event.target.value || null,
                  }),
                )
              }
            >
              <option value="">— Chưa phân công —</option>
              {activeLecturers.map((lecturer) => {
                const isAdvisor = groupAdvisorIds.includes(lecturer.id);
                return (
                  <option
                    key={lecturer.id}
                    value={lecturer.id}
                    disabled={isAdvisor}
                  >
                    {lecturer.displayName}
                    {isAdvisor ? " (⛔ GVHD - Không được chấm)" : ""}
                  </option>
                );
              })}
            </select>
          </label>
          <button
            type="button"
            className="button small ghost"
            onClick={() => {
              if (window.confirm(`Xóa nhóm ${view.group.groupCode}? Các sinh viên sẽ trở về trạng thái chưa vào nhóm.`)) {
                onDataChange(deleteGroup(data, view.group.id));
              }
            }}
          >
            Xóa nhóm
          </button>
        </div>
      </div>

      {isConflict ? (
        <Notice tone="danger">
          ⛔ <strong>Xung đột quyền lợi:</strong> Giảng viên chấm ({grader?.displayName}) là GVHD của sinh viên trong nhóm này! Theo quy chế, GVHD không được chấm sinh viên mình hướng dẫn. Vui lòng chọn giảng viên chấm khác.
        </Notice>
      ) : null}

      {view.sizeWarning ? <Notice tone="warning">{view.sizeWarning}</Notice> : null}
      {view.missingAdvisorCount > 0 ? (
        <Notice tone="warning">
          {view.missingAdvisorCount} sinh viên chưa có GVHD hiệu lực. Hãy gán GVHD mặc định hoặc ngoại lệ.
        </Notice>
      ) : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>MSSV</th>
              <th>Họ tên</th>
              <th>Lớp / học phần</th>
              <th>File nguồn</th>
              <th>GVHD ngoại lệ</th>
              <th>GVHD hiệu lực</th>
              <th>Điểm</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {view.members.map((memberView) => (
              <tr key={memberView.member.id}>
                <td>{memberView.student.mssv}</td>
                <td>{memberView.student.name}</td>
                <td>
                  {memberView.student.className || "—"}
                  <small className="cell-sub">
                    {memberView.student.courseCode || "—"}{" "}
                    {memberView.student.courseName ? `· ${memberView.student.courseName}` : ""}
                  </small>
                </td>
                <td>
                  {workbookById.get(memberView.student.sourceWorkbookId)?.fileName ?? "—"}
                  <small className="cell-sub">dòng {memberView.student.sourceRowNumber}</small>
                </td>
                <td>
                  <select
                    value={memberView.member.advisorOverrideId ?? ""}
                    onChange={(event) =>
                      onUpdate(
                        updateMemberOverride(
                          data,
                          memberView.member.id,
                          event.target.value || null,
                        ),
                      )
                    }
                  >
                    <option value="">Theo GVHD nhóm</option>
                    {activeLecturers.map((lecturer) => (
                      <option key={lecturer.id} value={lecturer.id}>
                        {lecturer.displayName}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  {memberView.advisorName}
                  <small className="cell-sub">{advisorSourceLabel(memberView.advisorSource)}</small>
                </td>
                <td>{memberView.score ?? "—"}</td>
                <td>
                  <button
                    type="button"
                    className="button small ghost"
                    onClick={() => {
                      if (window.confirm(`Gỡ ${memberView.student.mssv} khỏi nhóm?`)) {
                        onDataChange(removeGroupMember(data, memberView.member.id));
                      }
                    }}
                  >
                    Gỡ
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {availableStudents.length > 0 ? (
        <div className="add-member">
          <select
            value=""
            onChange={(event) => {
              if (!event.target.value) return;
              onUpdate(addGroupMember(data, view.group.id, event.target.value));
              onNotice("success", "Đã thêm sinh viên vào nhóm.");
            }}
          >
            <option value="">+ Thêm sinh viên chưa vào nhóm...</option>
            {availableStudents.map((student) => (
              <option key={student.id} value={student.id}>
                {student.mssv} – {student.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </article>
  );
}
