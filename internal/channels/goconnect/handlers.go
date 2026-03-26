package goconnect

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"

	"github.com/nextlevelbuilder/goclaw/internal/bus"
	"github.com/nextlevelbuilder/goclaw/internal/channels"
)

// ============================================================
// Inbound webhook payload from GoConnect Chat Service
// Sent when a user @mentions bot in a GoConnect room
// ============================================================

// inboundWebhookPayload is the JSON body sent by GoConnect Chat Service
// when a user message arrives that mentions a GoClaw bot.
// This is sent by GoClawConnectorService.checkAndForwardToGoClaw() → setImmediate.
type inboundWebhookPayload struct {
	// Core message fields
	RoomID             string `json:"room_id"`
	UserID             string `json:"user_id"`
	UserName           string `json:"user_name"`
	Message            string `json:"message"`
	MessageCreatedDate string `json:"message_created_date"` // ISO 8601 — used as messageID on GoConnect
	RoomType           string `json:"room_type"`            // "private" or "group"

	// Bot targeting
	BotUserID   string `json:"bot_user_id"`
	BotUserCode string `json:"bot_user_code"`

	// Optional context
	MentionedUserIDs []string `json:"mentioned_user_ids,omitempty"`
	RoomName         string   `json:"room_name,omitempty"`

	// Auth
	Token string `json:"token,omitempty"` // shared webhook secret
}

// inboundWebhookResponse is the standard response sent back to Chat Service.
type inboundWebhookResponse struct {
	Status  string `json:"status"`
	Message string `json:"message,omitempty"`
}

// handleWebhookHTTP processes inbound HTTP requests from GoConnect Chat Service.
// POST /hooks/goconnect
// Comparable to Telegram's long polling update handler but via HTTP webhook.
func (c *Channel) handleWebhookHTTP(w http.ResponseWriter, r *http.Request) {
	if !c.IsRunning() {
		writeJSON(w, http.StatusServiceUnavailable, inboundWebhookResponse{
			Status:  "error",
			Message: "goconnect channel not running",
		})
		return
	}

	// Read and parse body
	body, err := io.ReadAll(io.LimitReader(r.Body, 1024*1024)) // 1MB limit
	if err != nil {
		slog.Warn("goconnect: failed to read webhook body", "error", err)
		writeJSON(w, http.StatusBadRequest, inboundWebhookResponse{
			Status:  "error",
			Message: "failed to read request body",
		})
		return
	}

	var payload inboundWebhookPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		slog.Warn("goconnect: failed to parse webhook payload", "error", err)
		writeJSON(w, http.StatusBadRequest, inboundWebhookResponse{
			Status:  "error",
			Message: "invalid JSON payload",
		})
		return
	}

	// Validate webhook token (shared secret authentication)
	// Comparable to Telegram's bot token validation.
	token := payload.Token
	if token == "" {
		// Also check Authorization header
		if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") {
			token = strings.TrimPrefix(auth, "Bearer ")
		}
	}
	if c.webhookToken != "" && token != c.webhookToken {
		slog.Warn("goconnect: webhook token mismatch",
			"room_id", payload.RoomID,
			"remote_addr", r.RemoteAddr,
		)
		writeJSON(w, http.StatusUnauthorized, inboundWebhookResponse{
			Status:  "error",
			Message: "invalid webhook token",
		})
		return
	}

	// Validate required fields
	if payload.RoomID == "" || payload.UserID == "" || payload.Message == "" {
		writeJSON(w, http.StatusBadRequest, inboundWebhookResponse{
			Status:  "error",
			Message: "missing required fields: room_id, user_id, message",
		})
		return
	}

	// Process the message asynchronously (respond immediately to Chat Service)
	// Comparable to Telegram's spawning a handler goroutine per update.
	go c.handleInboundMessage(payload)

	writeJSON(w, http.StatusOK, inboundWebhookResponse{
		Status: "accepted",
	})
}

