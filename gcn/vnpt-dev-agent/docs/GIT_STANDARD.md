# Lab 03: QUY TRÌNH GIT & GITFLOW CHUẨN

Để code không bị "đè" lên nhau và dễ dàng quản lý lỗi, chúng ta sẽ tuân thủ quy trình **Gitflow**. Đừng lo, nó đơn giản hơn bạn nghĩ!

---

## 1. Hiểu về các nhánh (Branches)

Tưởng tượng project là một cái cây:

### 🌳 1. Nhánh `main` (Master)

Đây là thân cây chính. Code ở đây là code **ĐANG CHẠY TRÊN PRODUCTION**. Tuyệt đối không được push code thẳng vào đây.

### 🌿 2. Nhánh `develop`

Đây là các cành cây lớn. Code mới nhất của tất cả mọi người sẽ được gộp vào đây. Trước khi làm tính năng mới, bạn phải xuất phát từ đây.

### 🍃 3. Nhánh `feature/...`

Đây là các lá cây, nơi bạn làm việc. Mỗi tính năng mới sẽ là một nhánh feature riêng (ví dụ: `feature/login`, `feature/checkout`). Làm xong thì merge vào `develop` và xóa nhánh này đi.

---

## 2. Quy tắc đặt tên Branch

Công thức: `loại-nhánh/tên-tính-năng`

- ✨ Tính năng mới: `feature/auth-login`
- 🐛 Sửa lỗi: `fix/user-cannot-register`
- 📚 Tài liệu: `docs/update-readme`

---

## 3. Quy tắc đặt tên Commit (Conventional Commits)

Đừng commit kiểu "fix lỗi", "update", "abc". Hãy viết có tâm:

```
<loại>(<phạm-vi>): <mô tả ngắn>
```

| Loại       | Ý nghĩa                         | Ví dụ                                        |
| ---------- | -------------------------------- | -------------------------------------------- |
| `feat`     | Tính năng mới                    | `feat(user): add login api`                  |
| `fix`      | Sửa lỗi                         | `fix(auth): fix token expiration issue`      |
| `docs`     | Thêm tài liệu                   | `docs: update setting instruction`           |
| `refactor` | Sửa code cho gọn, không đổi logic | `refactor(core): cleanup unused code`        |

---

## 4. Thực hành: Quy trình làm việc chuẩn (Step-by-step)

Hãy làm theo từng bước dưới đây để tạo một tính năng mới:

### Bước 1: Cập nhật code mới nhất từ `develop`

```bash
# Chuyển về nhánh develop
git checkout develop

# Kéo code mới nhất về máy
git pull origin develop
```

### Bước 2: Tạo branch mới cho tính năng của bạn

Ví dụ bạn làm task số 03 trong Jira/GitLab.

```bash
git checkout -b feature/issue-03-setup-project
```

### Bước 3: Code và Commit

Sau khi sửa file xong:

```bash
# 1. Kiểm tra xem mình đã sửa những file nào
git status

# 2. Add các file muốn lưu
git add .

# 3. Commit với nội dung chuẩn
git commit -m "feat(core): setup initial project structure"
```

### Bước 4: Đẩy code lên Server (Push)

```bash
git push origin feature/issue-03-setup-project
```

### Bước 5: Tạo Merge Request (MR)

- Truy cập vào trang GitLab/GitHub của dự án.
- Bạn sẽ thấy nút **"Create Merge Request"** hiện ra.
- Chọn Source branch: `feature/issue-03...`
- Chọn Target branch: `develop` (**TUYỆT ĐỐI KHÔNG CHỌN MAIN**).
- Bấm Submit và gửi link cho Mentor review.

> [!TIP]
> 💡 **Mẹo:** Nếu có conflict (xung đột code), hãy gọi Mentor hoặc Senior hỗ trợ, đừng tự ý resolve nếu không chắc chắn!

---

## ✅ DEFINITION OF DONE (Tiêu chí hoàn thành)

- [ ] Đã tạo branch đúng tên: `feature/issue-xx-ten-task`.
- [ ] Commit message có prefix (`feat`, `fix`).
- [ ] Đã Push code lên server thành công.
- [ ] Đã tạo Merge Request vào nhánh `develop`.
- [ ] Không có code thừa/file rác (check kỹ bằng `git status` trước khi add).

---

> *Bản quyền © thuộc về Trung tâm Nền tảng AI - Miền Nam 2026*
