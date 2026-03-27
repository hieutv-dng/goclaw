# Given/When/Then — Hướng dẫn viết Task Description cho AI

## Tại sao cần GWT?

| Viết tự nhiên | Viết GWT |
|---|---|
| "Thêm đăng nhập, validate, báo lỗi" | Given/When/Then cho từng tình huống cụ thể |
| AI đoán → sai 40-60% | AI hiểu chính xác → sai < 5% |
| Review mất 2-3 vòng | Review 1 lần là xong |

> **Quy tắc vàng:** Nếu 2 developer đọc description mà hiểu khác nhau → description chưa đủ tốt.

---

## Cấu trúc chuẩn — Full Template

```markdown
## [WHY]
<!-- 1 câu duy nhất — lý do NGHIỆP VỤ, không phải lý do kỹ thuật -->

## [WHAT]
<!-- Mô tả ngắn gọn cần làm gì -->

## [WHERE]
- Module: `apps/portal/src/app/features/<tên-feature>/`
- Component: `<TênComponent>`
- Service: `<TênService>`
- API: `<METHOD> /api/v1/<endpoint>`

## [HOW]
<!-- Pattern kỹ thuật cần tuân theo -->
- Dùng Reactive Forms (không Template-driven)
- Follow OnPush change detection
- Error handling qua ErrorHandlerService

## [SCENARIOS]

### Scenario 1: <Tên — Happy path>
**Given** <trạng thái ban đầu, dữ liệu đầu vào>
**When**  <hành động cụ thể xảy ra>
**Then**  <kết quả kỳ vọng — mỗi kết quả 1 dòng>
         <UI: vị trí, màu sắc, text cụ thể>
         <Data: lưu ở đâu, format gì>

### Scenario 2: <Tên — Error case>
**Given** ...
**When**  ...
**Then**  ...

### Scenario 3: <Tên — Edge case>
**Given** ...
**When**  ...
**Then**  ...

## [DONE_WHEN]
- [ ] Checklist item 1 — tiêu chí nghiệm thu cụ thể
- [ ] Checklist item 2
- [ ] Unit test coverage >= 80%
- [ ] Không có lint warning mới

## [AI_METADATA]
type: Task | Bug | Story | Sub-task
feature_type: form | list | detail | api-integration | navigation | dashboard
tags: [tag1, tag2]
sprint: Sprint XX
estimated_complexity: low | medium | high
security_sensitive: true | false
```

---

## Quy tắc viết GWT (Bắt buộc)

### ✅ Nên

| Quy tắc | Ví dụ tốt |
|---|---|
| `Then` phải **testable** | "Hiện toast màu xanh, text 'Thành công', tự đóng sau 3s" |
| Ghi rõ **API response** | "API trả 200, body: `{ data: { id: number } }`" |
| Ghi rõ **vị trí UI** | "Lỗi hiện dưới field email, không phải dưới form" |
| Ghi rõ **state** | "Button disabled trong lúc loading, hiện spinner" |
| Tối thiểu **3 scenarios** | Happy path + Error case + Edge case |

### ❌ Không nên

| Từ mơ hồ | Thay bằng |
|---|---|
| "hiển thị phù hợp" | "hiển thị text 'Xin chào, {tên}' ở góc phải header" |
| "validate đúng" | "email phải có @, tối thiểu 5 ký tự, tối đa 255" |
| "thông báo lỗi" | "toast màu đỏ, text 'Không thể kết nối', góc trên phải" |
| "tối ưu hiệu suất" | "lazy load module, giảm bundle size dưới 200KB" |
| "xử lý edge case" | Liệt kê từng edge case cụ thể thành Scenario riêng |

---

## Ví dụ thực tế — Trước và Sau

### ❌ TRƯỚC — Description mơ hồ

```
Thêm chức năng tìm kiếm user.
Có filter theo role và trạng thái.
Hiển thị kết quả dạng bảng, có phân trang.
```

**AI sẽ đoán sai:** Debounce bao lâu? Bảng có cột gì? Phân trang bao nhiêu items? Không có kết quả thì hiện gì?

---

### ✅ SAU — GWT chuẩn

