# VNPT Dev Agent — Quickstart Guide 🚀

Chào mừng bạn đến với **VNPT Dev Agent** (MCP Server)! 

Nếu bạn là Developer mới tinh vào dự án (ví dụ: dự án GoConnect) và không biết làm thế nào để AI tự động code giúp bạn, hãy làm theo đúng **3 bước cực kỳ đơn giản** dưới đây.

---

## 🏎️ Workflow 1-click (Dành cho Dev mới)

Với luồng này, bạn KHÔNG cần biết tên các công cụ phức tạp ẩn bên dưới. AI sẽ dẫn dắt bạn từ đầu đến cuối chỉ bằng những lựa chọn [1], [2], [3].

### Bước 1: Khởi động 
Bạn chỉ cần mở Claude (hoặc IDE tích hợp MCP) và nói:
> _"Bắt đầu làm việc (dùng prompt `start`)"_ hoặc _"Sử dụng prompt `start`"_

### Bước 2: Chọn Task & Track (Đường đua)
1. AI sẽ quét và tự động liệt kê **Danh sách các Task** (Open Issues) đang được gán (assign) cho bạn.
2. AI sẽ hỏi bạn muốn làm task số mấy (gõ số `1`, `2`...).
3. Tiếp theo, AI sẽ phân tích nhanh Task đó và hỏi bạn muốn chọn "Đường đua" (Track) nào: 
    *   **[1] Fast Track (Code ngay):** AI tự bắt bệnh, tự tạo nhánh git mới, tự generate & sửa code, và chỉ dừng lại để bạn duyệt rước khi tạo PR. _(Dành cho task nhỏ/rõ ràng)._
    *   **[2] Safe Track (Chỉ phân tích):** AI đọc codebase hiện tại, quét ảnh hưởng (impact), check rủi ro bảo mật và lên 1 bản Kế hoạch chi tiết. _(Dành cho task to, khó)._
    *   **[3] Scaffold Track (Template):** AI chỉ tự động cắm các file boilerplate (component, service) rỗng để bạn tự lo phần logic.

### Bước 3: Duyệt và Phê Chuẩn
Dựa trên Track bạn đã chọn, AI sẽ chạy chế độ **Auto-Execute**. Bạn chỉ cần:
- Ngồi xem AI tự tìm file, tự đọc docs, tự tạo nhánh.
- **Tại điểm nghẽn an toàn (Safe checkpoints):** AI sẽ dừng lại. Ví dụ: Trước khi chèn code thật vào file, hoặc trước khi gõ lệnh `git commit`. 
- Bạn chỉ cần nói _"Đồng ý"_ hoặc _"Sửa dòng này cho tao"_.
- Toàn bộ thời gian làm việc (logwork), chuyển trạng thái Jira (In Progress -> Done) sẽ do AI tự lo.

---

## 🛠️ Trải nghiệm Nâng cao (Dành cho Senior)

Nếu bạn không muốn AI tự động mọi thứ (vì auto có thể thiếu chính xác với nghiệp vụ dị), bạn có thể gọi trực tiếp các lệnh prompt sau:

- **`implement-task`**: Nếu bạn đã biết rõ Issue Key muốn làm (VD: _"Dùng prompt `implement-task` cho mã GOCONNECT-1261"_).
- **`review-code`**: Kêu AI review lại nhánh code hiện tại theo đúng chuẩn của team.
- **`close-task`**: Để AI tự động log giờ làm việc và báo cáo kết quả lên Jira sau khi bạn code tay xong.

---
_Thế thôi! Đừng lo lắng về các file phức tạp trong ruột. Hãy quay lại Claude và gõ lệnh **"dùng prompt start"** ngay bây giờ!_
