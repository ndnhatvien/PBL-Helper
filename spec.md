# Đặc tả hệ thống quản lý chấm và rà soát điểm PBL

- **Tên dự án:** PBL Grading & Review
- **Phiên bản:** 1.0
- **Trạng thái:** Đặc tả để AI coding agent triển khai MVP
- **Ngôn ngữ giao diện:** Tiếng Việt
- **Ngôn ngữ mã nguồn:** TypeScript/English identifiers

## 1. Bối cảnh và mục tiêu

Mỗi đợt thi PBL có nhiều file Excel bảng điểm do các giảng viên hoặc bộ môn gửi về. Mỗi file thường tương ứng với một lớp học phần/danh sách cần nhập điểm vào hệ thống đào tạo. Một đợt có thể có nhiều giảng viên chấm, và số sinh viên trong mỗi danh sách không bằng nhau.

Hệ thống phải phân công tương đối đồng đều công việc chấm cho các giảng viên, nhưng vẫn giữ nguyên nhóm PBL: sinh viên cùng nhóm phải được giao cho cùng một giảng viên chấm. Sau khi chấm xong, điểm phải được nhập lại đúng vào các danh sách Excel ban đầu để nhập lên hệ thống đào tạo.

Giảng viên chấm không nhất thiết là giảng viên hướng dẫn (GVHD). Cần lưu riêng thông tin người chấm và GVHD để GVHD rà soát điểm.

## 2. Quyết định nghiệp vụ đã chốt

Các quy tắc sau là yêu cầu bắt buộc, không được tự ý thay đổi:

1. **Quyền xem điểm của GVHD:** `all_scores`.
   - GVHD có thể xem điểm của tất cả thành viên trong nhóm PBL liên quan để có ngữ cảnh rà soát.
   - Quyền xem tất cả điểm không đồng nghĩa với quyền duyệt tất cả sinh viên.
2. **Cách xác định GVHD:** `both`.
   - Mỗi nhóm có thể có một GVHD mặc định.
   - Mỗi sinh viên có thể có GVHD ngoại lệ riêng.
   - GVHD hiệu lực của sinh viên được xác định theo thứ tự: `GVHD riêng của sinh viên > GVHD mặc định của nhóm`.
3. **Rà soát điểm:** trạng thái rà soát phải được lưu **theo từng sinh viên**, không phải theo nhóm.
4. GVHD chỉ được duyệt/yêu cầu kiểm tra lại đối với sinh viên mà mình là GVHD hiệu lực.
5. Giảng viên chấm và GVHD là hai vai trò/người dùng độc lập; không được mặc định là cùng người.
6. Một nhóm PBL thông thường có 2–3 sinh viên. Nhóm khác số lượng này phải được cảnh báo, không tự ý xóa hoặc từ chối dữ liệu.
7. Sinh viên trong cùng nhóm phải được giao cùng một giảng viên chấm.
8. Phải giữ lại liên kết đến file nguồn, sheet, dòng và dữ liệu gốc để trả điểm về đúng danh sách ban đầu.

## 3. Vai trò

### 3.1 Quản trị viên / điều phối đợt thi
Có quyền:
- Tạo và quản lý đợt thi.
- Nhập nhiều file Excel.
- Kiểm tra, sửa ánh xạ cột và lỗi dữ liệu.
- Quản lý sinh viên, nhóm PBL, GVHD mặc định và ngoại lệ.
- Quản lý danh sách giảng viên chấm.
- Phân công nhóm cho giảng viên chấm và điều chỉnh thủ công.
- Xuất file Excel riêng cho từng giảng viên chấm.
- Nhập file đã chấm, xem báo cáo lỗi/xung đột.
- Xác nhận cập nhật điểm.
- Xuất lại từng file Excel nguồn với điểm đã cập nhật.