```markdown
## [WHY]
Admin cần tìm kiếm user nhanh để xử lý yêu cầu hỗ trợ trong giờ cao điểm.

## [WHAT]
Trang tìm kiếm user với text search, filter dropdown, bảng kết quả có phân trang.

## [WHERE]
- Module: `apps/admin/src/app/features/user-management/`
- Component: `UserSearchComponent`
- Service: `UserService`
- API: `GET /api/v1/users?search=&role=&status=&page=&size=`

## [HOW]
- Debounce input 300ms trước khi gọi API
- Dùng nz-table (NG-ZORRO) cho bảng
- URL query params sync với filter state (back button giữ filter)

## [SCENARIOS]

### Scenario 1: Tìm kiếm thành công
**Given** Admin đang ở trang /admin/users
         Hệ thống có 150 users
**When**  Admin gõ "Nguyễn" vào ô tìm kiếm
**Then**  Sau 300ms debounce → gọi API GET /api/v1/users?search=Nguyễn&page=1&size=20
         Hiện spinner trên bảng trong lúc loading
         Bảng hiển thị tối đa 20 kết quả với các cột: STT | Họ tên | Email | Role | Trạng thái | Hành động
         Phân trang hiện ở dưới bảng: "Hiển thị 1-20 trên 35 kết quả"
         URL update thành /admin/users?search=Nguyễn

### Scenario 2: Không tìm thấy kết quả
**Given** Admin đang ở trang /admin/users
**When**  Admin gõ "xyzabc123" → API trả về data = []
**Then**  Bảng hiện empty state: icon tìm kiếm + text "Không tìm thấy user nào"
         KHÔNG hiện phân trang khi data trống
         Filter vẫn giữ nguyên giá trị đã chọn

### Scenario 3: Filter kết hợp
**Given** Admin đã tìm "Nguyễn" có 35 kết quả
**When**  Admin chọn filter Role = "Admin" VÀ Status = "Active"
**Then**  API gọi lại: GET /api/v1/users?search=Nguyễn&role=admin&status=active&page=1&size=20
         Kết quả thu hẹp, chỉ hiện user thỏa cả 3 điều kiện
         Có nút "Xóa bộ lọc" hiện ra khi có ít nhất 1 filter active

### Scenario 4: Lỗi API
**Given** Admin đang tìm kiếm
**When**  API trả về 500 hoặc timeout sau 10s
**Then**  Hiện toast đỏ: "Không thể tải dữ liệu. Vui lòng thử lại."
         Bảng giữ nguyên data cũ (nếu có), không xóa trắng
         Nút "Thử lại" hiện ở giữa bảng

### Scenario 5: Quay lại trang giữ filter
**Given** Admin đã filter: search="Nguyễn", role="Admin", page=2
**When**  Admin click vào 1 user → xem chi tiết → nhấn nút Back trình duyệt
**Then**  Trang /admin/users load lại đúng filter cũ từ URL query params
         Bảng hiện đúng page 2 của kết quả tìm "Nguyễn" + role "Admin"

## [DONE_WHEN]
- [ ] Tìm kiếm text có debounce 300ms
- [ ] Filter role + status hoạt động đúng
- [ ] Phân trang 20 items/page
- [ ] URL sync với filter state (back button giữ filter)
- [ ] Empty state khi không có kết quả
- [ ] Error handling khi API lỗi
- [ ] Unit test coverage >= 80%

## [AI_METADATA]
type: Task
feature_type: list
tags: [user-management, search, admin]
sprint: Sprint 42
estimated_complexity: medium
security_sensitive: false
```

---

## Template theo loại Task

### 🐛 Bug — Template rút gọn

```markdown
## [WHY]
<Mô tả impact lên user>

## [BUG_INFO]
- **Bước tái hiện:** 1. ... → 2. ... → 3. ...
- **Kết quả hiện tại:** <sai cái gì>
- **Kết quả mong muốn:** <đúng phải như thế nào>
- **Ảnh hưởng:** <bao nhiêu user, tần suất>

## [WHERE]
- File gây lỗi: `<path>`
- API liên quan: `<endpoint>`

## [SCENARIOS]
### Scenario 1: Reproduce bug
**Given** <điều kiện tái hiện>
**When**  <thao tác gây lỗi>
**Then**  <kết quả ĐÚNG sau khi fix>

## [DONE_WHEN]
- [ ] Bug không còn tái hiện
- [ ] Không gây regression ở chức năng liên quan
- [ ] Có unit test cover case gây bug
```

### 📖 Story — Template mở rộng

```markdown
## [WHY]
<User story: As a <role>, I want <goal>, so that <benefit>>

## [WHAT]
<Breakdown thành các đầu việc>

## [SCENARIOS]
<!-- Story thường cần 5-8 scenarios vì scope lớn hơn -->
### Scenario 1-N: ...

## [DONE_WHEN]
- [ ] Tất cả sub-tasks đã Done
- [ ] Integration test pass
- [ ] UX review approved
```

---

## Checklist trước khi giao AI

- [ ] Có ít nhất **1 happy path** scenario
- [ ] Có ít nhất **1 error case** scenario
- [ ] Có ít nhất **1 edge case** scenario
- [ ] Mỗi `Then` là hành vi **có thể test** được
- [ ] `Then` mô tả UI cụ thể: **màu sắc, vị trí, text**
- [ ] Có tên **file/module** cần sửa trong `[WHERE]`
- [ ] Có tên **API endpoint** nếu liên quan
- [ ] Có **request/response format** cho API
- [ ] **KHÔNG** dùng từ mơ hồ: "phù hợp", "đẹp", "tối ưu", "validate"
- [ ] `[DONE_WHEN]` có checklist rõ ràng

> **Không pass checklist? → Dùng tool `generate_gwt_description` để AI sinh giúp!**