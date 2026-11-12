# PBL Grading & Review

MVP local-first quản lý chấm và rà soát điểm PBL theo `spec.md` và `PROMPT_AGENT.md`.

Ứng dụng chạy hoàn toàn trên trình duyệt: nhập nhiều file Excel, tạo nhóm xuyên file, gán GVHD mặc định/ngoại lệ, phân công giảng viên chấm theo nhóm, xuất phiếu chấm, nhập điểm đã chấm có kiểm tra xung đột, cho GVHD rà soát theo từng sinh viên và xuất lại đúng các file nguồn.

> **Cảnh báo phạm vi:** đây là MVP cục bộ. Bộ chọn vai trò chỉ mô phỏng luồng nghiệp vụ, **không phải đăng nhập hay phân quyền an toàn**. Không dùng dữ liệu sinh viên thật trên môi trường dùng chung trước khi bổ sung auth, phân quyền phía máy chủ và RLS.

## 1. Công nghệ

- React 19 + TypeScript + Vite
- SheetJS (`xlsx`) đọc/ghi workbook `.xlsx` / `.xls`
- Vitest cho unit + integration test
- Playwright Core + Chrome/Edge headless cho smoke test E2E giao diện
- Lưu trữ: `localStorage` của trình duyệt hiện tại

## 2. Chạy nhanh

Yêu cầu Node.js 20+ (đã kiểm thử với Node 22.22.3).

```bash
npm install
npm run dev
```

Mở địa chỉ Vite in ra (mặc định `http://localhost:5173`).

- Bấm **Tạo dữ liệu demo** ở trang Tổng quan để có ngay:
  - 2 file nguồn sinh từ Excel thật qua đúng pipeline nhập;
  - 6 sinh viên, 3 nhóm (PBL01 có sinh viên từ cả 2 file);
  - GVHD mặc định A, GVHD ngoại lệ B cho một sinh viên;
  - giảng viên chấm C khác cả hai GVHD.
- Hoặc tạo đợt thi mới, nhập file mẫu trong `mau/`.

Build production:

```bash
npm run build
npm run preview
```

## 3. Kiểm thử

```bash
npm test            # 22 unit + integration tests
npm run typecheck   # typecheck app + test
npm run build       # production build
npm run test:e2e:ui # build + headless Chrome/Edge E2E giao diện
```

`test:e2e:ui` cần Chrome hoặc Edge. Nếu trình duyệt không ở vị trí mặc định:

```powershell
$env:CHROME_PATH = "C:\duong\dan\chrome.exe"
npm run test:e2e:ui
```

Kết quả đã chạy trong môi trường phát triển:

- `npm test`: **5 test files, 22 tests passed**
- `npm run typecheck`: **passed**
- `npm run build`: **passed** (Vite cảnh báo bundle > 500 kB do `xlsx`)
- `npm run test:e2e:ui`: **E2E UI PASS** — tạo demo → xuất phiếu chấm → sửa điểm Excel → nhập lại → GVHD A/B rà soát độc lập → xuất lại 2 file nguồn, kiểm tra điểm đúng MSSV/dòng.

## 4. Luồng sử dụng

| Bước | Trang | Việc cần làm |
| --- | --- | --- |
| 1 | Tổng quan | Tạo đợt thi, xác nhận thang điểm và số chữ số thập phân. Có thể dùng dữ liệu demo. |
| 2 | Nhập danh sách Excel | Chọn nhiều file, chọn sheet, kiểm tra/ánh xạ cột, xem lỗi rồi mới xác nhận nhập. |
| 3 | Quản lý nhóm PBL | Thêm giảng viên, tạo nhóm từ sinh viên ở bất kỳ file nguồn nào, gán GVHD mặc định và override từng sinh viên. |
| 4 | Phân công chấm | Chọn cân bằng theo sinh viên (mặc định) hoặc theo nhóm, bấm gợi ý, chỉnh thủ công nếu cần. |
| 5 | Xuất file chấm | Tải một file cho mỗi giảng viên chấm; file có cột `studentKey` ẩn. |
| 6 | Nhập điểm đã chấm | Tải một/nhiều file kết quả, xem báo cáo lỗi/thiếu/xung đột rồi xác nhận cập nhật. |
| 7 | GVHD rà soát điểm | Chọn vai trò GVHD demo ở header; xem điểm cả nhóm theo `all_scores`, chỉ duyệt/yêu cầu kiểm tra sinh viên mình phụ trách. |
| 8 | Xuất danh sách cuối | Xem checklist, tạo một file mới cho mỗi file nguồn, tải về và đối chiếu báo cáo. |

