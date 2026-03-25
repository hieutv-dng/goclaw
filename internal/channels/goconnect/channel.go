// Package goconnect implements a GoClaw channel plugin for VNPT GoConnect Chat Service.
//
// Architecture:
//   - Inbound: GoConnect Chat Service → webhook POST /hooks/goconnect → GoClaw agent
//   - Outbound: GoClaw agent → REST API → GoConnect Chat Service (goclaw-connector module)
//
// Implements:
//   - channels.Channel (Start, Stop, Send, IsRunning, IsAllowed)
//   - channels.WebhookChannel (WebhookHandler — mount on gateway mux)
//   - channels.ReactionChannel (OnReactionEvent, ClearReaction)
package goconnect

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/nextlevelbuilder/goclaw/internal/bus"
	"github.com/nextlevelbuilder/goclaw/internal/channels"
)

const (
	// sendTimeout is the overall timeout for outbound REST API calls to Chat Service.
	sendTimeout = 30 * time.Second

	// sendMaxRetries is the maximum number of retries for transient network errors.
	sendMaxRetries = 3

	// sendRetryDelay is the base delay between retries (multiplied by attempt number).
	sendRetryDelay = 2 * time.Second

	// webhookPath is the HTTP path prefix mounted on the gateway mux.
	webhookPath = "/hooks/goconnect"
)

// Channel connects GoClaw to VNPT GoConnect Chat Service via REST API + webhook.
// Comparable to telegram.Channel but simpler: webhook-based inbound (no long polling),
// REST API outbound (no Bot API SDK).
type Channel struct {
	*channels.BaseChannel

	config     GoConnectConfig
	httpClient *http.Client

	// Webhook auth
	webhookToken string // shared secret — validated on inbound requests

	// Outbound API
	baseURL string // Chat Service base URL (e.g. "http://chat-service:3000/api/v1/chatservice")
	apiKey  string // licenseKey for WebHookGuard authentication

	// Bot identity
	botUserID   string // user_id of bot on GoConnect (UUID)
	botUserCode string // user_code convention (e.g. "BOT_GO_CLAW_HR")

	// Mention gating
	requireMention bool

	// Placeholder tracking (localKey → created_date string)
	// GoConnect uses created_date (ISO 8601) as message ID, not integer.
	placeholders sync.Map

	// Group history (matching Telegram pattern)
	groupHistory *channels.PendingHistory
	historyLimit int
}

// GoConnectConfig holds the configuration for a GoConnect channel instance.
// Comparable to config.TelegramConfig.
type GoConnectConfig struct {
	Enabled        bool     `json:"enabled"`
	BaseURL        string   `json:"base_url"`         // Chat Service URL
	APIKey         string   `json:"api_key"`           // licenseKey for WebHookGuard
	WebhookToken   string   `json:"webhook_token"`     // shared secret for inbound auth
	BotUserID      string   `json:"bot_user_id"`       // UUID
	BotUserCode    string   `json:"bot_user_code"`     // Convention: BOT_GO_CLAW_*
	AllowFrom      []string `json:"allow_from,omitempty"`
	DMPolicy       string   `json:"dm_policy,omitempty"`
	GroupPolicy    string   `json:"group_policy,omitempty"`
	RequireMention *bool    `json:"require_mention,omitempty"`
	HistoryLimit   int      `json:"history_limit,omitempty"`
}

// New creates a new GoConnect channel from config.
// Comparable to telegram.New().
func New(cfg GoConnectConfig, msgBus *bus.MessageBus, pendingStore interface{}) (*Channel, error) {
	if cfg.BaseURL == "" {
		return nil, fmt.Errorf("goconnect: base_url is required")
	}
	if cfg.APIKey == "" {
		return nil, fmt.Errorf("goconnect: api_key is required")
	}
	if cfg.BotUserID == "" {
		return nil, fmt.Errorf("goconnect: bot_user_id is required")
	}

	base := channels.NewBaseChannel(channels.TypeGoConnect, msgBus, cfg.AllowFrom)
	base.ValidatePolicy(cfg.DMPolicy, cfg.GroupPolicy)

	requireMention := true
	if cfg.RequireMention != nil {
		requireMention = *cfg.RequireMention
	}

	historyLimit := cfg.HistoryLimit
	if historyLimit == 0 {
		historyLimit = channels.DefaultGroupHistoryLimit
	}

	// Isolate transport per channel instance (same pattern as Telegram).
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.MaxIdleConnsPerHost = 32

	return &Channel{
		BaseChannel: base,
		config:      cfg,
		httpClient: &http.Client{
			Timeout:   sendTimeout,
			Transport: transport,
		},
		webhookToken:   cfg.WebhookToken,
		baseURL:        strings.TrimRight(cfg.BaseURL, "/"),
		apiKey:         cfg.APIKey,
		botUserID:      cfg.BotUserID,
		botUserCode:    cfg.BotUserCode,
		requireMention: requireMention,
		groupHistory:   channels.MakeHistory(channels.TypeGoConnect, nil, base.TenantID()),
		historyLimit:   historyLimit,
	}, nil
}

