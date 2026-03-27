# Remote MCP Server — Client Guide

Hướng dẫn kết nối Claude Desktop / Claude Code tới vnpt-dev-agent MCP server từ xa.

## Đăng ký ngrok (Free Tier)

> Chỉ admin (người host server) cần thực hiện phần này. Client chỉ cần nhận URL từ admin.

1. Truy cập [ngrok.com/signup](https://ngrok.com/signup) → đăng ký bằng email, GitHub hoặc Google
2. Sau khi đăng nhập, vào **Dashboard → Your Authtoken** → copy token
3. Cài ngrok CLI:
   - **macOS:** `brew install ngrok`
   - **Linux/Windows:** tải từ [ngrok.com/download](https://ngrok.com/download)
4. Kết nối authtoken:
   ```bash
   ngrok config add-authtoken <YOUR_TOKEN>
   ```

### Giới hạn Free Tier

| Giới hạn | Chi tiết |
|----------|----------|
| URL | Random mỗi lần restart — phải gửi lại URL mới cho team |
| Tunnel | 1 tunnel online cùng lúc |
| Connections | 40 connections/phút |
| Warning page | Lần đầu truy cập hiện trang "Visit Site" |

> **Lưu ý:** Với free tier, URL thay đổi mỗi lần restart ngrok. Nếu cần URL cố định, xem xét nâng cấp lên paid plan hoặc dùng `ngrok http --url=<reserved-domain>` (yêu cầu free static domain — đăng ký tại Dashboard → Domains).

## Prerequisites

- Admin đã đăng ký ngrok và chạy server (xem phần trên)
- Nhận **MCP URL** từ admin (dạng `https://xxx.ngrok-free.app/mcp`)
- Claude Desktop hoặc Claude Code đã cài đặt
- **QUAN TRỌNG:** Mỗi client cần mở URL gốc (không có `/mcp`) trong browser trước và click "Visit Site" để bypass ngrok warning. Sau đó MCP mới hoạt động.

## Claude Desktop

1. Nhận URL từ admin

2. Mở config file:
   - **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

3. Thêm/sửa config:
```json
{
  "mcpServers": {
    "vnpt-dev-agent": {
      "url": "https://xxx.ngrok-free.app/mcp"
    }
  }
}
```

4. Restart Claude Desktop

5. Kiểm tra: mở Claude Desktop → icon Tools → thấy "vnpt-dev-agent" tools

## Claude Code (CLI / IDE Extension)

### Cách 1: Streamable HTTP → stdio bridge (recommended)

Thêm vào project `.mcp.json` hoặc `~/.claude/settings.json`:
```json
{
  "mcpServers": {
    "vnpt-dev-agent": {
      "command": "npx",
      "args": ["-y", "supergateway@3.4.3", "--streamableHttp", "https://xxx.ngrok-free.app/mcp"]
    }
  }
}
```

### Cách 2: Direct URL (nếu Claude Code hỗ trợ Streamable HTTP trực tiếp)
```json
{
  "mcpServers": {
    "vnpt-dev-agent": {
      "url": "https://xxx.ngrok-free.app/mcp"
    }
  }
}
```

## Security Warnings

- URL **KHÔNG có authentication** — tuyệt đối không share ra ngoài team
- Server chạy với Jira PAT — ai có URL đều truy cập được Jira tools
- **Giới hạn 5-10 clients đồng thời** — vượt quá sẽ ảnh hưởng performance
- Chỉ dùng cho **thử nghiệm ngắn hạn** trong team

## Troubleshooting

| Vấn đề | Nguyên nhân | Giải pháp |
|---------|-------------|-----------|
| Connection refused | Server chưa chạy hoặc URL sai | Kiểm tra URL với admin, thử mở trong browser |
| 502 Bad Gateway | supergateway crash (SSE reconnect bug) | Admin restart `./start-remote.sh` |
| Tools không hiện | Config sai hoặc chưa restart | Kiểm tra JSON syntax, restart Claude Desktop |
| ngrok warning page | ngrok free tier hiện warning | Click "Visit Site" 1 lần, sau đó SSE hoạt động |
| URL thay đổi | Server restart (ngrok free = random URL) | Hỏi admin URL mới |
| Timeout/slow | Tunnel latency hoặc quá nhiều clients | Giảm số clients, kiểm tra network |

## Admin: Chạy Server

```bash
cd /path/to/vnpt-dev-agent
npm run build
./start-remote.sh        # default port 8000
./start-remote.sh 9000   # custom port
```

Script sẽ in ra URL và config mẫu — copy và gửi cho team.