### Quy tắc nghiệp vụ đã áp dụng

- **GVHD hiệu lực (policy `both`)**: `override của sinh viên > GVHD mặc định của nhóm > null`.
- **Xem và rà soát là hai quyền khác nhau**:
  - GVHD thấy nhóm nếu là GVHD hiệu lực của ít nhất một thành viên;
  - được xem điểm **mọi** thành viên trong nhóm đó (`all_scores`);
  - chỉ được duyệt/yêu cầu kiểm tra sinh viên có GVHD hiệu lực là mình.
- **Rà soát lưu theo từng sinh viên + người rà soát**, không lưu theo nhóm. Trạng thái hai sinh viên độc lập.
- **Nhóm là đơn vị phân công**: không bao giờ chia thành viên cùng nhóm cho nhiều giảng viên chấm.
- **Cân bằng mặc định theo số sinh viên**: sắp nhóm giảm dần theo sĩ số; chọn giảng viên có tổng sinh viên ít nhất; hòa thì ít nhóm hơn; vẫn hòa dùng thứ tự ổn định. Có chế độ cân bằng theo số nhóm.
- **Nhóm ngoài 2–3 sinh viên** chỉ bị cảnh báo, không tự xóa/từ chối.
- **Giảng viên chấm và GVHD độc lập**, hệ thống không mặc định là cùng người.

## 5. Xử lý Excel

### Nhập file nguồn

- Hỗ trợ nhiều file `.xlsx`; `.xls` phụ thuộc khả năng đọc của SheetJS.
- Tự dò dòng tiêu đề trong 30 dòng đầu bằng các nhãn như `MSSV`, `Họ tên`, `Lớp sinh hoạt`, `Nhóm`, `CK`/`Điểm`.
- Đọc metadata học phần phía trên bảng (ví dụ `Mã lớp học phần`, `Tên lớp học phần`).
- Cho phép đổi sheet và ánh xạ lại từng cột ngay trên bản xem trước.
- Bỏ qua dòng trống và dòng lặp lại tiêu đề, có ghi cảnh báo; **không bỏ im lặng dòng có dữ liệu lỗi**.
- Chặn nhập khi: thiếu cột MSSV, MSSV trống, MSSV trùng trong sheet, trùng giữa các file đang nhập hoặc trùng với dữ liệu đã có trong đợt.
- Giữ `originalBase64`, tên file, sheet, header row, số dòng nguồn và dữ liệu gốc của từng sinh viên.

File mẫu `mau/Bang_diem_106337026102438B_CK.xlsx` đã được kiểm thử: sheet `Bảng điểm thành phần`, header dòng 3, 36 sinh viên, cột `CK` được nhận là cột điểm.

### Xuất phiếu chấm

Mỗi giảng viên chấm nhận một file riêng, chỉ chứa nhóm được giao, gồm:

- tên đợt, mã đợt, tên/mã giảng viên chấm;
- hướng dẫn ngắn và thang điểm;
- mã nhóm, MSSV, họ tên, lớp, mã/tên học phần;
- GVHD mặc định, GVHD hiệu lực từng sinh viên;
- cột `Điểm` và `Ghi chú chấm`;
- cột `studentKey` ẩn ở cột A, là khóa ổn định sinh khi nhập, **không dùng số thứ tự dòng Excel**.