// Start marks the channel as running.
// Unlike Telegram (long polling), GoConnect uses webhook — no polling goroutine needed.
// The HTTP handler is mounted separately via WebhookHandler().
func (c *Channel) Start(_ context.Context) error {
	slog.Info("starting goconnect channel",
		"base_url", c.baseURL,
		"bot_user_id", c.botUserID,
		"bot_user_code", c.botUserCode,
		"channel", c.Name(),
	)
	c.SetRunning(true)
	c.groupHistory.StartFlusher()
	return nil
}

// Stop gracefully shuts down the channel.
func (c *Channel) Stop(_ context.Context) error {
	slog.Info("stopping goconnect channel", "channel", c.Name())
	c.SetRunning(false)
	c.groupHistory.StopFlusher()
	return nil
}

// SetPendingHistoryTenantID propagates tenant_id to the pending history for DB operations.
func (c *Channel) SetPendingHistoryTenantID(id uuid.UUID) { c.groupHistory.SetTenantID(id) }

// WebhookHandler returns the HTTP handler and path for mounting on the gateway mux.
// Implements channels.WebhookChannel interface.
// Comparable to Feishu/Slack webhook pattern.
func (c *Channel) WebhookHandler() (string, http.Handler) {
	mux := http.NewServeMux()

	// POST /hooks/goconnect — receive inbound messages from Chat Service
	mux.HandleFunc("POST "+webhookPath, c.handleWebhookHTTP)

	// GET /hooks/goconnect/health — health check (no auth)
	mux.HandleFunc("GET "+webhookPath+"/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{
			"status":  "ok",
			"channel": c.Name(),
			"type":    "goconnect",
		})
	})

	return webhookPath + "/", mux
}

// SetPendingCompaction configures LLM-based auto-compaction for pending messages.
// Comparable to telegram.Channel.SetPendingCompaction().
func (c *Channel) SetPendingCompaction(cfg *channels.CompactionConfig) {
	c.groupHistory.SetCompactionConfig(cfg)
}

// ============================================================
// Outbound helpers
// ============================================================

// doAPICall makes an authenticated REST API call to Chat Service.
// Sends JSON body with api-key header (matching WebHookGuard pattern).
// Returns response body.
func (c *Channel) doAPICall(ctx context.Context, method, path string, payload interface{}) ([]byte, error) {
	var body io.Reader
	if payload != nil {
		data, err := json.Marshal(payload)
		if err != nil {
			return nil, fmt.Errorf("goconnect: marshal payload: %w", err)
		}
		body = bytes.NewReader(data)
	}

	url := c.baseURL + path
	req, err := http.NewRequestWithContext(ctx, method, url, body)
	if err != nil {
		return nil, fmt.Errorf("goconnect: create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("api-key", c.apiKey) // WebHookGuard authentication

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("goconnect: HTTP %s %s: %w", method, path, err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode >= 400 {
		return respBody, fmt.Errorf("goconnect: HTTP %d from %s: %s",
			resp.StatusCode, path, string(respBody))
	}

	return respBody, nil
}

// retrySend wraps an API call with retry logic for transient network errors.
// Comparable to telegram.Channel.retrySend() but simpler (no IPv4 fallback needed).
func (c *Channel) retrySend(ctx context.Context, name string, fn func(context.Context) error) error {
	ctx, cancel := context.WithTimeout(ctx, sendTimeout)
	defer cancel()

	var err error
	for attempt := 1; attempt <= sendMaxRetries; attempt++ {
		err = fn(ctx)
		if err == nil {
			return nil
		}
		if !isRetryableErr(err) || attempt == sendMaxRetries {
			return err
		}

		slog.Warn("goconnect send retry",
			"func", name, "attempt", attempt, "max", sendMaxRetries, "error", err)

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(sendRetryDelay * time.Duration(attempt)):
		}
	}
	return err
}

// Compile-time interface checks.
var (
	_ channels.Channel         = (*Channel)(nil)
	_ channels.WebhookChannel  = (*Channel)(nil)
	_ channels.ReactionChannel = (*Channel)(nil)
)

// isRetryableErr checks if an error is transient and worth retrying.
func isRetryableErr(err error) bool {
	if err == nil {
		return false
	}
	s := err.Error()
	return strings.Contains(s, "timeout") ||
		strings.Contains(s, "connection reset") ||
		strings.Contains(s, "broken pipe") ||
		strings.Contains(s, "EOF")
}
