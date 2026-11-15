import { useState } from "react";

export function SupabaseGuideModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  function handleCopySchema() {
    fetch("/supabase/schema.sql")
      .then((res) => res.text())
      .then((sql) => {
        navigator.clipboard.writeText(sql);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        style={{ maxWidth: "620px", width: "100%" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>⚡ Hướng dẫn kết nối Supabase Cloud (Miễn phí)</h3>
          <button type="button" className="button icon-button" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal-body" style={{ lineHeight: 1.6 }}>
          <p style={{ marginTop: 0 }}>
            Để dữ liệu được <strong>lưu trữ vĩnh viễn trên máy chủ</strong> (không mất khi xóa cache)
            và cho phép <strong>nhiều thầy/cô đăng nhập cùng lúc</strong>, bạn chỉ cần 3 bước đơn giản:
          </p>

          <ol style={{ paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "12px" }}>
            <li>
              <strong>Tạo dự án miễn phí trên Supabase:</strong>
              <div>
                Truy cập{" "}
                <a href="https://supabase.com" target="_blank" rel="noreferrer">
                  https://supabase.com
                </a>
                , đăng nhập bằng GitHub hoặc Email và bấm <em>&quot;New Project&quot;</em>.
              </div>
            </li>

            <li>
              <strong>Khởi tạo bảng cơ sở dữ liệu (Database Schema):</strong>
              <div>
                Tại Dashboard của Supabase, vào mục <strong>SQL Editor</strong> ở thanh menu trái.
                Mở file <code>supabase/schema.sql</code> trong thư mục dự án (hoặc bấm nút bên dưới để copy),
                dán vào và bấm <strong>Run</strong>.
              </div>
              <button
                type="button"
                className="button small secondary"
                onClick={handleCopySchema}
                style={{ marginTop: "6px" }}
              >
                {copied ? "✓ Đã copy mã SQL!" : "📋 Copy đường dẫn / mã schema.sql"}
              </button>
            </li>

            <li>
              <strong>Điền thông tin vào file cấu hình <code>.env</code>:</strong>
              <div>
                Tại Supabase, vào <strong>Project Settings</strong> ➔ <strong>API</strong> để lấy:
                <ul style={{ margin: "4px 0", paddingLeft: "20px" }}>
                  <li>
                    <code>Project URL</code>
                  </li>
                  <li>
                    <code>anon public key</code>
                  </li>
                </ul>
                Tạo file <code>.env</code> ở thư mục gốc của dự án (copy từ <code>.env.example</code>):
                <pre
                  style={{
                    backgroundColor: "#f8f9fa",
                    padding: "8px 12px",
                    borderRadius: "6px",
                    fontSize: "12px",
                    border: "1px solid #dee2e6",
                    overflowX: "auto",
                    marginTop: "6px",
                  }}
                >
                  {`VITE_SUPABASE_URL=https://xxxx.supabase.co\nVITE_SUPABASE_ANON_KEY=eyJhbGciOi...`}
                </pre>
                Khởi động lại lệnh <code>npm run dev</code>, web sẽ tự động kết nối và chuyển sang chế độ Cloud!
              </div>
            </li>
          </ol>

          <div
            style={{
              backgroundColor: "#e7f5ff",
              border: "1px solid #a5d8ff",
              padding: "10px 14px",
              borderRadius: "6px",
              fontSize: "13px",
              color: "#1864ab",
              marginTop: "16px",
            }}
          >
            💡 <strong>Mẹo:</strong> Trong khi chưa cấu hình Supabase, hệ thống vẫn hoạt động 100% đầy đủ chức năng
            ở chế độ Offline (LocalStorage) để bạn thử nghiệm trước.
          </div>
        </div>

        <div className="modal-actions" style={{ marginTop: "16px", textAlign: "right" }}>
          <button type="button" className="button" onClick={onClose}>
            Đã hiểu
          </button>
        </div>
      </div>
    </div>
  );
}
