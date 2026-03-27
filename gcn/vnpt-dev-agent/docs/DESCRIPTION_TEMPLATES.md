# JIRA DESCRIPTION FORMAT — VNPT AI
# ─────────────────────────────────────────────
# Bộ format chuẩn cho 4 loại issue:
#   1. Task (tính năng mới)
#   2. Bug (sửa lỗi)
#   3. Story (user story lớn)
#   4. Sub-task (phân rã từ Task/Story)
#
# Nguyên tắc thiết kế:
#   - Machine-readable: section markers cố định
#   - Human-friendly: viết nhanh, không rườm rà
#   - Tool-optimized: mỗi section map 1:1 vào tool input
#   - AI_METADATA: bắt buộc với mọi type
#
# Lưu ý: Copy template phù hợp vào Jira Description
# ─────────────────────────────────────────────


══════════════════════════════════════════
  TEMPLATE 1: TASK (Tính năng mới)
══════════════════════════════════════════

## [WHY]
<!-- 1 câu — lý do nghiệp vụ, không phải mô tả kỹ thuật -->
<!-- VD: Cho phép user xem lịch sử giao dịch để đối soát -->
[Điền vào đây]

## [WHAT]
<!-- Mô tả cụ thể cần làm gì, input/output ra sao -->
[Điền vào đây]

## [WHERE]
<!-- Vị trí trong codebase — QUAN TRỌNG cho detect_files_from_task -->
- Module: `[VD: apps/portal/src/app/features/transaction]`
- Component: `[VD: TransactionHistoryComponent]`
- Service: `[VD: TransactionService]`
- API: `[VD: GET /api/v1/transactions]`

## [HOW]
<!-- Ràng buộc kỹ thuật — pattern cần follow -->
- [VD: Dùng OnPush change detection]
- [VD: Pagination theo chuẩn { page, limit, total }]
- [VD: Error handling qua ErrorHandlerService]

## [SCENARIOS]
<!-- GWT — tối thiểu 3 scenario: happy path, error, edge case -->

### Scenario 1: [Tên — happy path]
**Given** [trạng thái ban đầu]
**When**  [hành động]
**Then**  [kết quả cụ thể — mỗi kết quả 1 dòng]

### Scenario 2: [Tên — error case]
**Given** ...
**When**  ...
**Then**  ...

### Scenario 3: [Tên — edge case]
**Given** ...
**When**  ...
**Then**  ...

## [DONE_WHEN]
<!-- Checklist cụ thể, testable — AI dùng để tự verify -->
- [ ] [VD: Hiển thị đúng danh sách transaction với đầy đủ cột]
- [ ] [VD: Pagination hoạt động đúng]
- [ ] [VD: Empty state hiển thị khi không có data]
- [ ] [VD: Loading spinner trong lúc gọi API]
- [ ] [VD: Error message khi API fail]
- [ ] Unit test coverage >= 80%
- [ ] Không có lint warning

## [AI_METADATA]
<!-- Section này cho tools đọc — KHÔNG XÓA, điền đầy đủ -->
type: Task
feature_type: [form | list | detail | api-integration | navigation | dashboard | other]
tags: [VD: transaction, list, pagination]
sprint: [VD: Sprint 42]
estimated_complexity: [low | medium | high]
security_sensitive: [true | false]
related_issues: [VD: VNPTAI-100, VNPTAI-101]


══════════════════════════════════════════
  TEMPLATE 2: BUG
══════════════════════════════════════════

## [BUG_SUMMARY]
<!-- 1 câu mô tả bug ngắn gọn -->
[VD: Trang transaction bị crash khi filter theo ngày rỗng]

## [ENVIRONMENT]
- Browser: [VD: Chrome 122]
- OS: [VD: Windows 11]
- URL: [VD: /portal/transactions?from=&to=]
- User role: [VD: admin]

## [REPRODUCE]
<!-- Các bước tái hiện bug — càng cụ thể càng tốt -->
1. [VD: Vào trang /portal/transactions]
2. [VD: Xóa ngày trong filter "Từ ngày"]
3. [VD: Click "Tìm kiếm"]
4. [VD: Trang hiển thị lỗi trắng tinh]

## [EXPECTED]
<!-- Hành vi đúng phải là gì -->
[VD: Hiện thị validation "Vui lòng chọn ngày bắt đầu" và không gọi API]

## [ACTUAL]
<!-- Hành vi sai đang xảy ra -->
[VD: Console error: Cannot read property 'toISOString' of null. Trang crash.]

## [WHERE]
<!-- Nơi bug xảy ra trong code — nếu biết -->
- Component: `[VD: TransactionFilterComponent]`
- File: `[VD: apps/portal/src/app/features/transaction/filter/]`
- Function: `[VD: onSearch() — line 47]`

## [ROOT_CAUSE_HYPOTHESIS]
<!-- Phỏng đoán nguyên nhân — để AI phân tích -->
[VD: Thiếu null check cho dateFrom trước khi gọi .toISOString()]

## [FIX_APPROACH]
<!-- Hướng fix nếu đã biết, để trống nếu chưa rõ -->
[VD: Thêm validation check: if (!dateFrom) return showError(...)]

## [DONE_WHEN]
- [ ] Bug không còn tái hiện được
- [ ] Không có regression ở các filter case khác
- [ ] Thêm unit test cho null date case
- [ ] Console không có error

## [AI_METADATA]
type: Bug
tags: [VD: transaction, filter, null-check]
sprint: [VD: Sprint 42]
estimated_complexity: [low | medium | high]
security_sensitive: [false]
severity: [critical | high | medium | low]


