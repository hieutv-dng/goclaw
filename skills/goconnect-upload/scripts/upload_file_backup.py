#!/usr/bin/env python3
"""
GoConnect File Upload Script
Handles the 3-step presigned URL upload flow with initial chunk validation.

Usage:
    python3 upload_file.py \
        --base-url http://chat-service:3000 \
        --api-key YOUR_API_KEY \
        --room-id ROOM_UUID \
        --bot-user-id BOT_UUID \
        --bot-user-code BOT_GO_CLAW_123 \
        --file /path/to/document.pdf \
        --message "Optional caption"
"""

import argparse
import base64
import json
import mimetypes
import os
import sys
import urllib.request
import urllib.error

CHUNK_SIZE = 256  # bytes to read for format validation


def read_initial_chunk(file_path: str) -> str:
    """Read first 256 bytes of file and return as base64 string."""
    with open(file_path, "rb") as f:
        chunk = f.read(CHUNK_SIZE)
    return base64.b64encode(chunk).decode("ascii")


def detect_mime(file_path: str) -> str:
    """Detect MIME type from file extension, fallback to octet-stream."""
    mime, _ = mimetypes.guess_type(file_path)
    return mime or "application/octet-stream"


def api_call(url: str, api_key: str, payload: dict) -> dict:
    """POST JSON to GoConnect API with api-key auth."""
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("api-key", api_key)

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"ERROR: HTTP {e.code} from {url}: {body}", file=sys.stderr)
        sys.exit(1)


def put_file(presigned_url: str, file_path: str, mime_type: str):
    """PUT file binary to presigned URL."""
    file_size = os.path.getsize(file_path)
    with open(file_path, "rb") as f:
        req = urllib.request.Request(presigned_url, data=f.read(), method="PUT")
        req.add_header("Content-Type", mime_type)
        req.add_header("Content-Length", str(file_size))

        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                if resp.status >= 400:
                    print(f"ERROR: PUT returned HTTP {resp.status}", file=sys.stderr)
                    sys.exit(1)
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            print(f"ERROR: PUT HTTP {e.code}: {body}", file=sys.stderr)
            sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="Upload file to GoConnect chat room")
    parser.add_argument("--base-url", required=True, help="Chat Service base URL")
    parser.add_argument("--api-key", required=True, help="API license key")
    parser.add_argument("--room-id", required=True, help="GoConnect room UUID")
    parser.add_argument("--bot-user-id", required=True, help="Bot user UUID")
    parser.add_argument("--bot-user-code", required=True, help="Bot user code")
    parser.add_argument("--file", required=True, help="Path to file to upload")
    parser.add_argument("--message", default="", help="Optional caption/message")
    args = parser.parse_args()

    file_path: str = str(os.path.abspath(args.file))
    if not os.path.isfile(file_path):
        print(f"ERROR: File not found: {file_path}", file=sys.stderr)
        sys.exit(1)

    file_name = os.path.basename(file_path)
    file_size = os.path.getsize(file_path)
    mime_type = detect_mime(file_path)
    initial_chunk = read_initial_chunk(file_path)

    metadata = {
        "bot_user_id": args.bot_user_id,
        "bot_user_code": args.bot_user_code,
    }

    connector_base = f"{args.base_url.rstrip('/')}/api/v1/chatservice/goclaw-connector/webhook"

    # ── Step 1: file-init ──
    print(f"[1/3] file-init: {file_name} ({file_size} bytes, {mime_type})")
    init_resp = api_call(f"{connector_base}/file-init", args.api_key, {
        "room_id": args.room_id,
        "file_name": file_name,
        "file_size": file_size,
        "content_type": mime_type,
        "initial_chunk": initial_chunk,
        "metadata": metadata,
    })

    if not init_resp.get("success"):
        print(f"ERROR: file-init failed: {init_resp.get('message', 'unknown')}", file=sys.stderr)
        sys.exit(1)

    data = init_resp["data"]
    presigned_url = data["presigned_url"]
    file_id = data["file_id"]
    object_key = data["object_key"]
    chat_content_id = data["chat_content_id"]
    print(f"  ✓ file_id={file_id}")

    # ── Step 2: PUT binary ──
    print(f"[2/3] PUT binary to presigned URL...")
    put_file(presigned_url, file_path, mime_type)
    print(f"  ✓ uploaded {file_size} bytes")

    # ── Step 3: file-commit ──
    print(f"[3/3] file-commit...")
    commit_resp = api_call(f"{connector_base}/file-commit", args.api_key, {
        "room_id": args.room_id,
        "file_id": file_id,
        "object_key": object_key,
        "expected_size": file_size,
        "file_name": file_name,
        "content_type": mime_type,
        "message": args.message,
        "chat_content_id": chat_content_id,
        "metadata": metadata,
    })

    if not commit_resp.get("success"):
        print(f"ERROR: file-commit failed: {commit_resp.get('message', 'unknown')}", file=sys.stderr)
        sys.exit(1)

    print(f"  ✓ file committed successfully!")
    # Output JSON result for agent consumption
    result = {
        "success": True,
        "file_id": file_id,
        "file_name": file_name,
        "file_size": file_size,
        "mime_type": mime_type,
        "room_id": args.room_id,
    }
    print(json.dumps(result))


if __name__ == "__main__":
    main()
