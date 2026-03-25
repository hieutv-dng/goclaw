package goconnect

import (
	"regexp"
	"strings"
)

// markdownToGoConnect converts GoClaw markdown output to GoConnect-compatible text.
// GoConnect Chat Service processes its own text entities (mentions, URLs, emoji)
// via _getTextEntities, so we strip most markdown formatting and keep plain text.
//
// Comparable to telegram.markdownToTelegramHTML() but simpler:
// GoConnect doesn't need HTML — it processes raw text.
//
// Supported conversions:
//   - **bold** → bold (strip markers)
//   - *italic* → italic (strip markers)
//   - `code` → code (keep backticks — GoConnect renders them)
//   - ```code block``` → keep as-is
//   - [text](url) → text (url) — expand inline links
//   - Headers (#, ##, ###) → strip markers, keep text
func markdownToGoConnect(md string) string {
	if md == "" {
		return ""
	}

	result := md

	// Preserve code blocks (don't process contents)
	// Replace temporarily, process rest, then restore
	type placeholder struct {
		key     string
		content string
	}
	var codeBlocks []placeholder
	codeBlockRe := regexp.MustCompile("(?s)```[a-z]*\n?(.*?)```")
	idx := 0
	result = codeBlockRe.ReplaceAllStringFunc(result, func(match string) string {
		key := "\x00CODEBLOCK" + string(rune(idx)) + "\x00"
		codeBlocks = append(codeBlocks, placeholder{key: key, content: match})
		idx++
		return key
	})

	// Inline code — keep backticks
	// (GoConnect can render inline code with backticks)

	// Bold: **text** → text
	boldRe := regexp.MustCompile(`\*\*(.+?)\*\*`)
	result = boldRe.ReplaceAllString(result, "$1")

	// Italic: *text* → text (but not ** which is bold)
	italicRe := regexp.MustCompile(`(?:^|[^*])\*([^*]+?)\*(?:[^*]|$)`)
	result = italicRe.ReplaceAllStringFunc(result, func(match string) string {
		// Simple approach: just remove single asterisks
		return strings.ReplaceAll(match, "*", "")
	})

	// Strikethrough: ~~text~~ → text
	strikeRe := regexp.MustCompile(`~~(.+?)~~`)
	result = strikeRe.ReplaceAllString(result, "$1")

	// Inline links: [text](url) → text (url)
	linkRe := regexp.MustCompile(`\[([^\]]+)\]\(([^)]+)\)`)
	result = linkRe.ReplaceAllString(result, "$1 ($2)")

	// Headers: # Title → Title
	headerRe := regexp.MustCompile(`(?m)^#{1,6}\s+`)
	result = headerRe.ReplaceAllString(result, "")

	// Horizontal rules: --- or *** → ────────
	hrRe := regexp.MustCompile(`(?m)^[-*]{3,}\s*$`)
	result = hrRe.ReplaceAllString(result, "────────")

	// Restore code blocks
	for _, cb := range codeBlocks {
		result = strings.Replace(result, cb.key, cb.content, 1)
	}

	return strings.TrimSpace(result)
}
