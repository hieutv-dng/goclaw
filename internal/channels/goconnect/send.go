package goconnect

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/nextlevelbuilder/goclaw/internal/bus"
	"github.com/nextlevelbuilder/goclaw/internal/channels"
)

// ============================================================
// Outbound API request/response types
// Mapping tới goclaw-connector NestJS endpoints
// ============================================================

// webhookResponsePayload maps to WebhookResponseDto in goclaw-connector.
type webhookResponsePayload struct {
	Type               string          `json:"type"`
	Text               string          `json:"text"`
	ReplyToCreatedDate string          `json:"reply_to_created_date,omitempty"`
	Metadata           webhookMetadata `json:"metadata"`
}

// webhookActionPayload maps to WebhookActionDto in goclaw-connector.
type webhookActionPayload struct {
	Action            string          `json:"action"`
	Emoji             string          `json:"emoji,omitempty"`
	Text              string          `json:"text,omitempty"`
	TargetCreatedDate string          `json:"target_created_date"`
	Metadata          webhookMetadata `json:"metadata"`
}

// webhookMetadata maps to GoClawMetadataDto in goclaw-connector.
type webhookMetadata struct {
	RoomID      string `json:"room_id"`
	BotUserID   string `json:"bot_user_id"`
	BotUserCode string `json:"bot_user_code"`
}

// webhookAPIResponse is the standard response from goclaw-connector endpoints.
type webhookAPIResponse struct {
	Success bool            `json:"success"`
	Data    json.RawMessage `json:"data,omitempty"`
	Message string          `json:"message,omitempty"`
}

// Send delivers an outbound message to GoConnect Chat Service.
// Comparable to telegram.Channel.Send() but simpler:
//   - No placeholder/stream editing (GoConnect doesn't support draft messages)
//   - Text → POST /api/v1/chatservice/goclaw-connector/webhook/response
//   - Media → TODO: POST /api/v1/chatservice/goclaw-connector/webhook/file-init + PUT + POST /webhook/file-commit
//
// Reads metadata for routing:
//   - "room_id": GoConnect room UUID
//   - "bot_user_id": Bot user UUID
//   - "bot_user_code": Bot user code convention
//   - "reply_to_created_date": ISO 8601 created_date for reply-to
func (c *Channel) Send(ctx context.Context, msg bus.OutboundMessage) error {
	if !c.IsRunning() {
		return fmt.Errorf("goconnect channel not running")
	}

	roomID := msg.ChatID
	if roomID == "" {
		return fmt.Errorf("goconnect: missing room_id (ChatID)")
	}

	// Resolve bot identity from metadata (per-request override) or channel config
	botUserID := c.botUserID
	botUserCode := c.botUserCode
	if v := msg.Metadata["bot_user_id"]; v != "" {
		botUserID = v
	}
	if v := msg.Metadata["bot_user_code"]; v != "" {
		botUserCode = v
	}

	meta := webhookMetadata{
		RoomID:      roomID,
		BotUserID:   botUserID,
		BotUserCode: botUserCode,
	}

	// NO_REPLY cleanup: content is empty when agent suppresses reply.
	// Comparable to Telegram's NO_REPLY handling.
	if msg.Content == "" && len(msg.Media) == 0 {
		slog.Debug("goconnect: empty outbound message, skipping", "room_id", roomID)
		return nil
	}

	// Handle media attachments if present
	if len(msg.Media) > 0 {
		return c.sendMediaMessage(ctx, msg, meta)
	}

	// Text-only message
	return c.sendTextMessage(ctx, msg.Content, meta, msg.Metadata)
}