### 3.2 Giảng viên chấm
Có quyền:
- Xem các nhóm được phân công chấm.
- Tải file Excel được phân công.
- Nhập điểm trong file Excel và gửi trả.
- Không được mặc nhiên có quyền xem/sửa toàn bộ dữ liệu đợt thi.

### 3.3 GVHD
Có quyền:
- Xem nhóm có ít nhất một sinh viên mà mình là GVHD hiệu lực.
- Theo chính sách `all_scores`, xem điểm của mọi thành viên trong nhóm hiển thị.
- Nhìn rõ sinh viên nào thuộc trách nhiệm rà soát của mình.
- Chỉ duyệt hoặc yêu cầu kiểm tra lại sinh viên mà mình là GVHD hiệu lực.
- Ghi chú và cập nhật trạng thái rà soát cho từng sinh viên.
- Không được rà soát sinh viên được giao cho GVHD khác.

Trong MVP chạy cục bộ, có thể dùng bộ chọn vai trò/người dùng mô phỏng để kiểm thử luồng. Phải ghi rõ đây không phải xác thực an toàn. Trước khi đưa dữ liệu sinh viên thật lên môi trường nhiều người dùng, bắt buộc có đăng nhập, phân quyền phía máy chủ và kiểm thử bảo mật.

## 4. Luồng nghiệp vụ chính

### 4.1 Tạo đợt thi và nhập Excel
1. Tạo đợt thi với tên, học kỳ/ngày thi (không bắt buộc) và ghi chú.
2. Cho phép nhập nhiều file `.xlsx`; hỗ trợ `.xls` nếu thư viện sử dụng xử lý ổn định.
3. Với mỗi file, hiển thị danh sách sheet và cho chọn sheet.
4. Hiển thị bản xem trước và cho ánh xạ cột sang các trường chuẩn:
   - MSSV (bắt buộc)
   - Họ tên
   - Lớp
   - Mã học phần
   - Tên học phần
   - Mã nhóm (nếu có)
   - Điểm hiện có (nếu có)
   - Các cột khác cần giữ nguyên
5. Phát hiện MSSV trống, trùng MSSV trong/cross-file, dòng rỗng, cột bắt buộc thiếu và dữ liệu bất thường.
6. Chỉ nhập dữ liệu chính thức sau khi điều phối viên xác nhận.
7. Không bỏ cột không nhận diện được. Lưu dữ liệu gốc và metadata của file nguồn để phục hồi/xuất lại.

### 4.2 Quản lý nhóm PBL và GVHD
1. Tạo nhóm, đặt mã nhóm và thêm sinh viên từ bất kỳ file nguồn nào trong đợt thi.
2. Một sinh viên không thuộc nhiều hơn một nhóm đang hoạt động trong cùng đợt thi, trừ khi điều phối viên xử lý ngoại lệ rõ ràng.
3. Cảnh báo nhóm có ít hơn 2 hoặc nhiều hơn 3 sinh viên.
4. Gán GVHD mặc định cho nhóm.
5. Cho phép gán GVHD ngoại lệ riêng cho từng sinh viên.
6. Hiển thị GVHD hiệu lực và nguồn xác định (`student_override` hoặc `group_default`).
7. Cảnh báo sinh viên chưa có GVHD hiệu lực.

### 4.3 Phân công giảng viên chấm
1. Điều phối viên chọn danh sách giảng viên chấm.
2. Mặc định cân bằng theo số sinh viên; có thể chọn cân bằng theo số nhóm.
3. Thuật toán gợi ý:
   - Sắp xếp nhóm theo số thành viên giảm dần.
   - Mỗi nhóm giao cho giảng viên hiện có tổng số sinh viên được giao ít nhất.
   - Nếu hòa, ưu tiên người có ít nhóm hơn; nếu vẫn hòa, dùng thứ tự ổn định.
4. Nhóm không được chia cho nhiều người chấm.
5. Hiển thị số nhóm và số sinh viên của từng người chấm.
6. Cho phép điều chỉnh thủ công trước khi xuất file.

