import { useEffect, useMemo, useState } from "react";
import type { AppData } from "./store/store";
import { setActiveBatch } from "./store/actions";
import { useAppStore } from "./store/useAppStore";
import { filterBatchContext, getDashboardStats } from "./domain/selectors";
import { createDemoData } from "./demo";
import { DashboardPage } from "./components/DashboardPage";
import { ImportPage } from "./components/ImportPage";
import { GroupsPage } from "./components/GroupsPage";
import { GraderExportPage } from "./components/GraderExportPage";
import { GradedImportPage } from "./components/GradedImportPage";
import { ReviewPage } from "./components/ReviewPage";
import { FinalExportPage } from "./components/FinalExportPage";
import { Badge, Notice } from "./components/shared";
import { useAuth, signOut, fetchAllProfiles } from "./supabase/auth";
import { AuthModal } from "./components/AuthModal";
import { SupabaseGuideModal } from "./components/SupabaseGuideModal";
import { UserManagementModal } from "./components/UserManagementModal";

type PageId =
  | "overview"
  | "import"
  | "groups"
  | "assignment"
  | "grader-export"
  | "graded-import"
  | "review"
  | "final-export";

const PAGES: Array<{ id: PageId; label: string; short: string }> = [
  { id: "overview", label: "Tổng quan", short: "01" },
  { id: "import", label: "Nhập danh sách SV & GVHD", short: "02" },
  { id: "groups", label: "Quản lý nhóm & Phân công chấm", short: "03" },
  { id: "grader-export", label: "Xuất file chấm", short: "04" },
  { id: "graded-import", label: "Nhập điểm đã chấm", short: "05" },
  { id: "review", label: "GVHD rà soát điểm", short: "06" },
  { id: "final-export", label: "Xuất danh sách cuối", short: "07" },
];

type NoticeState = {
  tone: "info" | "success" | "warning" | "danger";
  text: string;
} | null;

