import { useMemo, useState } from "react";
import type { ExamBatch, GroupView, Lecturer, SourceWorkbook } from "../types";
import type { AppData } from "../store/store";
import type { BatchContext } from "../domain/selectors";
import { filterBatchContext, getAvailableStudents, getGroupViews } from "../domain/selectors";
import type { BalanceMode } from "../domain/assignment";
import { suggestAssignment } from "../domain/assignment";
import { getGroupAdvisorIds } from "../domain/advisor";
import {
  addGroupMember,
  applyAssignments,
  autoCreateGroupsFromSource,
  createGroup,
  deleteGroup,
  formatCompoundGroupCode,
  getWorkbookLabel,
  removeGroupMember,
  resetAndRecreateGroupsFromSource,
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
import { isBarredGroupCode } from "../utils/text";

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
  const [mode, setMode] = useState<BalanceMode>("groups");
  const [filterWorkbookId, setFilterWorkbookId] = useState<string>("all");
  const [selectedLecturerTab, setSelectedLecturerTab] = useState<string>("all");
  const [viewLayout, setViewLayout] = useState<"lecturers" | "flat">("lecturers");
  const [searchQuery, setSearchQuery] = useState("");

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

  const displayedGroupViews = useMemo(() => {
    let list = groupViews;
    if (filterWorkbookId !== "all") {
      list = list.filter((view) => {
        const wbId =
          view.group.sourceWorkbookId ||
          view.members[0]?.student.sourceWorkbookId ||
          context.students.find((s) =>
            context.members.some(
              (m) => m.groupId === view.group.id && m.studentId === s.id,
            ),
          )?.sourceWorkbookId;
        return wbId === filterWorkbookId;
      });
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter((view) => {
        if (view.group.groupCode.toLowerCase().includes(q)) return true;
        return view.members.some(
          (m) =>
            m.student.name.toLowerCase().includes(q) ||
            m.student.mssv.toLowerCase().includes(q),
        );
      });
    }
    return list;
  }, [groupViews, filterWorkbookId, searchQuery, context.students, context.members]);

  // Gom nhóm danh sách theo từng giảng viên chấm để hiển thị các panel riêng có thanh cuộn
  const lecturerSections = useMemo(() => {
    const sections = activeLecturers.map((lecturer) => {
      const groups = displayedGroupViews.filter(
        (view) => view.group.graderId === lecturer.id,
      );
      const wbMap = new Map<string, { label: string; count: number }>();
      for (const view of groups) {
        const wbId =
          view.group.sourceWorkbookId ||
          view.members[0]?.student.sourceWorkbookId ||
          context.students.find((s) =>
            context.members.some(
              (m) => m.groupId === view.group.id && m.studentId === s.id,
            ),
          )?.sourceWorkbookId;
        const wb = wbId ? workbookById.get(wbId) : null;
        const label = wb
          ? wb.groupPrefix
            ? `${wb.groupPrefix} (${getWorkbookLabel(wb)})`
            : getWorkbookLabel(wb)
          : "Khác";
        const key = wbId || "unknown";
        const existing = wbMap.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          wbMap.set(key, { label, count: 1 });
        }
      }
      return {
        lecturer,
        groups,
        studentCount: groups.reduce((sum, v) => sum + v.studentCount, 0),
        workbooks: Array.from(wbMap.values()),
      };
    });

    const barredGroups = displayedGroupViews.filter((view) =>
      isBarredGroupCode(view.group.groupCode),
    );

    const unassignedGroups = displayedGroupViews.filter(
      (view) => !view.group.graderId && !isBarredGroupCode(view.group.groupCode),
    );

    return {
      lecturerSections: sections,
      unassignedGroups,
      barredGroups,
    };
  }, [activeLecturers, displayedGroupViews, context.students, context.members, workbookById]);

  const workload = useMemo(
    () =>
      activeLecturers
        .map((lecturer) => {
          const groups = groupViews.filter(
            (view) => view.group.graderId === lecturer.id,
          );
          // Gom cụm theo bảng điểm
          const wbMap = new Map<string, { label: string; count: number }>();
          for (const view of groups) {
            const wbId =
              view.group.sourceWorkbookId ||
              view.members[0]?.student.sourceWorkbookId ||
              context.students.find((s) =>
                context.members.some(
                  (m) => m.groupId === view.group.id && m.studentId === s.id,
                ),
              )?.sourceWorkbookId;
            const wb = wbId ? workbookById.get(wbId) : null;
            const label = wb
              ? wb.groupPrefix
                ? `${wb.groupPrefix} (${getWorkbookLabel(wb)})`
                : getWorkbookLabel(wb)
              : "Khác";
            const key = wbId || "unknown";
            const existing = wbMap.get(key);
            if (existing) {
              existing.count += 1;
            } else {
              wbMap.set(key, { label, count: 1 });
            }
          }

          return {
            lecturer,
            groupCount: groups.length,
            studentCount: groups.reduce(
              (total, view) => total + view.studentCount,
              0,
            ),
            workbooks: Array.from(wbMap.values()),
          };
        })
        .sort((a, b) => b.studentCount - a.studentCount),
    [activeLecturers, groupViews, context.students, context.members, workbookById],
  );

  const hasNoEligibleGrader = useMemo(() => {
    if (groupViews.length === 0 || activeLecturers.length === 0) return false;
    return groupViews.every((view) => {
      const advIds = new Set(
        getGroupAdvisorIds(
          view.group,
          context.members,
          context.students,
          context.lecturers,
          data.sourceWorkbooks,
        ),
      );
      return activeLecturers.every((l) => advIds.has(l.id));
    });
  }, [groupViews, activeLecturers, context, data.sourceWorkbooks]);

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
    const firstStu = availableStudents.find((s) => selectedStudentIds.includes(s.id));
    const wb = firstStu?.sourceWorkbookId ? workbookById.get(firstStu.sourceWorkbookId) : undefined;
    const finalCode = formatCompoundGroupCode(wb, groupCode);

    const result = createGroup(
      data,
      batch!.id,
      finalCode,
      selectedStudentIds,
      advisorId || null,
      firstStu?.sourceWorkbookId,
    );
    if (result.error) {
      onNotice("danger", result.error);
      return;
    }
    setData(result.data);
    setGroupCode("");
    setAdvisorId("");
    setSelectedStudentIds([]);
    onNotice("success", `Đã tạo nhóm "${finalCode}".`);
  }

  function commitGroupUpdate(result: { data: AppData; error?: string }) {
    if (result.error) {
      onNotice("danger", result.error);
      return;
    }
    setData(result.data);
  }

  function handleSuggest() {
    let currentData = data;
    let currentGroupViews = groupViews;
    let createdCount = 0;

    // 1. Nếu chưa có nhóm PBL nào:
    if (currentGroupViews.length === 0) {
      if (availableWithGroup.length > 0 && batch) {
        // Tự động tạo nhóm từ mã nhóm nguồn Excel trước
        const autoRes = autoCreateGroupsFromSource(currentData, batch.id);
        if (autoRes.error) {
          onNotice("danger", autoRes.error);
          window.scrollTo({ top: 0, behavior: "smooth" });
          return;
        }
        currentData = autoRes.data;
        setData(currentData);
        const newContext = filterBatchContext(currentData, batch.id);
        currentGroupViews = getGroupViews(newContext);
        createdCount = currentGroupViews.length;
      } else {
        onNotice(
          "danger",
          "Chưa có nhóm PBL nào trong đợt để phân công. Hãy tạo nhóm ở phần bên dưới trước.",
        );
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
    }

    if (activeLecturers.length === 0) {
      onNotice(
        "danger",
        "Chưa có giảng viên đang hoạt động trong đợt. Hãy thêm giảng viên ở bảng 'Giảng viên của đợt' phía trên.",
      );
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    // 2. Chạy thuật toán gợi ý phân công:
    const activeIds = activeLecturers.map((lecturer) => lecturer.id);
    const result = suggestAssignment(
      currentGroupViews.map((view) => ({
        id: view.group.id,
        groupCode: view.group.groupCode,
        studentCount: view.studentCount,
        excludedLecturerIds: getGroupAdvisorIds(
          view.group,
          currentData.members,
          currentData.students,
          currentData.lecturers,
          currentData.sourceWorkbooks,
        ),
        sourceWorkbookId:
          view.group.sourceWorkbookId ||
          view.members[0]?.student.sourceWorkbookId ||
          currentData.students.find((s) =>
            currentData.members.some(
              (m) => m.groupId === view.group.id && m.studentId === s.id,
            ),
          )?.sourceWorkbookId,
      })),
      activeIds,
      mode,
    );

    const assignedCount = Object.keys(result.assignments).length;
    const unassignedCount = result.unassignedGroupIds?.length ?? 0;

    if (assignedCount === 0 && unassignedCount > 0) {
      onNotice(
        "danger",
        `Không thể phân công: Toàn bộ ${activeLecturers.length} giảng viên hiện có đều là GVHD của các nhóm (quy chế cấm GVHD tự chấm sinh viên mình hướng dẫn). Hãy thêm ít nhất 1 giảng viên chấm độc lập ở bảng 'Giảng viên của đợt' phía trên để phân công chéo.`,
      );
      window.scrollTo({ top: 0, behavior: "smooth" });
      if (currentData !== data) {
        setData(currentData);
      }
      return;
    }

    const nextData = applyAssignments(currentData, result.assignments);
    setData(nextData);
    window.scrollTo({ top: 0, behavior: "smooth" });

    if (unassignedCount > 0) {
      onNotice(
        "warning",
        `${createdCount > 0 ? `Đã tạo ${createdCount} nhóm từ file nguồn. ` : ""}Đã phân công ${assignedCount} nhóm. Còn ${unassignedCount} nhóm chưa thể phân công vì thiếu giảng viên chấm độc lập (các giảng viên còn lại đều là GVHD của nhóm đó). Hãy thêm giảng viên chấm vào đợt.`,
      );
    } else {
      onNotice(
        "success",
        `${createdCount > 0 ? `Đã tự động tạo ${createdCount} nhóm từ file nguồn và ` : ""}Đã gợi ý phân công thành công ${assignedCount} nhóm theo ${mode === "students" ? "số sinh viên" : "số nhóm"} (tuyệt đối không phân công GVHD tự chấm).`,
      );
    }
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

        {hasNoEligibleGrader ? (
          <div
            style={{
              background: "var(--red-soft)",
              padding: "12px 16px",
              borderRadius: "8px",
              marginBottom: "16px",
              border: "1px solid rgba(180, 35, 24, 0.2)",
              fontSize: "0.88rem",
              color: "var(--red)",
            }}
          >
            ⛔ <strong>Thiếu giảng viên chấm độc lập:</strong> Toàn bộ {activeLecturers.length} giảng viên hiện có đều là GVHD của các nhóm trong đợt (quy chế cấm GVHD tự chấm sinh viên mình hướng dẫn). Vui lòng thêm ít nhất 1 giảng viên chấm độc lập ở bảng <em>Giảng viên của đợt</em> phía trên để hệ thống có thể phân công chấm.
          </div>
        ) : groupViews.length === 0 ? (
          <div
            style={{
              background: "var(--amber-soft)",
              padding: "12px 16px",
              borderRadius: "8px",
              marginBottom: "16px",
              border: "1px solid rgba(180, 83, 9, 0.2)",
              fontSize: "0.88rem",
              color: "var(--amber)",
            }}
          >
            💡 <strong>Chưa có nhóm PBL nào:</strong>{" "}
            {availableWithGroup.length > 0
              ? `Phát hiện ${availableWithGroup.length} sinh viên đã có mã nhóm từ file Excel. Bấm nút "⚡ Gợi ý phân công tự động" bên dưới sẽ tự động gom nhóm từ file nguồn và phân công chấm ngay.`
              : "Hãy tạo nhóm ở phần bên dưới trước khi phân công giảng viên chấm."}
          </div>
        ) : null}

        <div className="radio-row">
          <label className="checkbox-line">
            <input
              type="radio"
              name="balance-mode"
              checked={mode === "groups"}
              onChange={() => setMode("groups")}
            />
            <span>Cân bằng theo số nhóm (khuyên dùng, chia đều số nhóm cho mỗi GV)</span>
          </label>
          <label className="checkbox-line">
            <input
              type="radio"
              name="balance-mode"
              checked={mode === "students"}
              onChange={() => setMode("students")}
            />
            <span>Cân bằng theo số sinh viên</span>
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
                <th>Bảng điểm phụ trách</th>
              </tr>
            </thead>
            <tbody>
              {workload.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
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
                    <td>
                      {row.workbooks.length === 0 ? (
                        <span className="muted">—</span>
                      ) : (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                          {row.workbooks.map((wb, idx) => (
                            <Badge
                              key={idx}
                              tone={row.workbooks.length === 1 ? "success" : "info"}
                            >
                              {wb.label} ({wb.count} nhóm)
                            </Badge>
                          ))}
                        </div>
                      )}
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
        <div className="panel-header">
          <div>
            <h2>Danh sách nhóm ({groupViews.length})</h2>
            <p className="muted">
              Quản lý thành viên từng nhóm và phân công giảng viên chấm cụ thể.
            </p>
          </div>
          {context.sourceWorkbooks.length > 0 ? (
            <button
              type="button"
              className="button small secondary"
              title="Xóa danh sách nhóm hiện tại và gom nhóm tự động chuẩn theo từng file/bảng điểm nguồn"
              onClick={() => {
                const ok = window.confirm(
                  `Bạn có chắc chắn muốn làm mới và tạo lại toàn bộ nhóm từ file nguồn Excel?\n\nThao tác này sẽ phân nhóm lại chính xác theo từng bảng điểm (giúp khắc phục lỗi bị gộp nhầm nhóm giữa các bảng điểm khác nhau).`,
                );
                if (!ok) return;
                const res = resetAndRecreateGroupsFromSource(data, batch.id);
                if (res.error) {
                  onNotice("danger", res.error);
                } else {
                  setData(res.data);
                  onNotice("success", res.message ?? "Đã làm mới và tạo lại nhóm thành công.");
                }
              }}
            >
              🔄 Làm mới &amp; tạo lại nhóm từ file nguồn
            </button>
          ) : null}
        </div>
        {/* Toolbar: Tìm kiếm, Lọc bảng điểm & Chuyển đổi hiển thị */}
        {groupViews.length > 0 ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              flexWrap: "wrap",
              margin: "8px 0 16px 0",
              padding: "10px 14px",
              background: "var(--surface-sunken)",
              borderRadius: "8px",
              border: "1px solid var(--border-soft)",
            }}
          >
            {/* Ô tìm kiếm nhanh */}
            <div style={{ display: "flex", alignItems: "center", gap: "6px", flex: 1, minWidth: "220px" }}>
              <span style={{ fontSize: "0.88rem", fontWeight: 600 }}>🔍 Tìm:</span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Mã nhóm, tên hoặc MSSV..."
                style={{
                  padding: "6px 10px",
                  borderRadius: "6px",
                  border: "1px solid var(--border)",
                  fontSize: "0.88rem",
                  width: "100%",
                  background: "var(--surface)",
                }}
              />
              {searchQuery ? (
                <button
                  type="button"
                  className="button small ghost"
                  onClick={() => setSearchQuery("")}
                  title="Xóa tìm kiếm"
                >
                  ✕
                </button>
              ) : null}
            </div>

            {/* Lọc theo bảng điểm */}
            {context.sourceWorkbooks.length > 1 ? (
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ fontSize: "0.88rem", fontWeight: 600 }}>📋 Bảng điểm:</span>
                <select
                  value={filterWorkbookId}
                  onChange={(e) => setFilterWorkbookId(e.target.value)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: "6px",
                    border: "1px solid var(--border)",
                    fontSize: "0.88rem",
                    background: "var(--surface)",
                  }}
                >
                  <option value="all">
                    Tất cả bảng điểm ({groupViews.length} nhóm)
                  </option>
                  {context.sourceWorkbooks.map((w) => {
                    const count = groupViews.filter((v) => {
                      const wid =
                        v.group.sourceWorkbookId ||
                        v.members[0]?.student.sourceWorkbookId;
                      return wid === w.id;
                    }).length;
                    return (
                      <option key={w.id} value={w.id}>
                        {w.groupPrefix ? `${w.groupPrefix} (${getWorkbookLabel(w)})` : getWorkbookLabel(w)} ({count} nhóm)
                      </option>
                    );
                  })}
                </select>
                {filterWorkbookId !== "all" ? (
                  <button
                    type="button"
                    className="button small ghost"
                    onClick={() => setFilterWorkbookId("all")}
                    title="Xem tất cả bảng điểm"
                  >
                    ✕
                  </button>
                ) : null}
              </div>
            ) : null}

            {/* Chế độ xem: Theo từng giảng viên vs Danh sách phẳng */}
            <div style={{ display: "flex", gap: "6px", marginLeft: "auto" }}>
              <button
                type="button"
                className={`button small ${viewLayout === "lecturers" ? "" : "ghost"}`}
                style={{
                  background: viewLayout === "lecturers" ? "var(--teal)" : "transparent",
                  color: viewLayout === "lecturers" ? "#ffffff" : "inherit",
                }}
                title="Chia theo từng giảng viên, mỗi thầy/cô 1 panel cuộn riêng"
                onClick={() => setViewLayout("lecturers")}
              >
                🗂️ Panel theo GV
              </button>
              <button
                type="button"
                className={`button small ${viewLayout === "flat" ? "" : "ghost"}`}
                style={{
                  background: viewLayout === "flat" ? "var(--teal)" : "transparent",
                  color: viewLayout === "flat" ? "#ffffff" : "inherit",
                }}
                title="Danh sách phẳng truyền thống"
                onClick={() => setViewLayout("flat")}
              >
                📋 Danh sách phẳng
              </button>
            </div>
          </div>
        ) : null}

        {/* Thanh tab chọn nhanh giảng viên khi ở chế độ xem Panel */}
        {viewLayout === "lecturers" && groupViews.length > 0 && activeLecturers.length > 0 ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              flexWrap: "wrap",
              marginBottom: "16px",
              paddingBottom: "8px",
              borderBottom: "1px dashed var(--border-soft)",
            }}
          >
            <span style={{ fontSize: "0.85rem", color: "var(--muted)", marginRight: "4px" }}>
              Xem nhanh:
            </span>
            <button
              type="button"
              className={`button small ${selectedLecturerTab === "all" ? "" : "ghost"}`}
              style={{
                borderRadius: "16px",
                padding: "3px 10px",
                fontSize: "0.82rem",
                background: selectedLecturerTab === "all" ? "var(--navy)" : "var(--surface-sunken)",
                color: selectedLecturerTab === "all" ? "#fff" : "inherit",
              }}
              onClick={() => setSelectedLecturerTab("all")}
            >
              Tất cả GV ({activeLecturers.length})
            </button>
            {lecturerSections.lecturerSections.map(({ lecturer, groups }) => (
              <button
                key={lecturer.id}
                type="button"
                className={`button small ${selectedLecturerTab === lecturer.id ? "" : "ghost"}`}
                style={{
                  borderRadius: "16px",
                  padding: "3px 10px",
                  fontSize: "0.82rem",
                  background: selectedLecturerTab === lecturer.id ? "var(--teal)" : "var(--surface-sunken)",
                  color: selectedLecturerTab === lecturer.id ? "#fff" : "inherit",
                }}
                onClick={() => setSelectedLecturerTab(lecturer.id)}
              >
                {lecturer.displayName} ({groups.length})
              </button>
            ))}
            {lecturerSections.unassignedGroups.length > 0 ? (
              <button
                type="button"
                className={`button small ${selectedLecturerTab === "unassigned" ? "" : "ghost"}`}
                style={{
                  borderRadius: "16px",
                  padding: "3px 10px",
                  fontSize: "0.82rem",
                  background: selectedLecturerTab === "unassigned" ? "var(--amber)" : "var(--amber-soft)",
                  color: selectedLecturerTab === "unassigned" ? "#fff" : "var(--amber)",
                  fontWeight: 600,
                }}
                onClick={() => setSelectedLecturerTab("unassigned")}
              >
                ⚠️ Chưa phân công ({lecturerSections.unassignedGroups.length})
              </button>
            ) : null}
            {lecturerSections.barredGroups.length > 0 ? (
              <button
                type="button"
                className={`button small ${selectedLecturerTab === "barred" ? "" : "ghost"}`}
                style={{
                  borderRadius: "16px",
                  padding: "3px 10px",
                  fontSize: "0.82rem",
                  background: selectedLecturerTab === "barred" ? "var(--red)" : "rgba(224, 49, 49, 0.1)",
                  color: selectedLecturerTab === "barred" ? "#fff" : "var(--red)",
                  fontWeight: 600,
                }}
                onClick={() => setSelectedLecturerTab("barred")}
              >
                ⛔ Cấm thi ({lecturerSections.barredGroups.length})
              </button>
            ) : null}
          </div>
        ) : null}

        {groupViews.length === 0 ? (
          <EmptyState title="Chưa có nhóm PBL">Tạo nhóm ở phía trên.</EmptyState>
        ) : displayedGroupViews.length === 0 ? (
          <EmptyState title="Không tìm thấy nhóm phù hợp">
            Hãy chọn bảng điểm khác hoặc xóa từ khóa tìm kiếm.
          </EmptyState>
        ) : viewLayout === "flat" ? (
          <div className="group-list">
            {displayedGroupViews.map((view) => (
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
        ) : selectedLecturerTab === "unassigned" ? (
          <UnassignedGroupPanel
            groups={lecturerSections.unassignedGroups}
            context={context}
            data={data}
            availableStudents={availableStudents}
            lecturerById={lecturerById}
            workbookById={workbookById}
            onUpdate={commitGroupUpdate}
            onDataChange={setData}
            onNotice={onNotice}
          />
        ) : selectedLecturerTab === "barred" ? (
          <BarredGroupPanel
            groups={lecturerSections.barredGroups}
            context={context}
            data={data}
            availableStudents={availableStudents}
            lecturerById={lecturerById}
            workbookById={workbookById}
            onUpdate={commitGroupUpdate}
            onDataChange={setData}
            onNotice={onNotice}
          />
        ) : selectedLecturerTab !== "all" ? (
          (() => {
            const sec = lecturerSections.lecturerSections.find(
              (s) => s.lecturer.id === selectedLecturerTab,
            );
            if (!sec) {
              return (
                <EmptyState title="Không tìm thấy giảng viên">
                  Hãy chọn giảng viên khác.
                </EmptyState>
              );
            }
            return (
              <LecturerGroupPanel
                key={sec.lecturer.id}
                lecturer={sec.lecturer}
                groups={sec.groups}
                studentCount={sec.studentCount}
                workbooks={sec.workbooks}
                context={context}
                data={data}
                availableStudents={availableStudents}
                lecturerById={lecturerById}
                workbookById={workbookById}
                onUpdate={commitGroupUpdate}
                onDataChange={setData}
                onNotice={onNotice}
              />
            );
          })()
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            {lecturerSections.unassignedGroups.length > 0 ? (
              <UnassignedGroupPanel
                groups={lecturerSections.unassignedGroups}
                context={context}
                data={data}
                availableStudents={availableStudents}
                lecturerById={lecturerById}
                workbookById={workbookById}
                onUpdate={commitGroupUpdate}
                onDataChange={setData}
                onNotice={onNotice}
              />
            ) : null}

            {lecturerSections.barredGroups.length > 0 ? (
              <BarredGroupPanel
                groups={lecturerSections.barredGroups}
                context={context}
                data={data}
                availableStudents={availableStudents}
                lecturerById={lecturerById}
                workbookById={workbookById}
                onUpdate={commitGroupUpdate}
                onDataChange={setData}
                onNotice={onNotice}
              />
            ) : null}

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))",
                gap: "18px",
                alignItems: "start",
              }}
            >
              {lecturerSections.lecturerSections.map((sec) => (
                <LecturerGroupPanel
                  key={sec.lecturer.id}
                  lecturer={sec.lecturer}
                  groups={sec.groups}
                  studentCount={sec.studentCount}
                  workbooks={sec.workbooks}
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
          </div>
        )}
      </section>
    </div>
  );
}

