import { useEffect, useState } from "react";
import { fetchAllProfiles, updateUserProfileRole } from "../supabase/auth";
import type { UserProfile, UserRole } from "../supabase/types";
import { Badge } from "./shared";

export function UserManagementModal({
  isOpen,
  onClose,
  onNotice,
}: {
  isOpen: boolean;
  onClose: () => void;
  onNotice: (tone: "info" | "success" | "warning" | "danger", text: string) => void;
}) {
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [filterTab, setFilterTab] = useState<"all" | "guests">("all");
  const [search, setSearch] = useState("");

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await fetchAllProfiles();
      setProfiles(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  async function handleRoleChange(user: UserProfile, newRole: UserRole) {
    setUpdatingId(user.id);
    const res = await updateUserProfileRole(user.id, newRole);
    setUpdatingId(null);
    if (res.success) {
      onNotice(
        "success",
        `Đã cập nhật vai trò của ${user.displayName || user.email} thành ${
          newRole === "coordinator"
            ? "Điều phối viên"
            : newRole === "advisor"
              ? "Giảng viên hướng dẫn (GVHD)"
              : newRole === "grader"
                ? "Giảng viên chấm"
                : "Khách (Guest)"
        }.`,
      );
      setProfiles((prev) =>
        prev.map((p) => (p.id === user.id ? { ...p, role: newRole } : p)),
      );
    } else {
      onNotice("danger", res.error || "Không thể cập nhật vai trò.");
    }
  }

  const guestCount = profiles.filter((p) => p.role === "guest").length;

  const filtered = profiles.filter((p) => {
    if (filterTab === "guests" && p.role !== "guest") return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      p.email.toLowerCase().includes(q) ||
      p.displayName.toLowerCase().includes(q) ||
      (p.lecturerName && p.lecturerName.toLowerCase().includes(q))
    );
  });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        style={{ maxWidth: "800px", width: "100%" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h3 style={{ margin: 0 }}>👥 Quản lý người dùng &amp; Phê duyệt Guest</h3>
            <small style={{ color: "#868e96" }}>
              Email ngoài domain <code>@dut.udn.vn</code> mặc định ở trạng thái Guest. Admin duyệt
              cấp quyền tại đây.
            </small>
          </div>
          <button type="button" className="button icon-button" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                type="button"
                className={`button small ${filterTab === "all" ? "" : "secondary"}`}
                onClick={() => setFilterTab("all")}
              >
                Tất cả ({profiles.length})
              </button>
              <button
                type="button"
                className={`button small ${filterTab === "guests" ? "" : "secondary"}`}
                onClick={() => setFilterTab("guests")}
              >
                Chờ duyệt / Guest ({guestCount})
              </button>
            </div>

            <input
              type="text"
              placeholder="Tìm theo email, họ tên..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ padding: "6px 10px", borderRadius: "6px", border: "1px solid #ced4da", fontSize: "13px", width: "220px" }}
            />
          </div>

          {loading ? (
            <div style={{ textAlign: "center", padding: "24px", color: "#868e96" }}>
              Đang tải danh sách người dùng...
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: "center", padding: "32px", color: "#868e96" }}>
              {filterTab === "guests" ? "🎉 Không có tài khoản khách nào đang chờ duyệt!" : "Không tìm thấy người dùng nào."}
            </div>
          ) : (
            <div style={{ maxHeight: "420px", overflowY: "auto", border: "1px solid #dee2e6", borderRadius: "8px" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                <thead>
                  <tr style={{ backgroundColor: "#f8f9fa", borderBottom: "1px solid #dee2e6", textAlign: "left" }}>
                    <th style={{ padding: "10px 12px" }}>Người dùng</th>
                    <th style={{ padding: "10px 12px" }}>Email</th>
                    <th style={{ padding: "10px 12px" }}>Vai trò hiện tại</th>
                    <th style={{ padding: "10px 12px", textAlign: "right" }}>Thao tác / Duyệt quyền</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((u) => {
                    const isInternal = u.email.toLowerCase().endsWith("@dut.udn.vn");
                    const isUpdating = updatingId === u.id;

                    return (
                      <tr key={u.id} style={{ borderBottom: "1px solid #f1f3f5" }}>
                        <td style={{ padding: "10px 12px" }}>
                          <strong>{u.displayName || u.email}</strong>
                          {u.lecturerName && u.lecturerName !== u.displayName ? (
                            <small style={{ display: "block", color: "#868e96" }}>
                              Khớp GV: {u.lecturerName}
                            </small>
                          ) : null}
                        </td>
                        <td style={{ padding: "10px 12px" }}>
                          <code>{u.email}</code>
                          {isInternal ? (
                            <span style={{ marginLeft: "6px", color: "#2b8a3e", fontSize: "11px" }}>
                              ✓ DUT
                            </span>
                          ) : (
                            <span style={{ marginLeft: "6px", color: "#e67700", fontSize: "11px" }}>
                              (Ngoài trường)
                            </span>
                          )}
                        </td>
                        <td style={{ padding: "10px 12px" }}>
                          {u.role === "guest" ? (
                            <Badge tone="warning">⏳ Khách (Guest)</Badge>
                          ) : u.role === "coordinator" ? (
                            <Badge tone="info">Điều phối viên</Badge>
                          ) : u.role === "advisor" ? (
                            <Badge tone="purple">GVHD</Badge>
                          ) : (
                            <Badge tone="neutral">GV Chấm</Badge>
                          )}
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "right" }}>
                          {u.role === "guest" ? (
                            <div style={{ display: "flex", gap: "6px", justifyContent: "flex-end" }}>
                              <button
                                type="button"
                                className="button small"
                                disabled={isUpdating}
                                onClick={() => handleRoleChange(u, "advisor")}
                                title="Cấp quyền Giảng viên hướng dẫn"
                              >
                                Duyệt GVHD
                              </button>
                              <button
                                type="button"
                                className="button small secondary"
                                disabled={isUpdating}
                                onClick={() => handleRoleChange(u, "coordinator")}
                                title="Cấp quyền Điều phối viên"
                              >
                                Duyệt ĐPV
                              </button>
                              <button
                                type="button"
                                className="button small secondary"
                                disabled={isUpdating}
                                onClick={() => handleRoleChange(u, "grader")}
                                title="Cấp quyền GV chấm"
                              >
                                Duyệt GV chấm
                              </button>
                            </div>
                          ) : (
                            <div style={{ display: "flex", gap: "6px", justifyContent: "flex-end", alignItems: "center" }}>
                              <select
                                value={u.role}
                                disabled={isUpdating}
                                onChange={(e) => handleRoleChange(u, e.target.value as UserRole)}
                                style={{ padding: "4px 8px", borderRadius: "4px", fontSize: "12px", border: "1px solid #ced4da" }}
                              >
                                <option value="coordinator">Điều phối viên</option>
                                <option value="advisor">GVHD</option>
                                <option value="grader">GV Chấm</option>
                                <option value="guest">Thu hồi về Guest</option>
                              </select>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="modal-actions" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <small style={{ color: "#868e96" }}>
            Tài khoản Admin: <code>admin@dut.udn.vn</code>
          </small>
          <button type="button" className="button" onClick={onClose}>
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
