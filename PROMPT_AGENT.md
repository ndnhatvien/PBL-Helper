# Prompt giao cho AI Coding Agent

Bạn là senior full-stack engineer được giao xây dựng ứng dụng **PBL Grading & Review** theo file `spec.md` trong repository hiện tại.

## Mục tiêu

Triển khai MVP chạy được end-to-end để điều phối một đợt chấm PBL: nhập nhiều file Excel, tạo nhóm sinh viên, gán GVHD, phân công giảng viên chấm tương đối đồng đều, xuất file chấm theo giảng viên, nhập file đã chấm, cho GVHD rà soát điểm theo từng sinh viên, rồi xuất lại các danh sách Excel nguồn với điểm đã cập nhật.

## Quy tắc nghiệp vụ không được vi phạm

1. GVHD visibility policy là `all_scores`: khi một GVHD thấy một nhóm có sinh viên mình phụ trách, GVHD được xem điểm của tất cả thành viên nhóm đó.
2. Advisor resolution policy là `both`: GVHD hiệu lực = GVHD override của sinh viên nếu có, nếu không thì dùng GVHD mặc định của nhóm.
3. Quyền xem và quyền rà soát khác nhau. GVHD chỉ được duyệt/yêu cầu kiểm tra sinh viên mà mình là GVHD hiệu lực.
4. Trạng thái rà soát phải lưu theo `studentKey`/`studentId`, tuyệt đối không lưu theo `groupId`.
5. Giảng viên chấm không mặc nhiên là GVHD.
6. Nhóm PBL là đơn vị phân công; không chia thành viên cùng nhóm cho nhiều giảng viên chấm.
7. Phải trả điểm về đúng file/sheet/dòng sinh viên nguồn bằng khóa ổn định, không ghép theo thứ tự dòng.
8. Không tự ý ghi đè điểm xung đột; phải hiển thị cho người dùng xác nhận.
9. Giữ nguyên file nguồn, xuất file mới.
10. UI bằng tiếng Việt. Không tuyên bố MVP local có xác thực/phân quyền an toàn.

## Cách làm việc bắt buộc

### Bước 1 — Khảo sát trước khi code
- Đọc toàn bộ `spec.md` và `README.md`.
- Kiểm tra cấu trúc repository, package manager, framework, scripts và test hiện có.
- Tìm và đọc các file Excel mẫu được cung cấp. Không giả định header/cột từ tên file.
- Tóm tắt ngắn kiến trúc hiện tại, tính năng đã có, phần thiếu và kế hoạch triển khai.
- Không xóa hay viết lại code đang hoạt động nếu không có lý do rõ ràng.

### Bước 2 — Thiết kế dữ liệu và logic dùng chung
- Tạo/chuẩn hóa TypeScript types cho batch, source workbook, student, group, member, lecturer, score, review và import report.
- Viết hàm thuần `getEffectiveAdvisor(studentOverrideId, groupDefaultAdvisorId)`.
- Viết hàm `canAdvisorReviewStudent(currentLecturerId, effectiveAdvisorId)`.
- Viết thuật toán phân công xác định được, ưu tiên cân bằng số sinh viên, sau đó số nhóm.
- Viết unit tests cho các hàm trên trước khi kết nối UI.
- Dùng `studentKey` ổn định được tạo khi nhập; MSSV là khóa dự phòng chỉ khi duy nhất trong batch.

### Bước 3 — Triển khai theo lát cắt end-to-end
Ưu tiên các lát cắt nhỏ nhưng hoàn chỉnh:
1. Nhập nhiều file Excel, chọn sheet, mapping cột, preview và validation.
2. Lưu metadata nguồn (file, sheet, dòng, dữ liệu gốc) và tạo danh sách sinh viên.
3. Tạo nhóm xuyên nhiều file nguồn; quản lý GVHD nhóm và override từng sinh viên.
4. Phân công nhóm cho giảng viên chấm, hiển thị workload, cho phép sửa thủ công.
5. Xuất một file Excel riêng cho mỗi giảng viên, có mã ổn định cho từng sinh viên.
6. Nhập file đã chấm với preview, validation và phát hiện xung đột trước khi commit.
7. GVHD review: hiển thị all_scores trong nhóm liên quan nhưng chỉ bật thao tác cho sinh viên mình phụ trách; trạng thái và ghi chú per-student.
8. Xuất một file cuối cho mỗi file nguồn, cập nhật đúng bản ghi sinh viên, giữ các cột và thứ tự dòng ban đầu.
9. Dashboard và hướng dẫn sử dụng.