function LecturerGroupPanel({
  lecturer,
  groups,
  studentCount,
  workbooks,
  context,
  data,
  availableStudents,
  lecturerById,
  workbookById,
  onUpdate,
  onDataChange,
  onNotice,
}: {
  lecturer: Lecturer;
  groups: GroupView[];
  studentCount: number;
  workbooks: Array<{ label: string; count: number }>;
  context: BatchContext;
  data: AppData;
  availableStudents: BatchContext["students"];
  lecturerById: Map<string, Lecturer>;
  workbookById: Map<string, SourceWorkbook>;
  onUpdate: (result: { data: AppData; error?: string }) => void;
  onDataChange: (next: AppData) => void;
  onNotice: (tone: "info" | "success" | "warning" | "danger", text: string) => void;
}) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "12px",
        boxShadow: "0 2px 10px rgba(16, 42, 67, 0.04)",
        display: "flex",
        flexDirection: "column",
        height: "640px",
        overflow: "hidden",
      }}
    >
      {/* Header cố định */}
      <div
        style={{
          padding: "14px 16px",
          background: "var(--surface-sunken)",
          borderBottom: "1px solid var(--border-soft)",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "8px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <strong style={{ fontSize: "1.05rem", color: "var(--navy)" }}>
              👨‍🏫 {lecturer.displayName}
            </strong>
            {lecturer.room ? (
              <Badge tone="neutral">📍 {lecturer.room}</Badge>
            ) : null}
          </div>
          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
            <Badge tone="purple">{groups.length} nhóm</Badge>
            <Badge tone="info">{studentCount} SV</Badge>
          </div>
        </div>

        {/* Cụm bảng điểm */}
        <div
          style={{
            display: "flex",
            gap: "6px",
            flexWrap: "wrap",
            alignItems: "center",
            fontSize: "0.82rem",
          }}
        >
          <span className="muted" style={{ fontWeight: 500 }}>
            Bảng điểm chấm:
          </span>
          {workbooks.length > 0 ? (
            workbooks.map((wbInfo, wIdx) => (
              <Badge key={wIdx} tone="info">
                {wbInfo.label} ({wbInfo.count} nhóm)
              </Badge>
            ))
          ) : (
            <span className="muted">— Chưa có nhóm nào —</span>
          )}
          {workbooks.length > 2 ? (
            <Badge tone="warning">⚠️ &gt; 2 bảng điểm</Badge>
          ) : null}
        </div>
      </div>

      {/* Vùng danh sách nhóm có thanh cuộn riêng */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "14px",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          scrollbarWidth: "thin",
          scrollbarColor: "rgba(16, 42, 67, 0.25) transparent",
        }}
      >
        {groups.length === 0 ? (
          <EmptyState title="Chưa có nhóm nào">
            Giảng viên này chưa được phân công chấm nhóm nào.
          </EmptyState>
        ) : (
          groups.map((view) => (
            <GroupCard
              key={view.group.id}
              view={view}
              context={context}
              data={data}
              availableStudents={availableStudents}
              lecturerById={lecturerById}
              workbookById={workbookById}
              onUpdate={onUpdate}
              onDataChange={onDataChange}
              onNotice={onNotice}
            />
          ))
        )}
      </div>
    </div>
  );
}

