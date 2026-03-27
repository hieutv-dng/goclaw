# SECURITY PATTERNS — VNPT AI Angular Project
# ─────────────────────────────────────────────
# File này là checklist bảo mật cho AI khi generate code.
# AI sẽ đọc file này MỖI KHI task liên quan đến security.
#
# Cập nhật khi team phát hiện pattern nguy hiểm mới.
# ─────────────────────────────────────────────

## [AUTHENTICATION]
# Token & Session
- KHÔNG lưu access token trong localStorage → dễ bị XSS đánh cắp
- KHÔNG lưu refresh token trong localStorage → dùng httpOnly cookie
- KHÔNG log token ra console dù chỉ để debug
- KHÔNG truyền token qua URL query param → bị lưu vào browser history
- Dùng sessionStorage cho access token nếu không có httpOnly cookie
- Token phải có expiry, KHÔNG để token không có thời hạn

# Login flow
- Sau login thành công PHẢI clear form (xóa password khỏi DOM)
- KHÔNG show thông báo lỗi phân biệt "email không tồn tại" vs "sai password"
  → Dùng chung "Email hoặc mật khẩu không đúng" để tránh user enumeration
- Implement rate limiting feedback ở UI (thông báo sau N lần sai)

## [AUTHORIZATION]
- KHÔNG chỉ check permission ở UI (Angular route guard)
  → Backend PHẢI luôn check lại — UI check chỉ là UX, không phải security
- KHÔNG hardcode role/permission string trong component
  → Dùng enum hoặc constant từ shared lib
- KHÔNG lưu role/permission trong localStorage để check
  → Luôn lấy từ token hoặc API call

## [INPUT_VALIDATION]
# XSS Prevention
- KHÔNG dùng [innerHTML] với dữ liệu từ user hoặc API
  → Dùng Angular built-in binding {{ }} hoặc DomSanitizer nếu bắt buộc
- KHÔNG dùng bypassSecurityTrustHtml() trừ khi có review security
- KHÔNG dùng document.write() hoặc eval()
- Mọi rich text editor output PHẢI sanitize qua DomSanitizer

# SQL/NoSQL Injection (nếu có BFF layer)
- KHÔNG nối string để tạo query
- Dùng parameterized query hoặc ORM

## [API_SECURITY]
- KHÔNG gọi API mà không có auth header (trừ public endpoints)
- HTTP Interceptor phải xử lý 401 → clear session → redirect login
- KHÔNG retry request 401 quá 1 lần (tránh infinite loop)
- Timeout cho mọi HTTP call — KHÔNG để request chạy vô hạn
- KHÔNG expose API key hoặc secret trong Angular code (bị bundle ra client)

## [SENSITIVE_DATA]
# Data không được log
- Password, PIN, security question answer
- Full credit card number, CVV
- Access token, refresh token, API key
- CCCD/CMND, ngày sinh, địa chỉ nhà
- Số điện thoại (cân nhắc)

# Data không được lưu client-side
- Password (dù đã hash)
- Thông tin thanh toán
- Document nhạy cảm

## [ANGULAR_SPECIFIC]
- KHÔNG disable Content Security Policy (CSP)
- KHÔNG dùng ViewEncapsulation.None trừ khi hiểu rõ hệ quả
- KHÔNG dùng CUSTOM_ELEMENTS_SCHEMA để bypass template checking
  → Fix properly thay vì bypass
- Lazy load modules bảo mật (auth, admin) — không eager load
- Route guard PHẢI là async (canActivate trả về Observable/Promise)

## [COMMON_MISTAKES_IN_VNPT]
# Những lỗi hay gặp trong dự án
- [Điền vào khi phát hiện pattern nguy hiểm trong codebase]
- VD: "AuthGuard hiện tại không check token expiry — đang có PR fix"
- VD: "UserService.getCurrentUser() trả về cached data, có thể stale sau logout"

## [APPROVED_SECURITY_LIBRARIES]
# Chỉ dùng những thư viện này cho security-related code
- Angular built-in DomSanitizer (XSS)
- Angular built-in HttpClient (CSRF token tự động)
- jwt-decode (decode JWT, KHÔNG verify — verify ở backend)
- crypto-js (nếu cần encrypt ở client — cần review trước)
- KHÔNG tự implement crypto algorithm

## [LAST_UPDATED]
date: 2026-03-18
updated_by: [Tên bạn]