### 4.4 Xuất file cho từng giảng viên chấm
Xuất một file Excel cho mỗi giảng viên chấm, chỉ chứa nhóm được giao cho người đó. Tối thiểu có:
- Tên/mã đợt thi
- Mã nhóm
- Tên giảng viên chấm
- GVHD mặc định của nhóm
- MSSV và họ tên từng sinh viên
- Lớp
- Mã/tên học phần
- GVHD hiệu lực của từng sinh viên
- Cột nhập điểm
- Ghi chú chấm (nếu có)
- Mã định danh nội bộ ổn định để đối soát khi nhập lại; có thể ẩn cột này nhưng phải giữ được giá trị

File phải có hướng dẫn ngắn cho giảng viên. Không dùng số thứ tự dòng Excel làm khóa nhận diện.

### 4.5 Nhập file đã chấm
1. Cho tải lên một hoặc nhiều file kết quả.
2. Ghép bản ghi theo `studentKey` nội bộ; chỉ dùng MSSV làm khóa dự phòng nếu MSSV duy nhất trong đợt.
3. Kiểm tra người chấm và đợt thi kỳ vọng nếu thông tin này có trong file.
4. Phát hiện bản ghi không rõ sinh viên, trùng dòng, thiếu sinh viên, điểm trống, điểm sai định dạng, điểm ngoài phạm vi và điểm xung đột giữa các file.
5. Không tự ý ghi đè điểm xung đột.
6. Hiển thị bản xem trước thay đổi và báo cáo lỗi.
7. Chỉ cập nhật điểm sau khi điều phối viên xác nhận.
8. Lưu nguồn file, người chấm, thời điểm nhập và giá trị trước đó để truy vết.

Thang điểm và số chữ số thập phân phải cấu hình được theo đợt thi; không tự mặc định thang điểm nếu chưa được xác nhận. Có thể dùng 0–10 làm giá trị mẫu trong demo, nhưng phải ghi rõ là cấu hình demo.

### 4.6 GVHD rà soát
1. GVHD mở màn hình rà soát.
2. Hiển thị nhóm có ít nhất một thành viên có GVHD hiệu lực là người đang xem.
3. Theo `all_scores`, hiển thị điểm của tất cả thành viên trong nhóm.
4. Đánh dấu rõ sinh viên nào người đang xem được phép rà soát.
5. Với từng sinh viên đủ quyền, cho phép:
   - Duyệt (`approved`)
   - Yêu cầu kiểm tra lại (`needs_changes`)
   - Ghi chú
6. Trạng thái của mỗi sinh viên độc lập; thao tác trên một sinh viên không được làm thay đổi trạng thái thành viên khác.
7. Lưu người rà soát, thời điểm cập nhật và ghi chú.
8. Thống kê chờ rà soát/đã duyệt/cần kiểm tra phải đếm theo sinh viên.

### 4.7 Xuất lại danh sách Excel ban đầu
1. Điều phối viên xem checklist hoàn tất và các lỗi/xung đột chưa xử lý.
2. Với mỗi file nguồn, tạo một file đầu ra mới dựa trên dữ liệu gốc.
3. Ghi điểm vào đúng sinh viên bằng khóa dữ liệu, không dựa vào thứ tự dòng.
4. Giữ nguyên thứ tự dòng, các cột không liên quan và cấu trúc sheet trong khả năng thư viện.
5. Không ghi đè file nguồn.
6. Xuất đúng số file tương ứng với danh sách nguồn ban đầu.
7. Báo cáo số dòng đã cập nhật, chưa có điểm và các vấn đề còn lại.

## 5. Mô hình dữ liệu đề xuất

Có thể điều chỉnh tên bảng nhưng phải giữ được các quan hệ và ràng buộc nghiệp vụ.