function UnassignedGroupPanel({
  groups,
  context,
  data,
  availableStudents,
  lecturerById,
  workbookById,
  onUpdate,
  onDataChange,
  onNotice,
}: {
  groups: GroupView[];
  context: BatchContext;
  data: AppData;
  availableStudents: BatchContext["students"];
  lecturerById: Map<string, Lecturer>;
  workbookById: Map<string, SourceWorkbook>;
  onUpdate: (result: { data: AppData; error?: string }) => void;
  onDataChange: (next: AppData) => void;
  onNotice: (tone: "info" | "success" | "warning" | "danger", text: string) => void;
}) {
  const studentCount = groups.reduce((sum, v) => sum + v.studentCount, 0);
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--amber)",
        borderRadius: "12px",
        boxShadow: "0 2px 10px rgba(180, 83, 9, 0.08)",
        display: "flex",
        flexDirection: "column",
        height: "640px",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "14px 16px",
          background: "var(--amber-soft)",
          borderBottom: "1px solid rgba(180, 83, 9, 0.2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "8px",
        }}
      >
        <div>
          <strong style={{ fontSize: "1.05rem", color: "var(--amber)" }}>
            ⚠️ Nhóm chưa phân công chấm
          </strong>
          <small className="muted" style={{ display: "block" }}>
            Cần gán GV chấm hoặc bấm "Gợi ý phân công" ở trên
          </small>
        </div>
        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          <Badge tone="warning">{groups.length} nhóm</Badge>
          <Badge tone="neutral">{studentCount} SV</Badge>
        </div>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "14px",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          scrollbarWidth: "thin",
          scrollbarColor: "rgba(180, 83, 9, 0.3) transparent",
        }}
      >
        {groups.map((view) => (
          <GroupCard
            key={view.group.id}
            view={view}
            context={context}
            data={data}
            availableStudents={availableStudents}
            lecturerById={lecturerById}
            workbookById={workbookById}
            onUpdate={onUpdate}
            onDataChange={onDataChange}
            onNotice={onNotice}
          />
        ))}
      </div>
    </div>
  );
}

