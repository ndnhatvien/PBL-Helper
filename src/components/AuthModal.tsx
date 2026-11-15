import { useState } from "react";
import { signInWithEmail, signUpWithEmail, resetPassword, signInWithGoogle, DEFAULT_ADMIN } from "../supabase/auth";
import type { UserRole } from "../supabase/types";

export function AuthModal({
  isOpen,
  onClose,
  onNotice,
}: {
  isOpen: boolean;
  onClose: () => void;
  onNotice: (tone: "info" | "success" | "warning" | "danger", text: string) => void;
}) {
  const [tab, setTab] = useState<"signin" | "signup" | "forgot">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<UserRole>("coordinator");
  const [lecturerName, setLecturerName] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);

    try {
      if (tab === "signin") {
        await signInWithEmail(email, password);
        onNotice("success", `Đăng nhập thành công với tài khoản ${email}!`);
        onClose();
      } else if (tab === "signup") {
        const res = await signUpWithEmail(email, password, displayName, role, lecturerName);
        if (res.effectiveRole === "guest") {
          onNotice(
            "warning",
            `Đăng ký thành công! Do email ${email} không thuộc domain @dut.udn.vn, tài khoản của bạn hiện ở trạng thái Khách (Guest). Quản trị viên (admin@dut.udn.vn) sẽ xem xét và phê duyệt quyền cho bạn.`,
          );
        } else {
          onNotice(
            "success",
            `Đăng ký thành công tài khoản trường DUT (${email}) với vai trò ${
              role === "coordinator" ? "Điều phối viên" : "GVHD"
            }!`,
          );
        }
        onClose();
      } else if (tab === "forgot") {
        await resetPassword(email);
        onNotice("info", `Đã gửi hướng dẫn đặt lại mật khẩu đến ${email}. Hãy kiểm tra hộp thư!`);
        setTab("signin");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Đã có lỗi xảy ra.";
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleLogin() {
    try {
      await signInWithGoogle();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Không thể đăng nhập bằng Google.");
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        style={{ maxWidth: "440px", width: "100%" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>
            {tab === "signin"
              ? "Đăng nhập tài khoản"
              : tab === "signup"
                ? "Đăng ký tài khoản mới"
                : "Quên mật khẩu"}
          </h3>
          <button type="button" className="button icon-button" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
            <button
              type="button"
              className={`button small ${tab === "signin" ? "" : "secondary"}`}
              onClick={() => {
                setTab("signin");
                setErrorMsg(null);
              }}
            >
              Đăng nhập
            </button>
            <button
              type="button"
              className={`button small ${tab === "signup" ? "" : "secondary"}`}
              onClick={() => {
                setTab("signup");
                setErrorMsg(null);
              }}
            >
              Đăng ký
            </button>
          </div>

          {errorMsg ? (
            <div
              style={{
                backgroundColor: "#fff5f5",
                color: "#e03131",
                padding: "8px 12px",
                borderRadius: "6px",
                fontSize: "13px",
                marginBottom: "14px",
                border: "1px solid #ffc9c9",
              }}
            >
              ⚠️ {errorMsg}
            </div>
          ) : null}

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {tab === "signin" ? (
              <div
                style={{
                  backgroundColor: "#e7f5ff",
                  border: "1px dashed #74c0fc",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  fontSize: "12px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  color: "#1864ab",
                }}
              >
                <div>
                  👑 <strong>Tài khoản Quản trị:</strong> <code>{DEFAULT_ADMIN.email}</code>
                </div>
                <button
                  type="button"
                  className="button small"
                  style={{ padding: "3px 8px", fontSize: "11px" }}
                  onClick={() => {
                    setEmail(DEFAULT_ADMIN.email);
                    setPassword(DEFAULT_ADMIN.password);
                    setErrorMsg(null);
                  }}
                >
                  ⚡ Điền nhanh
                </button>
              </div>
            ) : null}

            <div>
              <label style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "4px" }}>
                Email công vụ / trường:
              </label>
              <input
                type="email"
                required
                placeholder="tenemail@dut.udn.vn"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid #ced4da" }}
              />
              {tab === "signup" && email.trim() ? (
                email.trim().toLowerCase().endsWith("@dut.udn.vn") ? (
                  <small style={{ color: "#2b8a3e", fontSize: "12px", display: "block", marginTop: "4px" }}>
                    ✓ Email trường Bách Khoa (@dut.udn.vn): Được cấp quyền trực tiếp theo vai trò.
                  </small>
                ) : (
                  <small style={{ color: "#e67700", fontSize: "12px", display: "block", marginTop: "4px" }}>
                    ⚠️ Email ngoài domain @dut.udn.vn: Tài khoản sẽ ở trạng thái Khách (Guest) và cần Admin phê duyệt.
                  </small>
                )
              ) : null}
            </div>

            {tab !== "forgot" ? (
              <div>
                <label style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "4px" }}>
                  Mật khẩu:
                </label>
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid #ced4da" }}
                />
              </div>
            ) : null}

            {tab === "signup" ? (
              <>
                <div>
                  <label style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "4px" }}>
                    Họ và tên đầy đủ:
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="TS. Nguyễn Văn Nam"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid #ced4da" }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "4px" }}>
                    Vai trò chính trong hệ thống:
                  </label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as UserRole)}
                    style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid #ced4da" }}
                  >
                    <option value="coordinator">Điều phối viên (Quản lý đợt, phân công chấm)</option>
                    <option value="advisor">Giảng viên hướng dẫn (Rà soát điểm sinh viên)</option>
                    <option value="grader">Giảng viên chấm thi</option>
                  </select>
                </div>

                {role === "advisor" ? (
                  <div>
                    <label style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "4px" }}>
                      Tên GVHD khớp trong bảng điểm Excel:
                    </label>
                    <input
                      type="text"
                      placeholder="Để trống nếu giống họ tên"
                      value={lecturerName}
                      onChange={(e) => setLecturerName(e.target.value)}
                      style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid #ced4da" }}
                    />
                    <small style={{ color: "#868e96", fontSize: "12px", display: "block", marginTop: "2px" }}>
                      Hệ thống sẽ tự động ghép tên này để gán quyền rà soát sinh viên hướng dẫn của bạn.
                    </small>
                  </div>
                ) : null}
              </>
            ) : null}

            {tab === "signin" ? (
              <div style={{ textAlign: "right" }}>
                <button
                  type="button"
                  style={{ background: "none", border: "none", color: "#1971c2", fontSize: "12px", cursor: "pointer", textDecoration: "underline" }}
                  onClick={() => setTab("forgot")}
                >
                  Quên mật khẩu?
                </button>
              </div>
            ) : null}

            <button
              type="submit"
              className="button"
              disabled={loading}
              style={{ marginTop: "6px" }}
            >
              {loading
                ? "Đang xử lý..."
                : tab === "signin"
                  ? "Đăng nhập"
                  : tab === "signup"
                    ? "Tạo tài khoản"
                    : "Gửi email khôi phục"}
            </button>
          </form>

          <div style={{ textAlign: "center", margin: "16px 0 8px 0", color: "#868e96", fontSize: "12px" }}>
            hoặc
          </div>

          <button
            type="button"
            className="button secondary"
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}
            onClick={handleGoogleLogin}
          >
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              />
            </svg>
            Đăng nhập bằng tài khoản Google trường
          </button>
        </div>
      </div>
    </div>
  );
}
