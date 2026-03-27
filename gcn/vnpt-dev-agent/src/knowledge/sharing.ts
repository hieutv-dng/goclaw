import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { withErrorHandler, getChainHint } from "../shared/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─────────────────────────────────────────────
// Cross-Project Knowledge Sharing
//
// Chia sẻ tribal knowledge (gotchas, patterns)
// giữa các dự án khác nhau.
// Dùng file: store/cross-project-knowledge.json
// ─────────────────────────────────────────────

interface KnowledgeEntry {
  id: string;
  sourceProject: string;
  stack: string;
  topic: string;
  content: string;
  contributedBy: string;
  recordedAt: string;
  impact: "low" | "medium" | "high";
  tag: string[];
}

async function getStorePath(): Promise<string> {
  const dir = path.resolve(__dirname, "..", "..", "store");
  await fs.mkdir(dir, { recursive: true });
  return path.join(dir, "cross-project-knowledge.json");
}

async function loadKnowledge(): Promise<KnowledgeEntry[]> {
  try {
    const raw = await fs.readFile(await getStorePath(), "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveKnowledge(knowledge: KnowledgeEntry[]): Promise<void> {
  await fs.writeFile(await getStorePath(), JSON.stringify(knowledge, null, 2), "utf-8");
}

export function registerKnowledgeSharingTools(server: McpServer) {

  // ── TOOL 1: Đóng góp kiến thức ────────────────
  server.tool(
    "contribute_knowledge",
    "Chia sẻ kiến thức mới phát hiện giữa các project. " +
    "VD: Gotcha của một API, pattern UI tốt, cách fix bug hiếm. " +
    "⚠️ Gọi khi bạn phát hiện ra một điều gì đó 'wow' mà team nên biết.",
    {
      sourceProject: z.string().describe("Tên project hiện tại"),
      stack: z.string().describe("Tech stack liên quan. VD: 'angular', 'spring'"),
      topic: z.string().describe("Tiêu đề ngắn gọn"),
      content: z.string().describe("Nội dung chi tiết kiến thức"),
      impact: z.enum(["low", "medium", "high"]).default("medium").describe("Mức độ quan trọng"),
      tags: z.array(z.string()).default([]),
    },
    withErrorHandler("contribute_knowledge", async (input) => {
      const knowledge = await loadKnowledge();
      const entry: KnowledgeEntry = {
        id: Date.now().toString(36),
        sourceProject: input.sourceProject,
        stack: input.stack,
        topic: input.topic,
        content: input.content,
        contributedBy: "AI Dev Agent",
        recordedAt: new Date().toISOString(),
        impact: input.impact,
        tag: input.tags,
      };

      knowledge.push(entry);
      await saveKnowledge(knowledge);

      return {
        content: [{
          type: "text",
          text: `✅ Đã đóng góp kiến thức: **${input.topic}** (Stack: ${input.stack}). Kiến thức này sẽ được gợi ý cho các project cùng stack.` + getChainHint("contribute_knowledge"),
        }],
      };
    })
  );

  // ── TOOL 2: Lấy kiến thức dùng chung ────────────
  server.tool(
    "get_shared_knowledge",
    "Lấy kiến thức dùng chung từ các project khác. " +
    "Dùng để check gotchas/patterns trước khi implement. " +
    "→ Tiếp: `get_team_context` + `get_shared_knowledge`.",
    {
      stack: z.string().describe("Tech stack để filter"),
      topic: z.string().optional().describe("Topic cần tìm kiếm"),
    },
    withErrorHandler("get_shared_knowledge", async ({ stack, topic }) => {
      const knowledge = await loadKnowledge();
      let matched = knowledge.filter(k => k.stack === stack);

      if (topic) {
        matched = matched.filter(k => 
          k.topic.toLowerCase().includes(topic.toLowerCase()) ||
          k.content.toLowerCase().includes(topic.toLowerCase())
        );
      }

      if (matched.length === 0) {
        return {
          content: [{ type: "text", text: `📭 Chưa có kiến thức dùng chung cho stack: ${stack}.` + getChainHint("get_shared_knowledge") }],
        };
      }

      const impactIcon = { high: "🔴", medium: "🟡", low: "⚪" };
      
      const lines = [
        `# 💡 Kiến thức chung — Stack: ${stack} (${matched.length} entries)`,
        "",
        ...matched.map(k => [
          `### ${impactIcon[k.impact]} ${k.topic}`,
          `- **Từ project:** ${k.sourceProject}`,
          `- **Ngày ghi:** ${new Date(k.recordedAt).toLocaleDateString()}`,
          "",
          "> " + k.content,
          "",
        ].join("\n")),
        "---",
        "📌 Dùng kiến thức này để tránh lặp lại lỗi cũ trong project hiện tại.",
      ];

      return {
        content: [{ type: "text", text: lines.join("\n") + getChainHint("get_shared_knowledge") }],
      };
    })
  );
}
