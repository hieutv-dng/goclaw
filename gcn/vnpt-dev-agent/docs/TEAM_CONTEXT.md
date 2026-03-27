# TEAM CONTEXT — VNPT AI
# ─────────────────────────────────────────────
# File này là "bộ nhớ dài hạn" của team.
# Mọi kiến thức KHÔNG được viết trong code,
# Jira, hay README đều thuộc về đây.
#
# Cách dùng:
#   - Điền vào TRƯỚC khi bắt đầu dùng AI
#   - Cập nhật MỖI KHI phát hiện tribal knowledge mới
#   - Review lại mỗi sprint
#
# AI sẽ đọc file này TRƯỚC KHI làm bất kỳ task nào.
# ─────────────────────────────────────────────

## [PROJECT]
name: VNPT AI Portal
type: Angular Monorepo
main_app: apps/portal
libs_folder: libs/
angular_version: 17
node_version: 20
package_manager: npm

## [ARCHITECTURE]
# Mô tả kiến trúc tổng thể — AI cần hiểu big picture
- Monorepo gồm nhiều apps, shared logic để trong libs/
- Mỗi feature là 1 module lazy-loaded riêng
- State management dùng [NgRx / Akita / Signal Store — điền vào]
- API communication chỉ qua services trong libs/api/
- Authentication dùng [JWT / OAuth2 / SSO — điền vào]

## [SERVICE_RULES]
# Quy tắc về service layer — AI hay bị sai ở đây nhất
- KHÔNG gọi trực tiếp HttpClient trong component, PHẢI qua service
- KHÔNG tạo service mới nếu đã có service tương tự trong libs/
- [VD: Đừng gọi UserService trực tiếp, phải qua UserFacadeService vì có cache layer]
- [VD: AuthService.getToken() đã deprecated, dùng TokenService.getAccessToken()]
- [Thêm rule của team bạn vào đây]

## [API_GOTCHAS]
# Những quirk của API backend mà AI không thể biết
- Base URL production: [điền vào], staging: [điền vào]
- Tất cả response đều wrap trong { data, message, statusCode }
- Pagination dùng { page, limit, total } KHÔNG phải { offset, count }
- Date format luôn là ISO 8601 UTC
- [VD: GET /users đang có bug race condition, tạm dùng /users/v2]
- [VD: API /reports timeout nếu date range > 90 ngày, cần paginate]
- [Thêm gotcha của API bạn vào đây]

## [FORBIDDEN_PATTERNS]
# Code patterns TUYỆT ĐỐI không được dùng
- KHÔNG dùng `any` type trừ khi có comment giải thích lý do
- KHÔNG subscribe trong constructor, dùng ngOnInit
- KHÔNG dùng ElementRef.nativeElement trực tiếp, wrap trong service
- KHÔNG hardcode string, dùng enum hoặc constant file
- KHÔNG dùng setInterval/setTimeout, dùng RxJS timer/interval
- [Thêm forbidden patterns của team bạn vào đây]

## [PREFERRED_PATTERNS]
# Patterns team đang dùng — AI phải follow
- Error handling: dùng catchError + ErrorHandlerService, không try/catch
- Loading state: dùng BehaviorSubject<boolean>, không boolean đơn
- Form: ReactiveFormsModule, KHÔNG dùng Template-driven
- Routing: lazy load tất cả feature modules
- HTTP interceptor xử lý auth header tự động — không cần set thủ công
- [Thêm preferred patterns của team bạn vào đây]

## [NAMING_CONVENTIONS]
# Ngoài Angular style guide — những convention riêng của team
- File: kebab-case, VD: user-profile.component.ts
- Interface prefix I: IUser, IApiResponse
- Enum suffix E: UserStatusE, RoleTypeE
- Service suffix Service: UserService, AuthService
- Store suffix Store: UserStore, AuthStore (nếu dùng Akita)
- Constant file: [feature].constants.ts
- [Thêm conventions của team bạn vào đây]

## [KNOWN_ISSUES]
# Bug/issue đang tồn tại — AI không được "fix" những thứ này
# vì team đang có plan riêng
- [VD: UserProfileComponent có memory leak nhỏ, đang chờ PR #234 fix]
- [VD: DatePickerComponent không support timezone, planned for Q2]
- [Thêm known issues của team bạn vào đây]

## [TEMPORARY_WORKAROUNDS]
# Những đoạn code "xấu" nhưng CỐ TÌNH — AI không được refactor
- [VD: libs/utils/date.ts line 45 dùng any vì moment.js chưa có type]
- [VD: AuthGuard đang check hardcode role 'admin' vì API chưa ready]
- [Thêm workarounds của team bạn vào đây]

## [SECURITY_RULES]
# Quy tắc bảo mật — KHÔNG được phép vi phạm
- KHÔNG log sensitive data (token, password, PII) ra console
- KHÔNG store token trong localStorage, dùng sessionStorage hoặc memory
- KHÔNG disable CORS hoặc CSP dù chỉ để test
- Mọi input từ user PHẢI sanitize trước khi render HTML
- [Thêm security rules của team bạn vào đây]

## [TESTING_RULES]
# Quy tắc viết test
- Coverage tối thiểu: 80% cho mọi service mới
- Mock HTTP bằng HttpClientTestingModule
- Test file đặt cùng folder với source file
- Test name format: "should [do something] when [condition]"
- [Thêm testing rules của team bạn vào đây]

## [DEPENDENCIES]
# Thư viện đang dùng — AI không được tự ý thêm thư viện mới
ui_library: [PrimeNG / Angular Material / Ant Design — điền vào]
icon_library: [PrimeIcons / Material Icons — điền vào]
chart_library: [Chart.js / ECharts / D3 — điền vào]
date_library: [date-fns / dayjs / luxon — điền vào]
http_client: Angular HttpClient (KHÔNG dùng axios trong Angular)
# Nếu cần thêm thư viện mới → hỏi team lead trước

## [TEAM_GLOSSARY]
# Thuật ngữ nội bộ — AI cần hiểu đúng nghĩa
# [VD: "BO" = Back Office portal, khác với "portal" là user-facing app]
# [VD: "ticket" trong context này là support ticket, không phải Jira ticket]
# [VD: "sync" nghĩa là đồng bộ dữ liệu với hệ thống legacy VNPT]
# [Thêm glossary của team bạn vào đây]

## [LAST_UPDATED]
date: 2026-03-18
updated_by: [Tên bạn]
version: 1.0.0