function BarredGroupPanel({
  groups,
  context,
  data,
  availableStudents,
  lecturerById,
  workbookById,
  onUpdate,
  onDataChange,
  onNotice,
}: {
  groups: GroupView[];
  context: BatchContext;
  data: AppData;
  availableStudents: BatchContext["students"];
  lecturerById: Map<string, Lecturer>;
  workbookById: Map<string, SourceWorkbook>;
  onUpdate: (result: { data: AppData; error?: string }) => void;
  onDataChange: (next: AppData) => void;
  onNotice: (tone: "info" | "success" | "warning" | "danger", text: string) => void;
}) {
  const studentCount = groups.reduce((sum, v) => sum + v.studentCount, 0);
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--red)",
        borderRadius: "12px",
        boxShadow: "0 2px 10px rgba(224, 49, 49, 0.08)",
        display: "flex",
        flexDirection: "column",
        height: "640px",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "14px 16px",
          background: "rgba(224, 49, 49, 0.06)",
          borderBottom: "1px solid rgba(224, 49, 49, 0.2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "8px",
        }}
      >
        <div>
          <strong style={{ fontSize: "1.05rem", color: "var(--red)" }}>
            ⛔ Danh sách nhóm cấm thi (Ký hiệu xxx)
          </strong>
          <small className="muted" style={{ display: "block" }}>
            Các sinh viên/nhóm này được đánh dấu cấm thi từ file nguồn, không tham gia phân công chấm thi.
          </small>
        </div>
        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          <Badge tone="danger">{groups.length} nhóm</Badge>
          <Badge tone="neutral">{studentCount} SV</Badge>
        </div>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "14px",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          scrollbarWidth: "thin",
          scrollbarColor: "rgba(224, 49, 49, 0.3) transparent",
        }}
      >
        {groups.map((view) => (
          <GroupCard
            key={view.group.id}
            view={view}
            context={context}
            data={data}
            availableStudents={availableStudents}
            lecturerById={lecturerById}
            workbookById={workbookById}
            onUpdate={onUpdate}
            onDataChange={onDataChange}
            onNotice={onNotice}
          />
        ))}
      </div>
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
  const isBarred = isBarredGroupCode(view.group.groupCode);

  const wbId =
    view.group.sourceWorkbookId ||
    view.members[0]?.student.sourceWorkbookId ||
    context.students.find((s) =>
      context.members.some(
        (m) => m.groupId === view.group.id && m.studentId === s.id,
      ),
    )?.sourceWorkbookId;
  const wb = wbId ? workbookById.get(wbId) : null;
  const wbLabel = wb
    ? wb.groupPrefix
      ? `${wb.groupPrefix} (${getWorkbookLabel(wb)})`
      : getWorkbookLabel(wb)
    : "";

  const formattedTitle =
    view.group.groupCode.toLowerCase().includes("nhóm") ||
    view.group.groupCode.includes("-") ||
    view.group.groupCode.includes("_")
      ? view.group.groupCode
      : `Nhóm ${view.group.groupCode}`;

  return (
    <article className="group-card">
      <div className="group-header">
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              flexWrap: "wrap",
            }}
          >
            <h3 style={{ margin: 0 }}>{formattedTitle}</h3>
            {wbLabel ? (
              <Badge tone="info">
                📋 {wbLabel}
              </Badge>
            ) : null}
          </div>
          <p style={{ marginTop: "4px" }}>
            {view.studentCount} sinh viên ·{" "}
            {isBarred ? (
              <Badge tone="danger">⛔ Cấm thi (Không chấm)</Badge>
            ) : grader ? (
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
              <option value="">
                {isBarred ? "— Cấm thi (Không chấm) —" : "— Chưa phân công —"}
              </option>
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
