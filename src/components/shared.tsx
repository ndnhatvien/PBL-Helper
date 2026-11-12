import { useEffect, useState, type ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "default" | "success" | "warning" | "danger" | "info";
}) {
  return (
    <div className={`stat-card tone-${tone}`}>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {hint ? <span className="stat-hint">{hint}</span> : null}
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "info" | "purple";
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function EmptyState({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      {children ? <p>{children}</p> : null}
    </div>
  );
}

export function Notice({
  tone,
  children,
  onClose,
}: {
  tone: "info" | "success" | "warning" | "danger";
  children: ReactNode;
  onClose?: () => void;
}) {
  return (
    <div className={`notice notice-${tone}`} role="status">
      <div>{children}</div>
      {onClose ? (
        <button type="button" className="icon-button" onClick={onClose} aria-label="Đóng">
          ×
        </button>
      ) : null}
    </div>
  );
}

export function ProgressBar({
  value,
  max,
  label,
}: {
  value: number;
  max: number;
  label?: string;
}) {
  const percent = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="progress">
      <div className="progress-meta">
        <span>{label}</span>
        <span>
          {value}/{max} ({percent}%)
        </span>
      </div>
      <div className="progress-track">
        <div className="progress-value" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export function EditableRoomCell({
  value,
  placeholder = "Chưa xếp phòng",
  onSave,
}: {
  value: string;
  placeholder?: string;
  onSave: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value ?? "");

  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  return (
    <input
      type="text"
      className="cell-input"
      value={draft}
      placeholder={placeholder}
      title="Nhấn Enter hoặc bấm ra ngoài để lưu"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const trimmed = draft.trim();
        if (trimmed !== (value ?? "").trim()) {
          onSave(trimmed);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          (event.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}