// sendTextMessage sends a text message via GoConnect Chat Service.
// POST /api/v1/chatservice/goclaw-connector/webhook/response
// Comparable to telegram.sendHTML() but sends plain text (GoConnect handles formatting).
func (c *Channel) sendTextMessage(ctx context.Context, content string, meta webhookMetadata, msgMeta map[string]string) error {
	// Convert GoClaw markdown to GoConnect compatible text
	text := markdownToGoConnect(content)

	// Split long messages (GoConnect has 5000 char limit per WebhookResponseDto)
	chunks := chunkText(text, 5000)

	for i, chunk := range chunks {
		payload := webhookResponsePayload{
			Type: "text",
			Text: chunk,
			Metadata: meta,
		}

		// Only first chunk carries reply-to
		if i == 0 {
			if v := msgMeta["reply_to_created_date"]; v != "" {
				payload.ReplyToCreatedDate = v
			}
		}

		err := c.retrySend(ctx, "sendTextMessage", func(ctx context.Context) error {
			respBody, err := c.doAPICall(ctx, "POST", "/api/v1/chatservice/goclaw-connector/webhook/response", payload)
			if err != nil {
				return err
			}

			var resp webhookAPIResponse
			if json.Unmarshal(respBody, &resp) == nil && !resp.Success {
				return fmt.Errorf("goconnect: sendTextMessage failed: %s", resp.Message)
			}
			return nil
		})

		if err != nil {
			return fmt.Errorf("goconnect: sendTextMessage chunk %d/%d: %w", i+1, len(chunks), err)
		}
	}

	slog.Debug("goconnect: text message sent",
		"room_id", meta.RoomID,
		"bot", meta.BotUserCode,
		"chunks", len(chunks),
		"text_preview", channels.Truncate(text, 60),
	)

	return nil
}

// sendMediaMessage sends a message with media attachments.
// Comparable to telegram.sendMediaMessage() but uses GoConnect's 3-step presigned URL flow:
//  1. POST /api/v1/chatservice/goclaw-connector/webhook/file-init → presigned PUT URL
//  2. PUT file binary to presigned URL
//  3. POST /api/v1/chatservice/goclaw-connector/webhook/file-commit → confirm upload
//
// Falls back to text description if media has no binary data.
func (c *Channel) sendMediaMessage(ctx context.Context, msg bus.OutboundMessage, meta webhookMetadata) error {
	var fallbackParts []string

	for _, media := range msg.Media {
		// Read file binary from disk (MediaAttachment.URL is a file path).
		// Same pattern as Slack, Zalo channels.
		if media.URL == "" {
			desc := fmt.Sprintf("[File: %s]", media.ContentType)
			fallbackParts = append(fallbackParts, desc)
			continue
		}

		fileData, err := os.ReadFile(media.URL)
		if err != nil {
			slog.Warn("goconnect: failed to read media file",
				"path", media.URL, "error", err)
			fallbackParts = append(fallbackParts, fmt.Sprintf("[File: %s - read failed]", media.URL))
			continue
		}

		// Determine file name and MIME type
		fileName := filepath.Base(media.URL)
		mimeType := media.ContentType
		if mimeType == "" {
			mimeType = "application/octet-stream"
		}

		// Step 1: POST file-init — get presigned URL + file_id + object_key
		initResp, err := c.fileInit(ctx, meta, fileName, fileData, mimeType, msg.Content)
		if err != nil {
			slog.Warn("goconnect: file-init failed, falling back to text",
				"file", fileName, "error", err)
			fallbackParts = append(fallbackParts, fmt.Sprintf("[File: %s (%s) - upload failed]", fileName, mimeType))
			continue
		}

		// Step 2: PUT file binary to presigned URL
		if err := c.filePut(ctx, initResp.PresignedURL, fileData, mimeType); err != nil {
			slog.Warn("goconnect: file PUT failed",
				"file", fileName, "error", err)
			fallbackParts = append(fallbackParts, fmt.Sprintf("[File: %s - upload failed]", fileName))
			continue
		}

		// Step 3: POST file-commit — confirm upload
		if err := c.fileCommit(ctx, meta, initResp, fileName, len(fileData), mimeType, msg.Content); err != nil {
			slog.Warn("goconnect: file-commit failed",
				"file", fileName, "error", err)
			fallbackParts = append(fallbackParts, fmt.Sprintf("[File: %s - commit failed]", fileName))
			continue
		}

		slog.Debug("goconnect: file uploaded successfully",
			"file", fileName,
			"size", len(fileData),
			"room_id", meta.RoomID,
		)
	}

	// Gửi text description cho các file không upload được + caption nếu có
	if len(fallbackParts) > 0 {
		text := strings.Join(fallbackParts, "\n")
		if msg.Content != "" {
			text = msg.Content + "\n\n" + text
		}
		return c.sendTextMessage(ctx, text, meta, msg.Metadata)
	}

	return nil
}

// ============================================================
// File upload helpers (3-step presigned URL flow)
// ============================================================

// fileInitResponse chứa thông tin trả về từ POST /webhook/file-init
type fileInitResponse struct {
	FileID        string `json:"file_id"`
	ObjectKey     string `json:"object_key"`
	PresignedURL  string `json:"presigned_url"`
	ExpiresAt     int64  `json:"expires_at"`
	ChatContentID string `json:"chat_content_id"`
	ContentType   string `json:"content_type"`
}

