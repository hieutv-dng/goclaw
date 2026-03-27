# Chuẩn bị Dự án mới (Project Setup) cho VNPT Dev Agent

Nếu bạn đưa AI này vào một **dự án hoàn toàn mới** (không phải dự án cũ đã được huấn luyện), bạn **KHÔNG BẮT BUỘC** phải có gì ghê gớm. AI vẫn chạy tốt với kiến thức có sẵn (Global Knowledge). 

Tuy nhiên, để AI code **"đúng ý" 100% như 1 thành viên gắn bó lâu năm** với dự án đó, dự án của bạn (VD: GoConnect) NÊN (nhưng không bắt buộc) chuẩn bị 3 file tài liệu mỏ neo sau:

---

## 🏗️ 3 File Tài liệu "Nhập môn" (Context Files)

Các file này nên được đặt ở thư mục gốc của dự án (hoặc thư mục `docs/` của dự án đó). AI sẽ tự động tìm quét và học thuộc lòng trước khi code.

### 1. `TEAM_CONTEXT.md` (Bộ não cốt lõi)
**Đây là file quan trọng nhất.** Nó chứa những luật bất thành văn (Tribal Knowledge) của team.
- **Nội dung:** 
  - Gọi API thì dùng thư viện nào? (Axios hay Fetch?)
  - Quản lý state dùng Ngrx hay BehaviorSubject?
  - Module/Component phải đặt tên theo chuẩn gì?
  - Dùng UI library nào? (Ant-Design hay Bootstrap?)
- **Khi nào dùng:** AI sẽ đọc file này để viết code không bị "lạc quẻ" so với code cũ của các member khác.

### 2. `GIT_STANDARD.md` (Chuẩn Git)
Chứa luật quản lý Git nhánh của team.
- **Nội dung:**
  - Tiêu đề commit (VD: `feat(ui): them nut bam` hay `[GoConnect-123] Thêm nút bấm`)
  - Quy ước đặt tên nhánh (VD: `feature/GOC-12` hay `feat_GOC-12`)
- **Khi nào dùng:** AI sẽ dựa vào file này trước khi tự động gọi lệnh tạo nhánh hoặc tạo PR.

### 3. `SECURITY_PATTERNS.md` (Chuẩn Bảo mật)
Chứa các yêu cầu nhạy cảm đối với dự án.
- **Nội dung:** Quy tắc mã hoá password, quy tắc xử lý cookie token, dữ liệu người dùng được lưu ở đâu...
- **Khi nào dùng:** Nếu bạn giao AI làm tính năng đăng nhập, thanh toán, chức năng quét bảo mật (Security Gate) của AI sẽ kiểm tra code dựa trên file này.

---

## 🔍 Tự động quét Docs (Auto-Discovery — MỚI!)

**Quan trọng:** Nếu dự án đã có bộ tài liệu riêng (ví dụ `docs/ARCHITECTURE.md`, `.gemini/workflows/`, `.cursor/rules/`, `API_STANDARDS.md`...) thì **KHÔNG CẦN** tạo lại 3 file ở trên. AI sẽ **tự quét** toàn bộ!

### Cách hoạt động:
1. Khi bạn chọn Track (Fast/Safe), AI tự gọi tool `scan_project_docs` để quét tất cả file `.md` và `.txt` trong dự án.
2. AI tự phân loại thành: 🔴 Quan trọng / 🟡 Hữu ích / ⚪ Tham khảo.
3. AI tự đọc các file 🔴 trước khi code.

### Các thư mục AI sẽ quét:
| Thư mục | Mô tả |
|---|---|
| `.` (root) | README, CONTRIBUTING, TEAM_CONTEXT... |
| `docs/` | Tài liệu chung |
| `.gemini/`, `.agent/`, `_agents/` | Workflows, rules của AI agents |
| `.cursor/`, `.cursor/rules/` | Cursor IDE rules |
| `rules/` | Project-specific rules |
| `.github/` | CI/CD, templates |

💡 **Kết luận:** Dự án có sẵn docs kiểu gì cũng được. AI đủ thông minh để tự tìm và đọc. Bạn chỉ cần code như bình thường!

---

## 🔋 Tính năng Nâng cao: Tự viết Plugin riêng (`.mcp-plugins/`)

Nếu dự án của bạn có những đặc thù siêu khó (VD: Dùng một công cụ nội bộ riêng biệt của công ty không có trên mạng internet), bạn có thể tạo thư mục `.mcp-plugins/` ngay trong project đó.
- Viết các Javascript/TypeScript file cung cấp công cụ nhỏ cho riêng dự án đó.
- Khởi động lại AI bằng công cụ `reload_plugins`, AI lập tức "học" được kỹ năng mới vừa thêm vào!

---
💡 **Lời khuyên cho người mới:** 
Kể cả khi bạn không có 3 file này, hãy cứ gọi `start` để AI làm việc thử. Sau mỗi lần làm xong, bạn dùng lệnh **`contribute_knowledge`** (Đóng góp kiến thức). AI sẽ thay bạn tự viết lại các rule này và để dành xài cho lần sau. Dần dần hệ thống sẽ "khôn" lên nhờ bạn!