══════════════════════════════════════════
  TEMPLATE 3: STORY (User Story)
══════════════════════════════════════════

## [USER_STORY]
<!-- Format chuẩn: Với tư cách là [role], tôi muốn [feature] để [benefit] -->
Với tư cách là **[role]**, tôi muốn **[feature]** để **[benefit]**.

## [BUSINESS_CONTEXT]
<!-- Context nghiệp vụ để AI hiểu BIG PICTURE -->
[VD: Chức năng báo cáo hiện tại chỉ export được PDF.
     User kế toán cần Excel để tiếp tục xử lý số liệu.
     Đây là pain point lớn nhất trong Q1 user survey.]

## [SCOPE]
<!-- Những gì IN SCOPE và OUT OF SCOPE rõ ràng -->
✅ In scope:
- [VD: Export Excel cho báo cáo giao dịch]
- [VD: Export Excel cho báo cáo tổng hợp tháng]

❌ Out of scope (dời sang Story khác):
- [VD: Scheduled export tự động]
- [VD: Email delivery]

## [ACCEPTANCE_CRITERIA]
<!-- High-level criteria — sub-tasks sẽ có GWT chi tiết hơn -->
1. [VD: User có thể export danh sách transaction ra .xlsx]
2. [VD: File Excel đúng format theo mẫu đã thống nhất]
3. [VD: Export không timeout với dataset <= 10,000 rows]
4. [VD: Permission: chỉ role "accountant" và "admin" mới export được]

## [DESIGN_REFERENCE]
<!-- Link Figma, mockup, hoặc mô tả UI nếu có -->
[VD: Figma: https://... | Mockup đính kèm | Dùng UI tương tự màn Transaction List]

## [TECHNICAL_NOTES]
<!-- Ghi chú kỹ thuật ở level Story -->
- Library đề xuất: [VD: xlsx hoặc exceljs]
- Cần confirm với team lead trước khi implement
- Liên quan đến: [VD: PermissionService, ReportService]

## [SUB_TASKS]
<!-- Phân rã thành sub-tasks — AI sẽ dùng create_issue để tạo -->
- [ ] [VNPTAI-XXX] Tạo ExportService với method exportToExcel()
- [ ] [VNPTAI-XXX] Thêm nút Export vào TransactionListComponent
- [ ] [VNPTAI-XXX] Implement permission check cho export feature
- [ ] [VNPTAI-XXX] Unit test ExportService

## [AI_METADATA]
type: Story
tags: [VD: export, excel, transaction, report]
sprint: [VD: Sprint 42]
estimated_complexity: high
security_sensitive: [true | false]
sub_task_count: 4


══════════════════════════════════════════
  TEMPLATE 4: SUB-TASK
══════════════════════════════════════════

## [PARENT]
Parent Story/Task: [VD: VNPTAI-150 — Export Excel cho báo cáo]

## [CONTEXT]
<!-- 2-3 câu tóm tắt context từ parent để AI không cần đọc parent -->
[VD: Đang implement chức năng export Excel cho báo cáo giao dịch.
     Sub-task này tập trung vào việc tạo ExportService,
     các sub-task khác sẽ xử lý UI và permission.]

## [WHAT]
<!-- Cụ thể sub-task này cần làm gì -->
[VD: Tạo ExportService có method exportTransactionsToExcel(filters)
     nhận vào filter params, gọi API, convert data, trả về Blob]

## [WHERE]
- File tạo mới: `[VD: libs/shared/src/lib/services/export.service.ts]`
- File liên quan: `[VD: libs/api/src/lib/transaction.api.ts]`
- Interface: `[VD: libs/shared/src/lib/models/export.model.ts]`

## [HOW]
- [VD: Dùng library xlsx (đã approved bởi team lead)]
- [VD: API endpoint: POST /api/v1/export/transactions]
- [VD: Response là ArrayBuffer, convert sang Blob trước khi return]
- [VD: Inject HttpClient qua constructor, không dùng trực tiếp]

## [SCENARIOS]
### Scenario 1: Export thành công
**Given** Có ít nhất 1 transaction thỏa filter
**When**  Gọi exportTransactionsToExcel({ from: '2026-01-01', to: '2026-03-31' })
**Then**  Trả về Blob với mimetype application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
          File có đúng các cột: STT, Ngày, Mô tả, Số tiền, Trạng thái

### Scenario 2: Không có data
**Given** Filter không có transaction nào
**When**  Gọi exportTransactionsToExcel(filters)
**Then**  Trả về Blob với file Excel chỉ có header row, không có data row
          KHÔNG throw error

### Scenario 3: API lỗi
**Given** API server trả về 500
**When**  Gọi exportTransactionsToExcel(filters)
**Then**  propagate error lên để caller xử lý
          KHÔNG swallow error im lặng

## [DONE_WHEN]
- [ ] ExportService được tạo đúng vị trí và inject được
- [ ] Method exportTransactionsToExcel() hoạt động đúng 3 scenarios
- [ ] Unit test coverage >= 80% cho ExportService
- [ ] Không có console.log hay TODO còn sót
- [ ] Export được từ `libs/shared` index.ts

## [AI_METADATA]
type: Sub-task
feature_type: api-integration
tags: [VD: export, excel, service]
sprint: [VD: Sprint 42]
estimated_complexity: medium
security_sensitive: false
parent_key: [VD: VNPTAI-150]