### Bước 4 — Trải nghiệm và độ tin cậy
- UI rõ ràng, responsive, dùng tiếng Việt, phù hợp điều phối viên không chuyên kỹ thuật.
- Mọi import/update hàng loạt đều có preview và xác nhận.
- Thông báo lỗi phải nêu được file, sheet, dòng và lý do khi có thể.
- Không âm thầm bỏ dòng/cột lạ.
- Không âm thầm ghi đè điểm.
- Có dữ liệu demo riêng biệt, không trộn với dữ liệu người dùng.
- Nếu dùng localStorage/IndexedDB, giải thích rõ giới hạn dữ liệu cục bộ.
- Tách logic nghiệp vụ và xử lý Excel khỏi component giao diện.

### Bước 5 — Kiểm thử và hoàn tất
- Chạy test, lint và production build bằng scripts thực tế của repository.
- Sửa các lỗi do code mới tạo ra.
- Thêm test cho:
  - override GVHD thắng GVHD nhóm;
  - GVHD A chỉ review sinh viên có effective advisor A;
  - GVHD A vẫn xem được điểm sinh viên khác trong cùng nhóm;
  - review của từng sinh viên độc lập;
  - nhóm không bị chia khi phân công;
  - cân bằng workload;
  - nhập file trả về không phụ thuộc thứ tự dòng;
  - phát hiện duplicate/unknown/conflicting scores;
  - xuất điểm về đúng source workbook/sheet/row.
- Cập nhật README với cách cài đặt, chạy, test, build, giới hạn và hướng dẫn thao tác.
- Cuối cùng báo cáo: tính năng hoàn thành, file chính đã sửa/tạo, lệnh test/build và kết quả, các hạn chế còn lại.

## Quy tắc về backend và triển khai

- Ưu tiên local-first MVP nếu repository chưa có backend.
- Không thêm Supabase/Cloudflare/Vercel một cách máy móc nếu điều đó làm chậm luồng MVP.
- Nếu đã có backend, hãy giữ kiến trúc phù hợp và bổ sung RLS/auth trước khi dùng dữ liệu thật.
- Tuyệt đối không để Supabase service-role key hoặc secret trong frontend.
- Không dùng dữ liệu sinh viên thật trong demo, screenshot hoặc log.

## Definition of Done

Chỉ tuyên bố hoàn tất khi ca end-to-end sau chạy được:
- Hai file nguồn có sinh viên khác nhau.
- Tạo một nhóm PBL gồm sinh viên từ hai file.
- Gán GVHD nhóm A và override GVHD B cho một thành viên.
- Giao cả nhóm cho giảng viên chấm C.
- Xuất file cho C, nhập điểm mẫu đã chấm.
- GVHD A nhìn thấy điểm cả nhóm nhưng chỉ review sinh viên không bị override.
- GVHD B nhìn thấy điểm cả nhóm nhưng chỉ review sinh viên có override.
- Trạng thái review của hai sinh viên độc lập.
- Xuất lại đủ hai file nguồn và xác minh điểm về đúng sinh viên.

Hãy bắt đầu bằng Bước 1. Đọc repository và `spec.md`, sau đó tiếp tục thực hiện công việc trực tiếp trong codebase. Không chỉ đưa ra kế hoạch hoặc ví dụ minh họa; hãy thực sự triển khai, chạy kiểm thử và sửa lỗi trong phạm vi công cụ được cấp.