- **ExamBatch**: `id`, `name`, `exam_date`, `term`, `status`, `created_at`, `updated_at`.
- **SourceWorkbook**: `id`, `batch_id`, `original_file_name`, `sheet_name`, `header_mapping`, `original_workbook_metadata`, `imported_at`, `original_file_blob/storage_path`.
- **Student**: `id/studentKey`, `batch_id`, `mssv`, `name`, `class_name`, `course_code`, `course_name`, `source_workbook_id`, `source_sheet_name`, `source_row_number`, `original_row_data`.
- **PblGroup**: `id`, `batch_id`, `group_code`, `default_advisor_id`, `grader_id`, timestamps.
- **GroupMember**: `id`, `group_id`, `student_id`, `advisor_override_id`.
- **Lecturer**: `id`, `display_name`, `email`, `active`.
- **UserLecturerLink** (production): liên kết tài khoản đăng nhập với hồ sơ giảng viên.
- **Score**: `id`, `student_id`, `value`, `grader_id`, `source_file_id`, `updated_at`.
- **ScoreReview**: `id`, `student_id`, `reviewer_id`, `status`, `note`, `updated_at`; unique theo `(student_id, reviewer_id)` nếu chỉ lưu trạng thái hiện hành.
- **ScoreChangeLog**: `id`, `student_id`, `old_value`, `new_value`, `changed_by`, `source_file_name`, `changed_at`.
- **ImportRun**: `id`, `batch_id`, `file_name`, `created_at`, `status`, `validation_report`.

Một nhóm có thể có nhiều GVHD hiệu lực khác nhau do ngoại lệ cấp sinh viên. Vì vậy, bản ghi rà soát phải gắn với sinh viên, không chỉ với nhóm.

## 6. Quy tắc nghiệp vụ dùng chung

### 6.1 Tính GVHD hiệu lực

Tạo một hàm dùng chung cho UI, xuất Excel và kiểm tra quyền:

```ts
function getEffectiveAdvisor(
  studentOverrideId?: string | null,
  groupDefaultAdvisorId?: string | null
): string | null {
  return studentOverrideId || groupDefaultAdvisorId || null;
}
```

Nguồn GVHD hiệu lực:
- Có override sinh viên: `student_override`.
- Không có override nhưng có GVHD nhóm: `group_default`.
- Cả hai không có: `unassigned`.

### 6.2 Quyền xem và quyền rà soát là hai khái niệm riêng

- **Quyền thấy nhóm:** người đang xem là GVHD hiệu lực của ít nhất một thành viên.
- **Quyền xem điểm:** được xem điểm mọi thành viên trong nhóm đang hiển thị (`all_scores`).
- **Quyền rà soát sinh viên:** chỉ khi `effectiveAdvisorId === currentLecturerId`.

```ts
function canAdvisorReviewStudent(
  currentLecturerId: string,
  effectiveAdvisorId: string | null
): boolean {
  return effectiveAdvisorId === currentLecturerId;
}
```

Không dựa vào việc ẩn nút ở frontend làm cơ chế bảo mật trong production. Backend/database phải xác minh lại quyền.

### 6.3 Trạng thái rà soát

```ts
type ReviewStatus = "pending" | "approved" | "needs_changes";

type Review = {
  studentKey: string;
  reviewerId: string;
  status: ReviewStatus;
  note: string;
  updatedAt: string;
};
```

Key tra cứu trạng thái phải là `studentKey` hoặc `studentId`, tuyệt đối không dùng `groupId`.

## 7. Yêu cầu giao diện

Toàn bộ giao diện người dùng bằng tiếng Việt. Đề xuất menu:
1. Tổng quan
2. Nhập danh sách Excel
3. Quản lý nhóm PBL
4. Phân công chấm
5. Xuất file chấm
6. Nhập điểm đã chấm
7. GVHD rà soát điểm
8. Xuất danh sách cuối

