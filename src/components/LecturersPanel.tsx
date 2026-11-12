import { useState } from "react";
import type { AppData } from "../store/store";
import type { ExamBatch } from "../types";
import { addLecturer, updateLecturer } from "../store/actions";
import { Badge, EditableRoomCell, EmptyState } from "./shared";

export function LecturersPanel({
  data,
  batch,
  onDataChange,
  onNotice,
}: {
  data: AppData;
  batch: ExamBatch;
  onDataChange: (next: AppData) => void;
  onNotice: (tone: "info" | "success" | "warning" | "danger", text: string) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [room, setRoom] = useState("");
  const lecturers = data.lecturers.filter((lecturer) => lecturer.batchId === batch.id);

  function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    const result = addLecturer(data, batch.id, name, email, room);
    if (result.error) {
      onNotice("danger", result.error);
      return;
    }
    onDataChange(result.data);
    setName("");
    setEmail("");
    setRoom("");
    onNotice("success", "Đã thêm giảng viên vào đợt.");
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Giảng viên của đợt</h2>
          <p className="muted">
            Giảng viên chấm và GVHD là hai vai trò độc lập; một người có thể đảm nhận cả hai nhưng
            hệ thống không mặc định như vậy.
          </p>
        </div>
        <Badge tone="info">{lecturers.length} giảng viên</Badge>
      </div>

      {lecturers.length === 0 ? (
        <EmptyState title="Chưa có giảng viên">
          Thêm GVHD và giảng viên chấm trước khi tạo nhóm/phân công.
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tên</th>
                <th>Email</th>
                <th>Phòng chấm</th>
                <th>Vai trò đang gán</th>
                <th>Trạng thái</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lecturers.map((lecturer) => {
                const advisorGroups = data.groups.filter(
                  (group) =>
                    group.batchId === batch.id &&
                    group.defaultAdvisorId === lecturer.id,
                ).length;
                const overrides = data.members.filter(
                  (member) => member.advisorOverrideId === lecturer.id,
                ).length;
                const graderGroups = data.groups.filter(
                  (group) =>
                    group.batchId === batch.id && group.graderId === lecturer.id,
                ).length;
                return (
                  <tr key={lecturer.id}>
                    <td>{lecturer.displayName}</td>
                    <td>{lecturer.email || "—"}</td>
                    <td>
                      <EditableRoomCell
                        value={lecturer.room ?? ""}
                        onSave={(next) => {
                          onDataChange(
                            updateLecturer(data, lecturer.id, { room: next }),
                          );
                          onNotice(
                            "success",
                            `Đã cập nhật phòng chấm cho ${lecturer.displayName}: ${next || "(trống)"}`,
                          );
                        }}
                      />
                    </td>
                    <td>
                      {advisorGroups > 0 || overrides > 0 ? (
                        <Badge tone="info">
                          GVHD {advisorGroups} nhóm + {overrides} ngoại lệ
                        </Badge>
                      ) : null}{" "}
                      {graderGroups > 0 ? (
                        <Badge tone="purple">Chấm {graderGroups} nhóm</Badge>
                      ) : null}
                      {advisorGroups === 0 && overrides === 0 && graderGroups === 0
                        ? "Chưa gán"
                        : null}
                    </td>
                    <td>
                      <Badge tone={lecturer.active ? "success" : "neutral"}>
                        {lecturer.active ? "Đang hoạt động" : "Tạm ẩn"}
                      </Badge>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="button small ghost"
                        onClick={() =>
                          onDataChange(
                            updateLecturer(data, lecturer.id, {
                              active: !lecturer.active,
                            }),
                          )
                        }
                      >
                        {lecturer.active ? "Tạm ẩn" : "Kích hoạt"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <form className="inline-form" onSubmit={handleAdd}>
        <label className="field">
          <span>Tên giảng viên *</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="VD: Nguyễn Văn A"
          />
        </label>
        <label className="field">
          <span>Email</span>
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="a@example.edu.vn"
          />
        </label>
        <label className="field">
          <span>Phòng chấm</span>
          <input
            value={room}
            onChange={(event) => setRoom(event.target.value)}
            placeholder="VD: F201, C102"
          />
        </label>
        <button type="submit" className="button">Thêm giảng viên</button>
      </form>
    </section>
  );
}
