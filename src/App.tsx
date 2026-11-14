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
  const { data, setData, resetData, persistError } = useAppStore();
  const [page, setPage] = useState<PageId>("overview");
  const [notice, setNotice] = useState<NoticeState>(null);

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

  function onNotice(
    tone: "info" | "success" | "warning" | "danger",
    text: string,
  ) {
    setNotice({ tone, text });
  }

  function changeData(next: AppData) {
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

          <label className="top-select role-select">
            <span>Vai trò demo</span>
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

          {currentLecturer ? (
            <Badge tone="purple">Đang xem: {currentLecturer.displayName}</Badge>
          ) : (
            <Badge tone="info">Điều phối viên</Badge>
          )}
        </div>
      </header>

      <div className="role-warning">
        Bộ chọn vai trò chỉ mô phỏng để kiểm thử luồng, <strong>không phải xác thực an toàn</strong>.
        MVP lưu dữ liệu trên trình duyệt hiện tại; không dùng dữ liệu sinh viên thật khi chưa có
        đăng nhập, phân quyền máy chủ và RLS.
      </div>

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
        <span>PBL Grading &amp; Review — MVP local-first</span>
        <span>
          {batch
            ? `${stats.studentCount} sinh viên · ${stats.groupCount} nhóm · ${stats.scoredCount} đã có điểm`
            : "Chưa chọn đợt thi"}
        </span>
      </footer>
    </div>
  );
}