export default function App() {
  const auth = useAuth();
  const {
    data,
    setData,
    resetData,
    persistError,
    isCloudConfigured,
    isCloudSyncing,
    reloadFromCloud,
    syncAllToCloud,
  } = useAppStore(auth.user?.id);

  const [page, setPage] = useState<PageId>("overview");
  const [notice, setNotice] = useState<NoticeState>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isGuideModalOpen, setIsGuideModalOpen] = useState(false);
  const [isUserMgmtOpen, setIsUserMgmtOpen] = useState(false);
  const [pendingGuestCount, setPendingGuestCount] = useState(0);

  const refreshPendingGuests = async () => {
    try {
      const list = await fetchAllProfiles();
      const count = list.filter((p) => p.role === "guest").length;
      setPendingGuestCount(count);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    refreshPendingGuests();
  }, [auth.user]);

  const batch = useMemo(
    () => data.batches.find((item) => item.id === data.activeBatchId) ?? null,
    [data.batches, data.activeBatchId],
  );

  const context = useMemo(
    () =>
      filterBatchContext(
        data,
        batch?.id ?? "",
      ),
    [data, batch?.id],
  );

  const stats = useMemo(() => getDashboardStats(context, batch), [context, batch]);
  const lecturerById = useMemo(
    () => new Map(context.lecturers.map((lecturer) => [lecturer.id, lecturer])),
    [context.lecturers],
  );

  const currentLecturer = data.currentLecturerId
    ? lecturerById.get(data.currentLecturerId) ?? null
    : null;

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [page, data.activeBatchId]);

  // Tự động tải dữ liệu cloud khi đăng nhập
  useEffect(() => {
    if (auth.user && isCloudConfigured) {
      reloadFromCloud();
    }
  }, [auth.user, isCloudConfigured, reloadFromCloud]);

  // Tự động gán quyền GVHD nếu tài khoản đăng nhập là giảng viên
  useEffect(() => {
    if (!auth.user || !auth.profile) return;
    if (auth.profile.role === "advisor") {
      const matchName = (auth.profile.lecturerName || auth.profile.displayName || "").trim().toLowerCase();
      const matchEmail = (auth.user.email || "").trim().toLowerCase();
      const matched = context.lecturers.find(
        (l) =>
          (l.displayName && l.displayName.trim().toLowerCase() === matchName) ||
          (l.email && l.email.trim().toLowerCase() === matchEmail),
      );
      if (matched && data.currentLecturerId !== matched.id) {
        changeData({
          ...data,
          currentRole: "advisor",
          currentLecturerId: matched.id,
        });
      }
    } else if (auth.profile.role === "coordinator" && data.currentRole !== "coordinator" && !data.currentLecturerId) {
      changeData({
        ...data,
        currentRole: "coordinator",
        currentLecturerId: null,
      });
    }
  }, [auth.user, auth.profile, context.lecturers]);

  function onNotice(
    tone: "info" | "success" | "warning" | "danger",
    text: string,
  ) {
    setNotice({ tone, text });
  }

  function changeData(next: AppData) {
    if (auth.user && auth.profile?.role === "guest") {
      onNotice(
        "warning",
        "Tài khoản Khách (Guest) chỉ có quyền xem, không được thay đổi dữ liệu. Hãy liên hệ Admin (admin@dut.udn.vn) để được cấp quyền.",
      );
      return;
    }
    setData(next);
  }

  function handleRoleChange(value: string) {
    if (value === "coordinator") {
      changeData({
        ...data,
        currentRole: "coordinator",
        currentLecturerId: null,
      });
      return;
    }
    changeData({
      ...data,
      currentRole: "advisor",
      currentLecturerId: value,
    });
    setPage("review");
  }

  function handleDemo() {
    const result = createDemoData(data);
    if (result.error) {
      onNotice("danger", result.error);
      return;
    }
    setData(result.data);
    setPage("groups");
    onNotice(
      "success",
      "Đã tạo đợt demo riêng với 2 file nguồn, 3 nhóm, 2 GVHD và 1 giảng viên chấm. Dữ liệu không trộn với các đợt khác.",
    );
  }

  const commonProps = {
    data,
    batch,
    context,
    stats,
    onNavigate: (next: string) =>
      setPage(next === "assignment" ? "groups" : (next as PageId)),
    onNotice,
    notice,
    onCloseNotice: () => setNotice(null),
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">PBL</div>
          <div>
            <strong>PBL Grading &amp; Review</strong>
            <span>Quản lý chấm và rà soát điểm theo nhóm</span>
          </div>
        </div>

        <div className="topbar-controls">
          <label className="top-select">
            <span>Đợt thi</span>
            <select
              value={batch?.id ?? ""}
              onChange={(event) =>
                changeData(setActiveBatch(data, event.target.value || null))
              }
            >
              <option value="">— Chưa chọn —</option>
              {data.batches.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.isDemo ? "[DEMO] " : ""}
                  {item.name}
                </option>
              ))}
            </select>
          </label>

          {/* Nếu chưa đăng nhập: hiển thị chọn vai trò demo */}
          {!auth.user ? (
            <label className="top-select role-select">
              <span>Vai trò thử nghiệm</span>
              <select
                value={currentLecturer ? currentLecturer.id : "coordinator"}
                onChange={(event) => handleRoleChange(event.target.value)}
                disabled={!batch}
              >
                <option value="coordinator">Điều phối viên</option>
                {context.lecturers.map((lecturer) => (
                  <option key={lecturer.id} value={lecturer.id}>
                    GVHD/GV: {lecturer.displayName}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {/* Trạng thái xác thực & Cloud */}
          {auth.user ? (
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              {(auth.profile?.role === "coordinator" || auth.user.email === "admin@dut.udn.vn") ? (
                <button
                  type="button"
                  className={`button small ${pendingGuestCount > 0 ? "warning" : "secondary"}`}
                  onClick={() => setIsUserMgmtOpen(true)}
                  title="Quản lý tài khoản & Duyệt quyền cho Khách"
                >
                  👥 Quản lý người dùng {pendingGuestCount > 0 ? `(${pendingGuestCount} chờ duyệt)` : ""}
                </button>
              ) : null}

              <Badge tone={auth.profile?.role === "guest" ? "warning" : auth.profile?.role === "coordinator" ? "info" : "purple"}>
                {auth.profile?.role === "guest"
                  ? "Khách (Guest)"
                  : auth.profile?.role === "coordinator"
                    ? "Điều phối viên"
                    : "GVHD"}
              </Badge>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  background: "rgba(255, 255, 255, 0.16)",
                  border: "1px solid rgba(255, 255, 255, 0.3)",
                  borderRadius: "20px",
                  padding: "4px 12px",
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "#ffffff",
                  textShadow: "0 1px 2px rgba(0,0,0,0.35)",
                }}
              >
                <span>👤</span>
                <span>{auth.profile?.displayName || auth.user.email}</span>
              </div>
              {isCloudSyncing ? (
                <Badge tone="warning">🔄 Đang lưu...</Badge>
              ) : isCloudConfigured ? (
                <Badge tone="success">☁️ Cloud</Badge>
              ) : (
                <Badge tone="neutral">Local Admin</Badge>
              )}
              <button
                type="button"
                className="button small secondary"
                onClick={async () => {
                  await signOut();
                  onNotice("info", "Đã đăng xuất tài khoản.");
                }}
              >
                Đăng xuất
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              {isCloudConfigured ? (
                <button
                  type="button"
                  className="button small"
                  onClick={() => setIsAuthModalOpen(true)}
                >
                  🔑 Đăng nhập / Đăng ký
                </button>
              ) : (
                <button
                  type="button"
                  className="button small secondary"
                  onClick={() => setIsGuideModalOpen(true)}
                >
                  ☁️ Kết nối Supabase
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Banner thông báo trạng thái Cloud / Quyền người dùng */}
      {auth.user && auth.profile?.role === "guest" ? (
        <div
          style={{
            backgroundColor: "#fff9db",
            borderBottom: "1px solid #ffe066",
            padding: "10px 24px",
            fontSize: "13px",
            color: "#e67700",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "8px",
          }}
        >
          <div>
            ⏳ <strong>Tài khoản Khách (Guest)</strong>: Email của bạn (<code>{auth.user.email}</code>) không thuộc tên miền trường <code>@dut.udn.vn</code>. Bạn chỉ có quyền xem thông tin cơ bản. Vui lòng liên hệ Admin (<code>admin@dut.udn.vn</code>) để được phê duyệt vai trò chính thức.
          </div>
          <Badge tone="warning">Chờ Admin duyệt</Badge>
        </div>
      ) : auth.user ? (
        <div
          style={{
            backgroundColor: "#f0fdf4",
            borderBottom: "1px solid #86efac",
            padding: "8px 24px",
            fontSize: "13px",
            color: "#166534",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "10px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
            <span>
              🟢 <strong>{isCloudConfigured ? "Đã kết nối Supabase Cloud" : "Đăng nhập chế độ Quản trị"}</strong> · Đang đăng nhập:
            </span>
            <span
              style={{
                backgroundColor: "#166534",
                color: "#ffffff",
                fontWeight: 700,
                padding: "2px 10px",
                borderRadius: "12px",
                fontSize: "12px",
                letterSpacing: "0.01em",
                boxShadow: "0 1px 2px rgba(0,0,0,0.12)",
                display: "inline-block",
              }}
            >
              {auth.profile?.displayName || auth.user.email}
            </span>
            <span style={{ color: "#15803d", fontWeight: 600 }}>
              ({auth.profile?.role === "coordinator"
                ? "Quyền Điều phối viên"
                : `GVHD: ${auth.profile?.lecturerName || auth.profile?.displayName}`})
            </span>
            {pendingGuestCount > 0 ? (
              <span
                style={{
                  marginLeft: "8px",
                  backgroundColor: "#fef3c7",
                  border: "1px solid #fcd34d",
                  color: "#92400e",
                  padding: "2px 8px",
                  borderRadius: "6px",
                  fontWeight: 600,
                  fontSize: "12px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <span>🔔 Có {pendingGuestCount} tài khoản khách đang chờ phê duyệt.</span>
                <button
                  type="button"
                  style={{
                    background: "none",
                    border: "none",
                    textDecoration: "underline",
                    color: "#b45309",
                    cursor: "pointer",
                    fontWeight: 700,
                    padding: 0,
                  }}
                  onClick={() => setIsUserMgmtOpen(true)}
                >
                  Duyệt ngay
                </button>
              </span>
            ) : null}
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              className="button small secondary"
              onClick={async () => {
                const res = await syncAllToCloud();
                if (res.error) onNotice("danger", res.error);
                else onNotice("success", `Đã đồng bộ ${res.successCount} đợt thi lên Supabase Cloud.`);
              }}
            >
              Đồng bộ dữ liệu máy lên Cloud
            </button>
            <button
              type="button"
              className="button small secondary"
              onClick={async () => {
                await reloadFromCloud();
                onNotice("success", "Đã tải dữ liệu mới nhất từ Supabase Cloud.");
              }}
            >
              Tải lại từ Cloud
            </button>
          </div>
        </div>
      ) : isCloudConfigured ? (
        <div
          style={{
            backgroundColor: "#fff9db",
            borderBottom: "1px solid #ffe066",
            padding: "8px 24px",
            fontSize: "13px",
            color: "#e67700",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "8px",
          }}
        >
          <div>
            ⚠️ <strong>Chế độ khách (Local Cache)</strong>: Bạn chưa đăng nhập. Hãy đăng nhập để lưu trữ vĩnh viễn trên Supabase Cloud và làm việc nhóm với các giảng viên khác.
          </div>
          <button
            type="button"
            className="button small"
            onClick={() => setIsAuthModalOpen(true)}
          >
            Đăng nhập ngay
          </button>
        </div>
      ) : (
        <div className="role-warning">
          Ứng dụng đang chạy ở <strong>chế độ Offline (LocalStorage trên trình duyệt)</strong>.
          Để lưu trữ trên máy chủ và cho nhiều giảng viên đăng nhập, bạn có thể{" "}
          <button
            type="button"
            style={{
              background: "none",
              border: "none",
              color: "#1971c2",
              textDecoration: "underline",
              cursor: "pointer",
              fontWeight: 600,
              padding: 0,
            }}
            onClick={() => setIsGuideModalOpen(true)}
          >
            kết nối Supabase Cloud miễn phí tại đây
          </button>.
        </div>
      )}

      <nav className="main-nav" aria-label="Chức năng chính">
        {PAGES.map((item) => (
          <button
            key={item.id}
            type="button"
            className={page === item.id ? "nav-item active" : "nav-item"}
            onClick={() => setPage(item.id)}
          >
            <span>{item.short}</span>
            {item.label}
          </button>
        ))}
      </nav>

      {persistError ? <Notice tone="danger">{persistError}</Notice> : null}

      <main>
        {page === "overview" ? (
          <DashboardPage
            data={data}
            batch={batch}
            stats={stats}
            onDataChange={changeData}
            onCreateDemo={handleDemo}
            onReset={resetData}
            onNavigate={(next) => setPage(next as PageId)}
            notice={notice}
            onCloseNotice={() => setNotice(null)}
          />
        ) : null}

        {page === "import" ? (
          <ImportPage
            data={data}
            setData={setData}
            batch={batch}
            onNavigate={(next) => setPage(next as PageId)}
            onNotice={onNotice}
            notice={notice}
            onCloseNotice={() => setNotice(null)}
          />
        ) : null}

        {page === "groups" || (page as string) === "assignment" ? (
          <GroupsPage
            data={data}
            setData={setData}
            context={context}
            batch={batch}
            onNavigate={(next) =>
              setPage(next === "assignment" ? "groups" : (next as PageId))
            }
            onNotice={onNotice}
            notice={notice}
            onCloseNotice={() => setNotice(null)}
          />
        ) : null}

        {page === "grader-export" ? (
          <GraderExportPage
            data={data}
            setData={setData}
            context={context}
            batch={batch}
            onNavigate={(next) => setPage(next as PageId)}
            onNotice={onNotice}
            notice={notice}
            onCloseNotice={() => setNotice(null)}
          />
        ) : null}

        {page === "graded-import" ? (
          <GradedImportPage
            data={data}
            setData={setData}
            context={context}
            batch={batch}
            onNavigate={(next) => setPage(next as PageId)}
            onNotice={onNotice}
            notice={notice}
            onCloseNotice={() => setNotice(null)}
          />
        ) : null}

        {page === "review" ? (
          <ReviewPage
            data={data}
            setData={setData}
            context={context}
            batch={batch}
            currentLecturerId={data.currentLecturerId}
            currentRole={data.currentRole}
            onNotice={onNotice}
            notice={notice}
            onCloseNotice={() => setNotice(null)}
          />
        ) : null}

        {page === "final-export" ? (
          <FinalExportPage
            {...commonProps}
            data={data}
            context={context}
            batch={batch}
            stats={stats}
          />
        ) : null}
      </main>

      <footer className="app-footer">
        <span>PBL Grading &amp; Review — {isCloudConfigured ? "Supabase Cloud" : "Offline local-first"}</span>
        <span>
          {batch
            ? `${stats.studentCount} sinh viên · ${stats.groupCount} nhóm · ${stats.scoredCount} đã có điểm`
            : "Chưa chọn đợt thi"}
        </span>
      </footer>

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onNotice={onNotice}
      />

      <SupabaseGuideModal
        isOpen={isGuideModalOpen}
        onClose={() => setIsGuideModalOpen(false)}
      />

      <UserManagementModal
        isOpen={isUserMgmtOpen}
        onClose={() => {
          setIsUserMgmtOpen(false);
          refreshPendingGuests();
        }}
        onNotice={onNotice}
      />
    </div>
  );
}
