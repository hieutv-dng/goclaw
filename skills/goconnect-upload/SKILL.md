---
name: goconnect-upload
description: Use this skill when the user or agent needs to upload/send a file (image, video, PDF, document, etc.) to a GoConnect chat room. Handles the 3-step presigned URL upload flow. Server auto-classifies files as IMAGES / VIDEOS / FILES for correct rendering.
---

# GoConnect File Upload Guide

## Overview

GoConnect Chat Service uses a **3-step presigned URL flow** to upload files.
After commit, server **tự động phân loại** file thành 1 trong 3 loại dựa trên MIME type và extension:

| Loại | MIME / Extension | `chat_content_type` | Socket Event | Hiển thị |
|------|-----------------|---------------------|--------------|----------|
| **Ảnh** | `image/*` — jpg, jpeg, png, gif, heic, bmp, webp | `IMAGES` | `RoomIMGReceive` | Preview ảnh inline |
| **Video** | `video/*` — mp4, mpg, mpeg, mov, wmv, avi, mkv, webm, m4v | `VIDEOS` | `RoomFileReceive` | File video tải về |
| **File** | Còn lại — pdf, doc, xlsx, zip... | `FILES` | `RoomFileReceive` | File đính kèm tải về |

> **Quan trọng**: GoClaw chỉ cần gửi đúng `content_type` (MIME) trong file-init và file-commit.
> Server sẽ tự phân loại — không cần GoClaw chỉ định loại content type.

## Upload Flow

```
Step 1: POST /webhook/file-init   → Gửi metadata + first 256 bytes → Nhận presigned URL
Step 2: PUT  <presigned_url>       → Upload binary lên storage
Step 3: POST /webhook/file-commit  → Xác nhận → Tin nhắn hiển thị trong chat
```

## Quick Start (Python)

```bash
# Upload ảnh PNG — sẽ hiển thị preview ảnh inline
python3 {baseDir}/scripts/upload_file.py \
  --base-url "http://chat-service:3000" \
  --api-key "YOUR_API_KEY" \
  --room-id "ROOM_UUID" \
  --bot-user-id "BOT_UUID" \
  --bot-user-code "BOT_GO_CLAW_123" \
  --file "/path/to/screenshot.png" \
  --message "Screenshot kết quả"

# Upload video MP4 — sẽ hiển thị file video
python3 {baseDir}/scripts/upload_file.py \
  --file "/path/to/demo.mp4" \
  ... (các tham số khác giống trên)

# Upload file PDF — sẽ hiển thị file đính kèm
python3 {baseDir}/scripts/upload_file.py \
  --file "/path/to/report.pdf" \
  ... (các tham số khác giống trên)
```

## Step-by-Step (cURL)

### Step 1: File Init — Gửi metadata + initial chunk

Đọc 256 bytes đầu file, encode base64 gửi lên để server validate format:

```bash
INITIAL_CHUNK=$(head -c 256 myfile.png | base64 -w0)
FILE_SIZE=$(stat -c%s myfile.png)
MIME_TYPE="image/png"

curl -X POST "$BASE_URL/api/v1/chatservice/goclaw-connector/webhook/file-init" \
  -H "Content-Type: application/json" \
  -H "api-key: $API_KEY" \
  -d '{
    "room_id": "'$ROOM_ID'",
    "file_name": "myfile.png",
    "file_size": '$FILE_SIZE',
    "content_type": "'$MIME_TYPE'",
    "initial_chunk": "'$INITIAL_CHUNK'",
    "metadata": {
      "bot_user_id": "'$BOT_USER_ID'",
      "bot_user_code": "'$BOT_USER_CODE'"
    }
  }'
```

Response:
```json
{
  "success": true,
  "data": {
    "file_id": "uuid",
    "object_key": "chat_room/room-id/2026/03/uuid.png",
    "presigned_url": "https://storage.example.com/upload?token=...",
    "expires_at": 1711234567,
    "chat_content_id": "uuid",
    "content_type": "image/png"
  }
}
```

### Step 2: PUT — Upload binary lên presigned URL

```bash
curl -X PUT "$PRESIGNED_URL" \
  -H "Content-Type: $MIME_TYPE" \
  --data-binary @myfile.png
```

### Step 3: File Commit — Xác nhận upload

```bash
curl -X POST "$BASE_URL/api/v1/chatservice/goclaw-connector/webhook/file-commit" \
  -H "Content-Type: application/json" \
  -H "api-key: $API_KEY" \
  -d '{
    "room_id": "'$ROOM_ID'",
    "file_id": "'$FILE_ID'",
    "object_key": "'$OBJECT_KEY'",
    "expected_size": '$FILE_SIZE',
    "file_name": "myfile.png",
    "content_type": "'$MIME_TYPE'",
    "message": "Screenshot kết quả",
    "chat_content_id": "'$CHAT_CONTENT_ID'",
    "metadata": {
      "bot_user_id": "'$BOT_USER_ID'",
      "bot_user_code": "'$BOT_USER_CODE'"
    }
  }'
```

## Phân Loại Tự Động Theo Định Dạng

Server phân loại **tự động** dựa trên `content_type` (MIME) và extension file name.
GoClaw chỉ cần đảm bảo gửi đúng MIME type:

### Ảnh (IMAGES) — Hiển thị preview inline

```
Extensions: jpg, jpeg, png, gif, heic, bmp, webp
MIME:       image/png, image/jpeg, image/gif, image/webp, ...
→ chat_content_type = "IMAGES"
→ file_type = "IMAGE"
→ socket event = "RoomIMGReceive"
```

### Video (VIDEOS)

```
Extensions: mp4, mpg, mpeg, mov, wmv, avi, avchd, flv, f4v, mkv, webm, m4v
MIME:       video/mp4, video/quicktime, video/x-msvideo, ...
→ chat_content_type = "VIDEOS"
→ file_type = ".mp4" (extension)
→ socket event = "RoomFileReceive"
```

### File (FILES) — Mặc định

```
Extensions: pdf, doc, docx, xlsx, zip, txt, ...
MIME:       application/pdf, application/zip, ...
→ chat_content_type = "FILES"
→ file_type = ".pdf" (extension)
→ socket event = "RoomFileReceive"
```

## Supported File Types & Magic Bytes

| Type | MIME | Magic Bytes |
|------|------|-------------|
| PNG | image/png | `89 50 4E 47` |
| JPEG | image/jpeg | `FF D8 FF` |
| GIF | image/gif | `GIF87a` / `GIF89a` |
| WebP | image/webp | `52 49 46 46` + `57 45 42 50` |
| MP4 | video/mp4 | `66 74 79 70` (offset 4) |
| PDF | application/pdf | `%PDF` |
| ZIP | application/zip | `50 4B 03 04` |

## Error Handling

- **file-init returns `success: false`**: File format rejected. Check MIME type and initial_chunk.
- **PUT returns HTTP 4xx**: Presigned URL expired or invalid. Re-run file-init.
- **file-commit returns `success: false`**: Size mismatch or object_key invalid.

## Important Notes

- `content_type` (MIME) quyết định cách hiển thị — hãy gửi đúng MIME type
- `initial_chunk` là **base64-encoded** 256 bytes đầu — server dùng để validate file signature
- Presigned URLs hết hạn sau **5 phút** — upload ngay sau file-init
- `chat_content_id` từ file-init response **BẮT BUỘC** phải truyền lại cho file-commit
- Giới hạn dung lượng: tối đa 2GB (server config)
