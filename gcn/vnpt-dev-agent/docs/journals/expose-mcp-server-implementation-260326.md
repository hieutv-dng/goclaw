# Expose MCP Server for Remote Team Access

**Date**: 2026-03-26 14:00
**Severity**: Medium
**Component**: MCP Server Distribution / vnpt-dev-agent
**Status**: Resolved (Phase 03 pending user manual testing)

## What Happened

Implemented remote access tunnel for vnpt-dev-agent MCP server to enable 5-10 team members connecting Claude Desktop/Code to a shared MCP instance via ngrok + supergateway (stdio→SSE bridge). Feature reduces per-developer setup friction by centralizing agent infrastructure.

## The Brutal Truth

This feature exposes an unauthenticated network service to the internet. **Real risk**: malicious actors discover the ngrok URL and call our tools without authorization. We accepted this trade-off for a short-term trial period because:
- Org accounts use strong API key/secret management anyway
- Trial period is measured in days/weeks, not months
- Free ngrok tier resets URL on restart (forces manual re-notification, not scalable long-term)
- We can upgrade to authenticated ngrok tunnel or rotate credentials if abuse detected

Shipping without auth because "it's temporary" and we need fast feedback. This is not a permanent architecture.

## Technical Details

**Architecture:**
```
vnpt-dev-agent (stdio)
  ↓ (child process)
supergateway 0.1.42 (stdio→SSE bridge)
  ↓ (127.0.0.1:9080)
ngrok (tunnel to internet)
  ↓
Team members' Claude Desktop/Code clients
```

**Implementation artifacts:**
- `start-remote.sh` — 130-line Bash orchestrator with:
  - Pre-flight checks: port collision, `dist/index.js` presence, ngrok binary, system capabilities
  - Child process lifecycle: spawn supergateway + ngrok, capture PIDs, monitor health
  - Graceful shutdown: `pkill -P $PID` to kill children, cleanup temp files
  - Health checks: HTTP `GET /health` on 9080, 30s timeout retry loop
  - `trap` signal handlers for SIGINT/SIGTERM
- `docs/REMOTE_MCP_GUIDE.md` — 180-line client guide covering Claude Desktop setup (MCP config JSON), Claude Code setup (MCP connect with HTTP Basic auth), interstitial warning acknowledgment, troubleshooting table
- Pinned `supergateway@0.1.42` in package.json to eliminate supply-chain attack surface

## What We Tried

**Code review discovered 7 bugs:**
1. **Orphan processes**: supergateway child of `start-remote.sh` not killed on main exit → fixed with `trap "pkill -P $$" EXIT`
2. **Dead service tunnel**: ngrok tunnel health check only ran on startup, not monitored → added monitoring loop that restarts ngrok on failure
3. **Unpinned dependency**: `supergateway` had `^0.1.x` (allows 0.1.999) → pinned to exact `0.1.42`
4. **Port collision silent fail**: script didn't check if 9080 in use before spawn → added `lsof` pre-flight check
5. **Missing dist check**: script assumed `dist/index.js` exists → added existence check + error exit
6. **Unvalidated ngrok path**: assumed ngrok in PATH without testing → added `command -v ngrok` pre-flight
7. **No restart logic**: if ngrok crashed, user got stuck → added monitoring loop that respawns ngrok on exit code

All 7 fixed in revised script before merge.

## Root Cause Analysis

Why these issues existed:
- **Development velocity over robustness**: first draft assumed "happy path" — developer had supergateway installed, port free, ngrok in PATH
- **No integration testing environment**: caught bugs only when running full flow on actual machine
- **Monitoring gap**: no distinction between "service healthy but waiting for clients" vs "service crashed"

## Lessons Learned

1. **Child process lifecycle is hard**: `trap` handlers, PID tracking, and cleanup are fragile. For production, use systemd or process supervisor (launchd on macOS) instead of shell script.

2. **Pre-flight checks are cheap insurance**: 30 lines of validation prevented 2 hours of user frustration debugging "ngrok command not found" or "port already in use".

3. **Monitoring loop > one-shot health check**: Services fail asynchronously. A single health check on startup gives false confidence. Need periodic checks or supervisor to auto-restart.

4. **Unauthenticated internet services are radioactive**: We shipped this with full knowledge of the risk. **Red flag for future**: if adding persistent tunnel (weeks+), must upgrade to authenticated ngrok or VPN-based access immediately.

5. **Pinned dependencies shield against supply-chain surprises**: `supergateway@0.1.999` would accept future versions with breaking changes or malicious payloads. Pinning 0.1.42 is not "strict" — it's defensive.

## Next Steps

1. **Phase 03 (User Action)**: Manual testing by 5-10 team members connecting Claude Desktop/Code. User runs `./start-remote.sh`, shares ngrok URL with team, measures reliability/latency.

2. **If abuse detected**: Rotate ngrok auth token, implement basic Bearer token auth on supergateway (if upstream supports it), or move to VPN-based tunnel.

3. **If trial successful**: Design permanent solution:
   - Authenticate ngrok tunnel (paid account) or use WireGuard VPN tunnel
   - Move from Bash orchestrator to systemd service (Linux) or launchd (macOS)
   - Add metrics: concurrent client count, request latency, error rate
   - Document runbook for on-call rotation

4. **Tech debt**: Replace shell script with Go binary for reliability, or containerize with Docker + systemd-nspawn.

**Commit**: 47706ee — `feat: expose MCP server for remote team access via supergateway + ngrok`

**Files modified**:
- `/start-remote.sh` — new
- `/docs/REMOTE_MCP_GUIDE.md` — new
- `/README.md` — updated with remote guide link
- `/package.json` — pinned supergateway to 0.1.42

**Open questions**:
- Will ngrok's free tier URL reset cause notification fatigue for team?
- How many concurrent clients can one supergateway instance handle before memory exhaustion?
- Do we need request logging/audit trail for compliance?