// fileInitRequest là body gửi lên POST /webhook/file-init
type fileInitRequest struct {
	RoomID       string             `json:"room_id"`
	FileName     string             `json:"file_name"`
	FileSize     int                `json:"file_size"`
	ContentType  string             `json:"content_type,omitempty"`
	InitialChunk string             `json:"initial_chunk,omitempty"` // base64-encoded first 256 bytes for format validation
	Metadata     fileUploadMetadata `json:"metadata"`
}

// fileCommitRequest là body gửi lên POST /webhook/file-commit
type fileCommitRequest struct {
	RoomID        string             `json:"room_id"`
	FileID        string             `json:"file_id"`
	ObjectKey     string             `json:"object_key"`
	ExpectedSize  int                `json:"expected_size"`
	FileName      string             `json:"file_name"`
	ContentType   string             `json:"content_type,omitempty"`
	Message       string             `json:"message,omitempty"`
	ChatContentID string             `json:"chat_content_id"`
	Metadata      fileUploadMetadata `json:"metadata"`
}

// fileUploadMetadata maps to FileUploadMetadataDto in goclaw-connector
type fileUploadMetadata struct {
	BotUserID   string `json:"bot_user_id"`
	BotUserCode string `json:"bot_user_code"`
}

// fileInit gọi POST /webhook/file-init để lấy presigned URL upload
// Sends first 256 bytes (initial_chunk) for server-side file format validation.
func (c *Channel) fileInit(ctx context.Context, meta webhookMetadata, fileName string, fileData []byte, mimeType string, caption string) (*fileInitResponse, error) {
	// Encode first 256 bytes as base64 for format validation
	chunkSize := 256
	if len(fileData) < chunkSize {
		chunkSize = len(fileData)
	}
	initialChunk := base64.StdEncoding.EncodeToString(fileData[:chunkSize])

	req := fileInitRequest{
		RoomID:       meta.RoomID,
		FileName:     fileName,
		FileSize:     len(fileData),
		ContentType:  mimeType,
		InitialChunk: initialChunk,
		Metadata: fileUploadMetadata{
			BotUserID:   meta.BotUserID,
			BotUserCode: meta.BotUserCode,
		},
	}

	var result *fileInitResponse
	err := c.retrySend(ctx, "fileInit", func(ctx context.Context) error {
		respBody, err := c.doAPICall(ctx, "POST", "/api/v1/chatservice/goclaw-connector/webhook/file-init", req)
		if err != nil {
			return err
		}

		// Parse response: { success: true, data: { file_id, object_key, presigned_url, ... } }
		var apiResp struct {
			Success bool             `json:"success"`
			Data    fileInitResponse `json:"data"`
			Message string           `json:"message,omitempty"`
		}
		if err := json.Unmarshal(respBody, &apiResp); err != nil {
			return fmt.Errorf("goconnect: parse file-init response: %w", err)
		}
		if !apiResp.Success {
			return fmt.Errorf("goconnect: file-init failed: %s", apiResp.Message)
		}
		result = &apiResp.Data
		return nil
	})

	return result, err
}