// handleInboundMessage processes an inbound message from GoConnect.
// Comparable to telegram.handleMessage() — includes:
//   - DM/Group policy checking
//   - Mention gating for group messages
//   - Sender annotation
//   - Group history context
//   - PublishInbound to MessageBus
func (c *Channel) handleInboundMessage(payload inboundWebhookPayload) {
	isGroup := payload.RoomType != "private"
	senderID := payload.UserID
	chatID := payload.RoomID
	content := payload.Message

	slog.Debug("goconnect message received",
		"room_id", chatID,
		"user_id", senderID,
		"user_name", payload.UserName,
		"is_group", isGroup,
		"room_type", payload.RoomType,
		"channel", c.Name(),
		"text_preview", channels.Truncate(content, 60),
	)

	// ── DM/Group policy checking (matching Telegram pattern) ──
	peerKind := "direct"
	if isGroup {
		peerKind = "group"
	}

	groupPolicy := c.config.GroupPolicy
	if groupPolicy == "" {
		groupPolicy = "open"
	}
	dmPolicy := c.config.DMPolicy
	if dmPolicy == "" {
		dmPolicy = "open" // GoConnect: default open (no pairing service)
	}

	if !c.CheckPolicy(peerKind, dmPolicy, groupPolicy, senderID) {
		slog.Debug("goconnect: message rejected by policy",
			"peer_kind", peerKind,
			"dm_policy", dmPolicy,
			"group_policy", groupPolicy,
			"sender_id", senderID,
		)
		return
	}

	// ── Group mention gating (matching Telegram requireMention pattern) ──
	localKey := chatID
	if isGroup && c.requireMention {
		// Chat Service already did @mention detection before forwarding.
		// The message was forwarded BECAUSE bot was mentioned.
		// So we accept all forwarded group messages.
		// But we still record non-mention history if available.
		slog.Debug("goconnect: group message accepted (forwarded by Chat Service mention gate)",
			"room_id", chatID,
			"sender", payload.UserName,
		)
	}

	// ── Build sender label (matching Telegram pattern) ──
	senderLabel := payload.UserName
	if senderLabel == "" {
		senderLabel = senderID
	}

	// ── Build final content with annotation ──
	finalContent := content
	if isGroup {
		// Annotate with sender name (same as Telegram: "[From: @username]\ncontent")
		annotated := fmt.Sprintf("[From: %s]\n%s", senderLabel, content)

		// Build group history context
		if c.historyLimit > 0 {
			finalContent = c.groupHistory.BuildContext(localKey, annotated, c.historyLimit)
		} else {
			finalContent = annotated
		}
	} else {
		finalContent = fmt.Sprintf("[From: %s]\n%s", senderLabel, content)
	}

	// ── Build metadata (matching Telegram metadata pattern) ──
	metadata := map[string]string{
		"room_id":              chatID,
		"user_id":              senderID,
		"user_name":            payload.UserName,
		"bot_user_id":          payload.BotUserID,
		"bot_user_code":        payload.BotUserCode,
		"is_group":             fmt.Sprintf("%t", isGroup),
		"local_key":            localKey,
		"message_created_date": payload.MessageCreatedDate,
	}
	if payload.RoomName != "" {
		metadata["room_name"] = payload.RoomName
	}
	// Pass created_date as reply_to so agent can reference it
	if payload.MessageCreatedDate != "" {
		metadata["reply_to_created_date"] = payload.MessageCreatedDate
	}

	// ── Collect contact (matching Telegram pattern) ──
	if cc := c.ContactCollector(); cc != nil {
		cc.EnsureContact(
			context.Background(),
			c.Type(), c.Name(),
			senderID, senderID,
			payload.UserName, "", // GoConnect doesn't have username distinct from display name
			peerKind,
		)
	}

	// ── Publish to MessageBus (matching Telegram pattern exactly) ──
	c.Bus().PublishInbound(bus.InboundMessage{
		Channel:      c.Name(),
		SenderID:     senderID,
		ChatID:       chatID,
		Content:      finalContent,
		PeerKind:     peerKind,
		UserID:       senderID,
		AgentID:      c.AgentID(),
		HistoryLimit: c.historyLimit,
		Metadata:     metadata,
	})

	// Clear pending history after sending to agent (matching Telegram pattern).
	if isGroup {
		c.groupHistory.Clear(localKey)
	}

	slog.Info("goconnect: inbound message published",
		"room_id", chatID,
		"sender", senderLabel,
		"channel", c.Name(),
		"content_preview", channels.Truncate(content, 50),
	)
}

// ============================================================
// HTTP helpers
// ============================================================

// writeJSON writes a JSON response with the given status code.
func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
