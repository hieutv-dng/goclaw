import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import { withErrorHandler, getChainHint } from "../shared/index.js";

// ─────────────────────────────────────────────
// Smart Estimation Engine
//
// Dự đoán thời gian hoàn thành task dựa trên
// lịch sử metrics (thực tế vs ước tính trước đó).
// ─────────────────────────────────────────────

interface MetricEntry {
  issueKey: string;
  issueType: string;
  tags: string[];
  estimatedHours: number;
  actualHours: number;
  aiSucceeded: boolean;
}

async function getStorePath(): Promise<string> {
  const p = path.join(process.cwd(), "metrics-store.json");
  try {
    await fs.access(p);
    return p;
  } catch {
    return path.join(process.cwd(), "..", "metrics-store.json");
  }
}

export function registerEstimationTools(server: McpServer) {

  server.tool(
    "suggest_estimation",
    "Đề xuất thời gian hoàn thành task (hours) dựa trên lịch sử metrics. " +
    "Phân tích các task tương tự về issueType và tags để đưa ra con số thực tế hơn. " +
    "→ Tiếp: Dùng kết quả này để điền vào `evaluate_task_complexity`.",
    {
      issueKey: z.string().describe("Jira issue key hiện tại"),
      issueType: z.string().default("Task").describe("Loại issue: Task, Bug, Story"),
      tags: z.array(z.string()).default([]).describe("Tags liên quan: ['auth', 'form', 'api']"),
      baseEstimation: z.number().optional().describe("Ước tính ban đầu (nếu có)"),
    },
    withErrorHandler("suggest_estimation", async ({ issueType, tags, baseEstimation }) => {
      let entries: MetricEntry[] = [];
      try {
        const raw = await fs.readFile(await getStorePath(), "utf-8");
        entries = JSON.parse(raw).entries || [];
      } catch {
        return {
          content: [{
            type: "text",
            text: "⚠️ Chưa có dữ liệu metrics để phân tích. Hãy dùng `track_metric` sau khi xong task.",
          }],
        };
      }

      if (entries.length < 5) {
        return {
          content: [{
            type: "text",
            text: `⚠️ Dữ liệu quá ít (${entries.length} tasks). Cần ít nhất 5 tasks để estimate chính xác.`,
          }],
        };
      }

      // Filter similar tasks
      const similarTasks = entries.filter(e => 
        e.issueType === issueType || 
        e.tags.some(t => tags.includes(t))
      );

      const targetTasks = similarTasks.length >= 3 ? similarTasks : entries;
      
      const avgActual = targetTasks.reduce((a, b) => a + b.actualHours, 0) / targetTasks.length;
      const avgRatio = targetTasks.reduce((a, b) => a + (b.actualHours / (b.estimatedHours || 1)), 0) / targetTasks.length;
      
      let suggested = avgActual;
      if (baseEstimation) {
        suggested = baseEstimation * avgRatio;
      }

      // Round to 0.5
      suggested = Math.round(suggested * 2) / 2;

      const lines = [
        `# 🧠 Smart Estimation`,
        "",
        `**Dựa trên ${targetTasks.length} tasks tương tự:**`,
        `- Thời gian thực tế trung bình: **${avgActual.toFixed(1)}h**`,
        `- Hệ số sai lệch (Actual/Est): **×${avgRatio.toFixed(2)}**`,
        "",
        `💡 **Đề xuất: ${suggested}h**`,
        "",
        "---",
        "## Phân tích",
        avgRatio > 1.2 
          ? "⚠️ Team đang underestimate. Đã cộng thêm buffer vào đề xuất." 
          : avgRatio < 0.8
          ? "ℹ️ Team đang overestimate. Đề xuất con số thực tế hơn."
          : "✅ Ước tính khá sát với thực tế.",
        "",
        `📌 **Next step:** Dùng \`${suggested}h\` khi điền vào Jira hoặc \`evaluate_task_complexity\`.`
      ];

      return {
        content: [{ type: "text", text: lines.join("\n") + getChainHint("suggest_estimation") }],
      };
    })
  );
}