// filePut upload binary data lên presigned URL (PUT trực tiếp)
func (c *Channel) filePut(ctx context.Context, presignedURL string, data []byte, mimeType string) error {
	return c.retrySend(ctx, "filePut", func(ctx context.Context) error {
		req, err := http.NewRequestWithContext(ctx, "PUT", presignedURL, bytes.NewReader(data))
		if err != nil {
			return fmt.Errorf("goconnect: create PUT request: %w", err)
		}
		if mimeType != "" {
			req.Header.Set("Content-Type", mimeType)
		}
		req.ContentLength = int64(len(data))

		resp, err := c.httpClient.Do(req)
		if err != nil {
			return fmt.Errorf("goconnect: PUT file: %w", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode >= 400 {
			body, _ := io.ReadAll(resp.Body)
			return fmt.Errorf("goconnect: PUT file HTTP %d: %s", resp.StatusCode, string(body))
		}
		return nil
	})
}

// fileCommit gọi POST /webhook/file-commit để xác nhận file đã upload
func (c *Channel) fileCommit(ctx context.Context, meta webhookMetadata, initResp *fileInitResponse, fileName string, fileSize int, mimeType string, caption string) error {
	req := fileCommitRequest{
		RoomID:        meta.RoomID,
		FileID:        initResp.FileID,
		ObjectKey:     initResp.ObjectKey,
		ExpectedSize:  fileSize,
		FileName:      fileName,
		ContentType:   mimeType,
		Message:       caption,
		ChatContentID: initResp.ChatContentID,
		Metadata: fileUploadMetadata{
			BotUserID:   meta.BotUserID,
			BotUserCode: meta.BotUserCode,
		},
	}

	return c.retrySend(ctx, "fileCommit", func(ctx context.Context) error {
		respBody, err := c.doAPICall(ctx, "POST", "/api/v1/chatservice/goclaw-connector/webhook/file-commit", req)
		if err != nil {
			return err
		}

		var apiResp webhookAPIResponse
		if err := json.Unmarshal(respBody, &apiResp); err != nil {
			return fmt.Errorf("goconnect: parse file-commit response: %w", err)
		}
		if !apiResp.Success {
			return fmt.Errorf("goconnect: file-commit failed: %s", apiResp.Message)
		}
		return nil
	})
}


// ============================================================
// Reactions — implements channels.ReactionChannel
// ============================================================

// OnReactionEvent sends a reaction emoji to a message on GoConnect.
// POST /api/v1/chatservice/goclaw-connector/webhook/action { action: "react", emoji: "👍", target_created_date: "..." }
// Comparable to telegram.OnReactionEvent() but uses REST API instead of Telegram Bot API.
func (c *Channel) OnReactionEvent(ctx context.Context, chatID string, messageID string, status string) error {
	if !c.IsRunning() {
		return fmt.Errorf("goconnect channel not running")
	}

	emoji := statusToEmoji(status)
	if emoji == "" {
		slog.Debug("goconnect: no emoji mapping for status, skipping reaction",
			"status", status, "room_id", chatID)
		return nil
	}

	payload := webhookActionPayload{
		Action:            "react",
		Emoji:             emoji,
		TargetCreatedDate: messageID, // GoConnect uses created_date as messageID
		Metadata: webhookMetadata{
			RoomID:      chatID,
			BotUserID:   c.botUserID,
			BotUserCode: c.botUserCode,
		},
	}

	return c.retrySend(ctx, "OnReactionEvent", func(ctx context.Context) error {
		_, err := c.doAPICall(ctx, "POST", "/api/v1/chatservice/goclaw-connector/webhook/action", payload)
		return err
	})
}

// ClearReaction clears (removes) a reaction from a message.
// GoConnect doesn't have a dedicated "clear reaction" API — send empty reaction.
func (c *Channel) ClearReaction(ctx context.Context, chatID string, messageID string) error {
	slog.Debug("goconnect: clear reaction (no-op on GoConnect)",
		"room_id", chatID, "message_id", messageID)
	return nil
}

// statusToEmoji maps GoClaw agent status to emoji reactions.
// Status strings are dispatched by events.go resolveToolReactionStatus():
//   "thinking" → agent started thinking
//   "tool"     → generic tool call
//   "web"      → web_search / browser tool
//   "coding"   → exec tool (shell/code execution)
//   "done"     → agent run completed
//   "error"    → agent run failed
//   "stallSoft" / "stallHard" → agent stalled (no activity)
//
// Note: GoConnect doesn't restrict emoji like Telegram, so we use descriptive emoji freely.
func statusToEmoji(status string) string {
	switch status {
	case "thinking":
		return "🤔"
	case "tool":
		return "⚙️"
	case "web":
		return "⚡"
	case "coding":
		return "👨‍💻"
	case "done":
		return "✅"
	case "error":
		return "❌"
	case "stallSoft":
		return "⏳"
	case "stallHard":
		return "😨"
	default:
		return ""
	}
}

// ============================================================
// Text utilities
// ============================================================

// chunkText splits text into chunks of maxLen, respecting newline boundaries.
// Comparable to telegram.chunkHTML() but simpler (no HTML tag tracking).
func chunkText(text string, maxLen int) []string {
	if len(text) <= maxLen {
		return []string{text}
	}

	var chunks []string
	for len(text) > 0 {
		if len(text) <= maxLen {
			chunks = append(chunks, text)
			break
		}

		// Find last newline within maxLen
		cutPoint := maxLen
		if idx := strings.LastIndex(text[:maxLen], "\n"); idx > maxLen/4 {
			cutPoint = idx + 1
		}

		chunks = append(chunks, text[:cutPoint])
		text = text[cutPoint:]
	}

	return chunks
}