### Tổng quan
- Số file nguồn
- Tổng sinh viên
- Tổng nhóm
- Số giảng viên chấm
- Số sinh viên đã có điểm
- Số sinh viên chờ rà soát/đã duyệt/cần kiểm tra
- Cảnh báo dữ liệu

### Quản lý nhóm
- Mã nhóm
- Danh sách thành viên, MSSV, lớp/học phần và file nguồn
- GVHD mặc định
- GVHD ngoại lệ cấp sinh viên
- GVHD hiệu lực và nguồn
- Giảng viên chấm
- Cảnh báo số lượng thành viên và thiếu GVHD

### Phân công
- Danh sách giảng viên chấm
- Số nhóm/sinh viên được giao
- Phương thức cân bằng
- Điều chỉnh thủ công
- Nút xuất Excel theo giảng viên

### GVHD rà soát
Mỗi dòng sinh viên hiển thị:
- Họ tên, MSSV, nhóm
- Điểm
- GVHD hiệu lực
- Có được người hiện tại rà soát hay không
- Trạng thái, ghi chú, thời điểm cập nhật
- Nút duyệt/yêu cầu kiểm tra chỉ bật cho sinh viên thuộc trách nhiệm của người hiện tại

## 8. Kiến trúc kỹ thuật

### 8.1 MVP cục bộ
Ưu tiên hoàn thành luồng end-to-end chạy trên máy tính mà chưa cần backend:
- React + TypeScript + Vite
- Thư viện Excel như SheetJS (`xlsx`) để đọc/ghi workbook
- Tách module xử lý Excel, logic nghiệp vụ và giao diện
- Có thể dùng localStorage/IndexedDB nếu cần lưu giữa các lần tải lại; phải ghi rõ dữ liệu nằm trên trình duyệt/máy hiện tại
- Không tuyên bố đã có đăng nhập/phân quyền an toàn nếu chỉ dùng bộ chọn vai trò demo

### 8.2 Triển khai nhiều người dùng sau MVP
Kiến trúc gợi ý:
- Frontend React + TypeScript
- Supabase Auth
- Supabase Postgres
- Supabase Storage cho file nguồn/file đã chấm
- RLS cho quyền dữ liệu
- Cloudflare Pages hoặc nền tảng static hosting tương đương

Không đưa `service_role` key vào frontend. Bắt buộc có RLS và kiểm thử quyền trước khi lưu dữ liệu sinh viên thật.

## 9. Chất lượng, lỗi và bảo vệ dữ liệu

- Kiểm tra loại file, kích thước, sheet và kiểu dữ liệu.
- Không ghép theo số dòng Excel.
- Không tự động ghi đè điểm xung đột.
- Giữ file nguồn bất biến.
- Cung cấp bản xem trước trước các thao tác nhập/cập nhật hàng loạt.
- Hiển thị lỗi dễ hiểu bằng tiếng Việt.
- Hỗ trợ hủy thao tác hoặc tạo bản xuất mới khi có thể.
- Lưu audit log cho thay đổi điểm và trạng thái rà soát khi kiến trúc hỗ trợ.
- Không ghi log toàn bộ dữ liệu sinh viên/điểm nếu không cần thiết.

## 10. Tiêu chí nghiệm thu

### Nhập và nhóm
- [ ] Nhập nhiều file Excel cùng đợt.
- [ ] Chọn sheet, ánh xạ cột, xem trước.
- [ ] Báo MSSV trống/trùng.
- [ ] Tạo nhóm có thành viên từ hai file nguồn khác nhau.
- [ ] Cảnh báo nhóm dưới 2 hoặc trên 3 sinh viên.
- [ ] Gán GVHD nhóm và override GVHD sinh viên.
- [ ] GVHD hiệu lực đúng ưu tiên override.