### Nhập điểm đã chấm

- Ghép theo `studentKey`; chỉ dùng MSSV làm khóa dự phòng khi MSSV duy nhất trong đợt.
- Không phụ thuộc thứ tự dòng; đã có test đảo thứ tự dòng.
- Kiểm tra mã đợt, giảng viên chấm, dòng trùng, sinh viên lạ, sinh viên thiếu, điểm trống, sai định dạng, ngoài phạm vi, vượt số chữ số thập phân.
- Phát hiện hai file cho cùng sinh viên hai điểm khác nhau → đánh dấu xung đột, **không tự ghi đè**. Xung đột được lưu lại để dashboard và báo cáo xuất cuối hiển thị.
- Chỉ cập nhật sau khi điều phối viên xác nhận; lưu `ScoreChangeLog` gồm điểm cũ/mới, người chấm, file nguồn, thời điểm.

### Xuất lại file nguồn

- Tạo một file mới cho mỗi file nguồn, tên `<tên gốc>_da_cap_nhat.xlsx`.
- Đọc lại đúng workbook/sheet gốc, ghi điểm vào ô của đúng dòng nguồn đã lưu.
- Giữ thứ tự dòng, giá trị các cột khác và các sheet không liên quan trong khả năng của SheetJS.
- Không ghi đè file nguồn.
- Báo cáo số dòng cập nhật, số sinh viên chưa có điểm và xung đột còn lại.
- Nếu file nguồn chưa có cột điểm, thêm cột `Điểm` ở cuối bảng và ghi cảnh báo trong báo cáo.

## 6. Kiến trúc mã nguồn

```text
src/
  App.tsx                    # điều hướng, chọn đợt, chọn vai trò demo
  types.ts                   # mô hình dữ liệu
  domain/
    advisor.ts               # GVHD hiệu lực, quyền rà soát
    assignment.ts            # thuật toán phân công cân bằng
    selectors.ts             # tổng hợp nhóm, review, dashboard
  excel/
    importWorkbook.ts        # đọc file, dò header, mapping, validate
    grader.ts                # xuất/đọc phiếu chấm
    gradedImport.ts          # ghép điểm, lỗi, xung đột, thiếu
    finalExport.ts           # ghi điểm về file nguồn
  store/
    store.ts                 # AppData, load/save localStorage
    actions.ts               # nghiệp vụ nhập, nhóm, điểm, review
    useAppStore.ts           # React state + persistence
  components/                # 8 trang giao diện + panel dùng chung
  demo.ts                    # đợt demo riêng, đi qua pipeline thật
  styles.css
scripts/e2e-ui.mjs           # smoke test trình duyệt thật
mau/                         # file Excel mẫu
```

Logic nghiệp vụ và xử lý Excel được tách khỏi component. Repository không có backend.

## 7. Dữ liệu và lưu trữ

- Khóa localStorage: `pbl-grading-review-v1`.
- Lưu cả file gốc dạng base64, sinh viên, nhóm, thành viên, giảng viên, điểm, review, audit log, lịch sử nhập và xung đột.
- Dữ liệu chỉ nằm trên trình duyệt/máy hiện tại. Xóa dữ liệu trình duyệt hoặc bấm **Xóa toàn bộ dữ liệu cục bộ** sẽ mất dữ liệu.
- Giới hạn localStorage thường 5–10 MB; file lớn làm tăng dung lượng base64 khoảng 33%. UI cảnh báo khi file > 8 MB nhưng vẫn có thể lưu thất bại.
- Dữ liệu demo nằm trong đợt riêng có `isDemo = true`, không trộn vào đợt thật.

## 8. Tiêu chí nghiệm thu

Đã kiểm thử tự động các mục chính:

