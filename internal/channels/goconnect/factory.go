package goconnect

import (
	"encoding/json"
	"fmt"

	"github.com/nextlevelbuilder/goclaw/internal/bus"
	"github.com/nextlevelbuilder/goclaw/internal/channels"
	"github.com/nextlevelbuilder/goclaw/internal/store"
)

// goconnectCreds maps the credentials JSON from the channel_instances table.
// Comparable to telegram.telegramCreds.
type goconnectCreds struct {
	APIKey       string `json:"api_key"`        // licenseKey for WebHookGuard
	BaseURL      string `json:"base_url"`       // Chat Service URL
	WebhookToken string `json:"webhook_token"`  // shared secret for inbound auth
	BotUserID    string `json:"bot_user_id"`    // UUID of bot on GoConnect
	BotUserCode  string `json:"bot_user_code"`  // Convention: BOT_GO_CLAW_*
}

// goconnectInstanceConfig maps the non-secret config JSONB from the channel_instances table.
// Comparable to telegram.telegramInstanceConfig.
type goconnectInstanceConfig struct {
	BaseURL        string   `json:"base_url,omitempty"`         // Override from creds
	DMPolicy       string   `json:"dm_policy,omitempty"`        // "open", "allowlist", "disabled"
	GroupPolicy    string   `json:"group_policy,omitempty"`     // "open", "allowlist", "disabled"
	RequireMention *bool    `json:"require_mention,omitempty"`  // Default: true
	HistoryLimit   int      `json:"history_limit,omitempty"`    // Group history limit
	AllowFrom      []string `json:"allow_from,omitempty"`       // Allowlist
}

// Factory creates a GoConnect channel from DB instance data.
// Comparable to telegram.Factory().
// Signature matches channels.ChannelFactory type.
func Factory(name string, creds json.RawMessage, cfg json.RawMessage,
	msgBus *bus.MessageBus, pairingSvc store.PairingStore) (channels.Channel, error) {
	return buildChannel(name, creds, cfg, msgBus)
}

// buildChannel creates and configures a GoConnect channel instance.
// Comparable to telegram.buildChannel().
func buildChannel(name string, creds json.RawMessage, cfg json.RawMessage,
	msgBus *bus.MessageBus) (channels.Channel, error) {

	// Parse credentials
	var c goconnectCreds
	if len(creds) > 0 {
		if err := json.Unmarshal(creds, &c); err != nil {
			return nil, fmt.Errorf("decode goconnect credentials: %w", err)
		}
	}
	if c.APIKey == "" {
		return nil, fmt.Errorf("goconnect api_key is required")
	}
	if c.BaseURL == "" {
		return nil, fmt.Errorf("goconnect base_url is required")
	}
	if c.BotUserID == "" {
		return nil, fmt.Errorf("goconnect bot_user_id is required")
	}

	// Parse config
	var ic goconnectInstanceConfig
	if len(cfg) > 0 {
		if err := json.Unmarshal(cfg, &ic); err != nil {
			return nil, fmt.Errorf("decode goconnect config: %w", err)
		}
	}

	// Config overrides (prefer config values, fall back to creds)
	baseURL := ic.BaseURL
	if baseURL == "" {
		baseURL = c.BaseURL
	}

	gcCfg := GoConnectConfig{
		Enabled:        true,
		BaseURL:        baseURL,
		APIKey:         c.APIKey,
		WebhookToken:   c.WebhookToken,
		BotUserID:      c.BotUserID,
		BotUserCode:    c.BotUserCode,
		AllowFrom:      ic.AllowFrom,
		DMPolicy:       ic.DMPolicy,
		GroupPolicy:     ic.GroupPolicy,
		RequireMention: ic.RequireMention,
		HistoryLimit:   ic.HistoryLimit,
	}

	// DB instances default to "open" for groups (GoConnect manages its own access control).
	if gcCfg.GroupPolicy == "" {
		gcCfg.GroupPolicy = "open"
	}

	ch, err := New(gcCfg, msgBus, nil)
	if err != nil {
		return nil, err
	}

	// Override the channel name from DB instance.
	ch.SetName(name)
	return ch, nil
}