### Phân công và nhập điểm
- [ ] Cân bằng theo số sinh viên mặc định.
- [ ] Không chia nhóm cho nhiều giảng viên chấm.
- [ ] Hiển thị số nhóm và số sinh viên mỗi giảng viên.
- [ ] Có thể đổi người chấm thủ công.
- [ ] Xuất một file cho mỗi giảng viên.
- [ ] File xuất chứa khóa ổn định cho từng sinh viên.
- [ ] Nhập file đã chấm theo khóa, không theo thứ tự dòng.
- [ ] Báo dòng trùng, dòng lạ, sinh viên thiếu, điểm sai và điểm xung đột.

### GVHD
- [ ] GVHD thấy nhóm nếu là GVHD hiệu lực của ít nhất một thành viên.
- [ ] `all_scores`: thấy điểm mọi thành viên trong nhóm hiển thị.
- [ ] Chỉ rà soát sinh viên mà mình là GVHD hiệu lực.
- [ ] Duyệt/yêu cầu kiểm tra một sinh viên không ảnh hưởng sinh viên khác.
- [ ] Ghi chú và thời gian được lưu theo từng sinh viên.
- [ ] Thống kê đếm theo sinh viên.

### Xuất cuối
- [ ] Tạo một file cuối cho mỗi file nguồn.
- [ ] Điểm về đúng sinh viên.
- [ ] Giữ thứ tự dòng/các cột không liên quan trong phạm vi thư viện.
- [ ] Không ghi đè file nguồn.
- [ ] Báo cáo điểm chưa có và xung đột chưa xử lý.

### Bảo mật và minh bạch
- [ ] Ghi rõ MVP local chưa phải ứng dụng đa người dùng an toàn.
- [ ] Không coi bộ chọn vai trò demo là xác thực thật.
- [ ] Chỉ đưa dữ liệu thật lên production sau khi triển khai và kiểm thử auth/RLS.

## 11. Ca kiểm thử bắt buộc end-to-end

Dữ liệu kiểm thử cần có tối thiểu:
- Hai file nguồn khác nhau.
- Một nhóm có hai sinh viên đến từ hai file.
- Một GVHD mặc định của nhóm và một override GVHD riêng cho một sinh viên.
- Một giảng viên chấm khác với cả hai GVHD.

Kịch bản:
1. Nhập hai file.
2. Tạo nhóm gồm sinh viên ở cả hai file.
3. Gán GVHD mặc định A cho nhóm; gán override GVHD B cho sinh viên thứ hai.
4. Giao nhóm cho giảng viên chấm C.
5. Xuất file cho C, nhập điểm mẫu và nhập lại.
6. Đăng nhập/chuyển sang vai trò demo GVHD A: thấy điểm cả hai sinh viên; chỉ rà soát được sinh viên thứ nhất.
7. Chuyển sang GVHD B: thấy điểm cả hai sinh viên; chỉ rà soát được sinh viên thứ hai.
8. Duyệt sinh viên thứ nhất và yêu cầu kiểm tra sinh viên thứ hai; xác minh trạng thái độc lập.
9. Xuất hai file nguồn cuối; xác minh điểm trở về đúng dòng/sinh viên.

## 12. Kế hoạch triển khai gợi ý

1. Đọc repo và file Excel mẫu trước khi sửa code.
2. Hoàn thiện types và dữ liệu mẫu.
3. Viết unit tests cho GVHD hiệu lực, quyền rà soát và cân bằng.
4. Làm nhập Excel và mapping.
5. Làm quản lý nhóm, GVHD và phân công.
6. Làm xuất file chấm.
7. Làm nhập điểm, kiểm tra xung đột.
8. Làm màn hình GVHD rà soát per-student.
9. Làm xuất lại file nguồn.
10. Chạy build/test, sửa lỗi, cập nhật README và báo cáo những gì chưa hoàn thành.

**Definition of Done:** Không được tuyên bố MVP hoàn tất nếu ca kiểm thử end-to-end ở mục 11 chưa chạy thành công.