- [x] Nhập nhiều file, chọn sheet, ánh xạ cột, xem trước.
- [x] Báo MSSV trống/trùng trong file, giữa các file và với đợt đã nhập.
- [x] Tạo nhóm có sinh viên từ hai file nguồn khác nhau.
- [x] Cảnh báo nhóm dưới 2 / trên 3 sinh viên.
- [x] GVHD nhóm + override sinh viên; GVHD hiệu lực đúng ưu tiên.
- [x] Cân bằng theo số sinh viên mặc định, cân bằng theo nhóm; không chia nhóm.
- [x] Hiển thị workload và cho đổi người chấm thủ công.
- [x] Xuất một file mỗi giảng viên, có khóa ổn định ẩn.
- [x] Nhập điểm theo khóa, độc lập thứ tự dòng; báo trùng/lạ/thiếu/sai/xung đột.
- [x] Không tự ghi đè điểm xung đột.
- [x] GVHD thấy `all_scores` nhưng chỉ rà soát đúng sinh viên mình phụ trách.
- [x] Trạng thái/ghi chú/thời điểm lưu độc lập theo sinh viên; thống kê đếm theo sinh viên.
- [x] Xuất đúng một file cho mỗi file nguồn, điểm về đúng dòng/MSSV, không ghi đè file gốc.
- [x] E2E giao diện thật chạy thành công qua Chrome headless.

Ca E2E chuẩn ở mục 11 của spec cũng được cài đặt trong `src/e2e.test.ts` và chạy qua `npm test`.

## 9. Hạn chế còn lại

- **Chưa có xác thực/phân quyền thật**. Chọn vai trò chỉ là mô phỏng phía client; mọi kiểm tra quyền hiện chạy trong ứng dụng cục bộ.
- **Chưa có backend, Supabase, RLS hay lưu trữ đám mây**. Dữ liệu không chia sẻ giữa máy/người dùng.
- **Định dạng Excel**: SheetJS có thể không giữ đầy đủ style, công thức, ảnh, macro hoặc một số định dạng đặc biệt khi đọc/ghi; giá trị, thứ tự dòng/cột và sheet được giữ trong khả năng thư viện.
- **File `.xls`** phụ thuộc khả năng thư viện; khuyến nghị dùng `.xlsx`.
- **Giới hạn localStorage**: file lớn có thể không lưu được; chưa có IndexedDB.
- **Xung đột điểm** không có nút “chấp nhận một giá trị” trực tiếp; cần sửa file và nhập lại để hệ thống đánh dấu xung đột cũ đã xử lý.
- **Tải nhiều file**: trình duyệt có thể chặn tải tự động nhiều file; UI có nút tải lại từng file.
- **Chưa hỗ trợ ZIP** cho bộ phiếu chấm/file cuối.
- **Chưa xóa/sửa từng đợt thi**: có tạo và chọn đợt; thao tác xóa hiện là xóa toàn bộ dữ liệu cục bộ.
- **Không sửa trực tiếp MSSV/họ tên sau khi nhập**: cần sửa file nguồn và nhập lại (hoặc mở rộng thêm).
- Gói `xlsx@0.18.5` trên npm có cảnh báo bảo mật mức high (prototype pollution/ReDoS). MVP chỉ dùng file do người dùng chủ động chọn; trước production cần nâng cấp nguồn SheetJS chính thức hoặc thay thư viện và kiểm thử lại.
- Bundle production lớn hơn 500 kB do thư viện Excel; chưa code-split.

## 10. Hướng phát triển production

- Supabase Auth + Postgres + Storage; RLS cho từng đợt/nhóm/điểm/review.
- Xác minh quyền GVHD và quyền rà soát ở database/backend, không chỉ UI.
- Lưu file gốc trên object storage thay vì base64 trong localStorage.
- Khóa lạc quan/khóa giao dịch khi nhiều điều phối viên cùng cập nhật.
- Xuất ZIP và lưu lịch sử phiên bản file.
- Kiểm thử bảo mật, tải dữ liệu lớn và định dạng Excel phức tạp trước khi dùng dữ liệu thật.
