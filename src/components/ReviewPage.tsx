import { useMemo, useState } from "react";
import type { BatchContext } from "../domain/selectors";
import { getReviewRows } from "../domain/selectors";
import type { AppData } from "../store/store";
import type { ExamBatch, ReviewStatus } from "../types";
import { saveReview } from "../store/actions";
import { Badge, EmptyState, Notice, PageHeader, StatCard } from "./shared";

function statusBadge(status: ReviewStatus) {
  if (status === "approved") return <Badge tone="success">Đã duyệt</Badge>;
  if (status === "needs_changes") return <Badge tone="danger">Cần kiểm tra lại</Badge>;
  return <Badge tone="warning">Chờ rà soát</Badge>;
}

export function ReviewPage({
  data,
  setData,
  context,
  batch,
  currentLecturerId,
  currentRole,
  onNotice,
  notice,
  onCloseNotice,
}: {
  data: AppData;
  setData: React.Dispatch<React.SetStateAction<AppData>>;
  context: BatchContext;
  batch: ExamBatch | null;
  currentLecturerId: string | null;
  currentRole: "coordinator" | "advisor";
  onNotice: (tone: "info" | "success" | "warning" | "danger", text: string) => void;
  notice: { tone: "info" | "success" | "warning" | "danger"; text: string } | null;
  onCloseNotice: () => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const lecturerById = useMemo(
    () => new Map(context.lecturers.map((lecturer) => [lecturer.id, lecturer])),
    [context.lecturers],
  );
  const rows = useMemo(
    () => getReviewRows(context, currentLecturerId, lecturerById),
    [context, currentLecturerId, lecturerById],
  );
  const reviewer = currentLecturerId ? lecturerById.get(currentLecturerId) : null;
  const grouped = useMemo(() => {
    const map = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = row.group?.id ?? "none";
      const list = map.get(key) ?? [];
      list.push(row);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [rows]);

  const responsible = rows.filter((row) => row.canReview);
  const counts = {
    pending: responsible.filter((row) => (row.review?.status ?? "pending") === "pending").length,
    approved: responsible.filter((row) => row.review?.status === "approved").length,
    needsChanges: responsible.filter((row) => row.review?.status === "needs_changes").length,
  };

  if (!batch) {
    return (
      <div className="page">
        <PageHeader title="GVHD rà soát điểm" description="Chọn đợt thi trước." />
        <EmptyState title="Chưa có đợt thi" />
      </div>
    );
  }

  if (currentRole !== "advisor" || !reviewer) {
    return (
      <div className="page">
        <PageHeader
          title="GVHD rà soát điểm"
          description="Chọn vai trò GVHD ở thanh trên cùng để xem nhóm và rà soát điểm theo từng sinh viên."
        />
        <EmptyState title="Đang ở vai trò điều phối viên">
          Bộ chọn vai trò chỉ mô phỏng. Chọn một giảng viên trong danh sách “Vai trò demo” ở header
          để kiểm tra quyền xem và quyền rà soát.
        </EmptyState>
      </div>
    );
  }

  function handleSave(studentId: string, status: ReviewStatus) {
    const note = drafts[studentId] ?? "";
    const result = saveReview(data, studentId, reviewer!.id, status, note);
    if (result.error) {
      onNotice("danger", result.error);
      return;
    }
    setData(result.data);
    onNotice(
      "success",
      status === "approved"
        ? "Đã duyệt điểm sinh viên."
        : status === "needs_changes"
          ? "Đã ghi nhận yêu cầu kiểm tra lại cho sinh viên."
          : "Đã lưu ghi chú rà soát.",
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="GVHD rà soát điểm"
        description={`Đang xem với vai trò ${reviewer.displayName}. Chính sách all_scores: xem điểm mọi thành viên trong nhóm hiển thị, nhưng chỉ rà soát sinh viên mình là GVHD hiệu lực.`}
      />

      {notice ? (
        <Notice tone={notice.tone} onClose={onCloseNotice}>
          {notice.text}
        </Notice>
      ) : null}

      <div className="stat-grid">
        <StatCard label="Nhóm hiển thị" value={grouped.length} />
        <StatCard label="Sinh viên mình phụ trách" value={responsible.length} tone="info" />
        <StatCard label="Chờ rà soát" value={counts.pending} tone="warning" />
        <StatCard label="Đã duyệt" value={counts.approved} tone="success" />
        <StatCard label="Cần kiểm tra lại" value={counts.needsChanges} tone="danger" />
      </div>

      {grouped.length === 0 ? (
        <EmptyState title="Chưa có nhóm nào liên quan đến bạn">
          Bạn chỉ thấy nhóm có ít nhất một sinh viên mà mình là GVHD hiệu lực.
        </EmptyState>
      ) : (
        <div className="review-groups">
          {grouped.map(([groupId, groupRows]) => {
            const group = groupRows[0]?.group;
            return (
              <section className="panel review-group" key={groupId}>
                <div className="panel-header">
                  <div>
                    <h2>Nhóm {group?.groupCode ?? "—"}</h2>
                    <p>
                      GVHD mặc định:{" "}
                      {group?.defaultAdvisorId
                        ? lecturerById.get(group.defaultAdvisorId)?.displayName ?? "—"
                        : "—"}{" "}
                      · {groupRows.length} sinh viên (hiển thị tất cả điểm theo all_scores)
                    </p>
                  </div>
                  <Badge tone="info">
                    {groupRows.filter((row) => row.canReview).length} sinh viên bạn được rà soát
                  </Badge>
                </div>

                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>MSSV</th>
                        <th>Họ tên</th>
                        <th>Điểm</th>
                        <th>GVHD hiệu lực</th>
                        <th>Quyền rà soát</th>
                        <th>Trạng thái</th>
                        <th>Ghi chú & thao tác</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupRows.map((row) => {
                        const status = row.review?.status ?? "pending";
                        const noteValue = drafts[row.student.id] ?? row.review?.note ?? "";
                        return (
                          <tr
                            key={row.student.id}
                            className={row.canReview ? "reviewable" : "readonly-row"}
                          >
                            <td>{row.student.mssv}</td>
                            <td>{row.student.name}</td>
                            <td>
                              <strong>{row.score ?? "—"}</strong>
                            </td>
                            <td>
                              {row.advisorName}
                              <small className="cell-sub">
                                {row.advisorSource === "student_override"
                                  ? "GVHD riêng"
                                  : row.advisorSource === "group_default"
                                    ? "Mặc định nhóm"
                                    : "Chưa gán"}
                              </small>
                            </td>
                            <td>
                              {row.canReview ? (
                                <Badge tone="success">Được rà soát</Badge>
                              ) : (
                                <Badge tone="neutral">Ngoài phạm vi</Badge>
                              )}
                            </td>
                            <td>
                              {statusBadge(status)}
                              {row.review ? (
                                <small className="cell-sub">
                                  {new Date(row.review.updatedAt).toLocaleString("vi-VN")}
                                </small>
                              ) : null}
                            </td>
                            <td className="review-cell">
                              {row.canReview ? (
                                <>
                                  <textarea
                                    rows={2}
                                    value={noteValue}
                                    onChange={(event) =>
                                      setDrafts((previous) => ({
                                        ...previous,
                                        [row.student.id]: event.target.value,
                                      }))
                                    }
                                    placeholder="Ghi chú rà soát cho sinh viên này..."
                                  />
                                  <div className="button-row">
                                    <button
                                      type="button"
                                      className="button small success"
                                      onClick={() => handleSave(row.student.id, "approved")}
                                    >
                                      Duyệt
                                    </button>
                                    <button
                                      type="button"
                                      className="button small danger"
                                      onClick={() => handleSave(row.student.id, "needs_changes")}
                                    >
                                      Yêu cầu kiểm tra lại
                                    </button>
                                    <button
                                      type="button"
                                      className="button small secondary"
                                      onClick={() => handleSave(row.student.id, status)}
                                    >
                                      Lưu ghi chú
                                    </button>
                                  </div>
                                </>
                              ) : (
                                <span className="muted">
                                  Chỉ xem. Sinh viên này do GVHD khác rà soát.
                                  {row.review?.note ? (
                                    <span className="readonly-note">Ghi chú: {row.review.note}</span>
                                  ) : null}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
