---
name: goconnect-upload
description: Use this skill when the user or agent needs to upload/send a file (image, PDF, document, etc.) to a GoConnect chat room. Handles the 3-step presigned URL upload flow with file format validation via initial chunk inspection.
---

# GoConnect File Upload Guide

## Overview

GoConnect Chat Service uses a **3-step presigned URL flow** to upload files. This is required because GoConnect validates the file format by inspecting the first 256 bytes (magic bytes / file signature) before granting upload permission.

## Upload Flow

```
Step 1: POST /webhook/file-init   → Send file metadata + first 256 bytes → Get presigned URL
Step 2: PUT  <presigned_url>       → Upload full binary to storage
Step 3: POST /webhook/file-commit  → Confirm upload → Message appears in chat
```

## Quick Start (Python)

```bash
python3 {baseDir}/scripts/upload_file.py \
  --base-url "http://chat-service:3000" \
  --api-key "YOUR_API_KEY" \
  --room-id "ROOM_UUID" \
  --bot-user-id "BOT_UUID" \
  --bot-user-code "BOT_GO_CLAW_123" \
  --file "/path/to/document.pdf" \
  --message "Here is the report"
```

## Step-by-Step (cURL)

### Step 1: File Init — Send metadata + initial chunk for validation

Read the first 256 bytes of the file and encode as base64:

```bash
INITIAL_CHUNK=$(head -c 256 myfile.pdf | base64 -w0)
FILE_SIZE=$(stat -c%s myfile.pdf)
MIME_TYPE="application/pdf"

curl -X POST "$BASE_URL/api/v1/chatservice/goclaw-connector/webhook/file-init" \
  -H "Content-Type: application/json" \
  -H "api-key: $API_KEY" \
  -d '{
    "room_id": "'$ROOM_ID'",
    "file_name": "myfile.pdf",
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
    "object_key": "storage/path/key",
    "presigned_url": "https://storage.example.com/upload?token=...",
    "expires_at": 1711234567,
    "chat_content_id": "uuid",
    "content_type": "application/pdf"
  }
}
```

### Step 2: PUT — Upload binary to presigned URL

```bash
curl -X PUT "$PRESIGNED_URL" \
  -H "Content-Type: $MIME_TYPE" \
  --data-binary @myfile.pdf
```

### Step 3: File Commit — Confirm upload

```bash
curl -X POST "$BASE_URL/api/v1/chatservice/goclaw-connector/webhook/file-commit" \
  -H "Content-Type: application/json" \
  -H "api-key: $API_KEY" \
  -d '{
    "room_id": "'$ROOM_ID'",
    "file_id": "'$FILE_ID'",
    "object_key": "'$OBJECT_KEY'",
    "expected_size": '$FILE_SIZE',
    "file_name": "myfile.pdf",
    "content_type": "'$MIME_TYPE'",
    "message": "Here is the document",
    "chat_content_id": "'$CHAT_CONTENT_ID'",
    "metadata": {
      "bot_user_id": "'$BOT_USER_ID'",
      "bot_user_code": "'$BOT_USER_CODE'"
    }
  }'
```

## Supported File Types

| Type | MIME | Magic Bytes |
|------|------|-------------|
| PDF | application/pdf | `%PDF` |
| PNG | image/png | `89 50 4E 47` |
| JPEG | image/jpeg | `FF D8 FF` |
| GIF | image/gif | `GIF87a` / `GIF89a` |
| ZIP | application/zip | `50 4B 03 04` |
| MP4 | video/mp4 | `66 74 79 70` (after 4 byte offset) |

## Error Handling

- **file-init returns `success: false`**: File format rejected. Check MIME type and initial_chunk.
- **PUT returns HTTP 4xx**: Presigned URL expired or invalid. Re-run file-init.
- **file-commit returns `success: false`**: Size mismatch or object_key invalid.

## Important Notes

- `initial_chunk` is **base64-encoded** first 256 bytes — server uses this to validate file signature
- Presigned URLs typically expire in **5 minutes** — upload promptly after file-init
- `chat_content_id` from file-init response MUST be passed to file-commit
- Maximum file size depends on GoConnect server configuration (typically 50MB)
