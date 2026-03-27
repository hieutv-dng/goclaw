import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import { withErrorHandler, getChainHint } from "../shared/index.js";

// ─────────────────────────────────────────────
// Metrics Tracking — Bổ sung #7
//
// Vấn đề: Đầu tư thời gian build hệ thống này
// nhưng không biết có thực sự hiệu quả không.
//
// Giải pháp: Track 4 metrics cốt lõi:
//   1. Cycle time: pick task → tạo PR
//   2. AI revision rate: số lần sửa code AI
//   3. Task success rate: AI xử lý được bao nhiêu %
//   4. Estimation accuracy: ước tính vs thực tế
//
// Khác với feedback-store.json (định tính):
//   metrics-store.json = định lượng, time-series
// ─────────────────────────────────────────────

// ── Types ──────────────────────────────────────

interface MetricEntry {
  id: string;
  issueKey: string;
  summary: string;
  recordedAt: string;           // ISO date

  // Cycle time metrics
  taskPickedAt: string;         // Lúc bắt đầu làm
  prCreatedAt?: string;         // Lúc tạo PR
  prMergedAt?: string;          // Lúc merge PR
  cycleTimeMinutes?: number;    // Auto-calc

  // AI performance metrics
  aiRevisionsNeeded: number;    // Số lần sửa code AI trước khi merge
  aiSucceeded: boolean;         // AI có implement được task không
  aiFailureReason?: string;     // Nếu fail, lý do là gì

  // Estimation metrics
  estimatedHours: number;
  actualHours: number;

  // Quality metrics
  codeQualityScore: 1 | 2 | 3 | 4 | 5;
  hadSecurityIssue: boolean;    // AI generate ra security issue không
  hadDriftIssue: boolean;       // Có bị drift description không

  // Context metrics
  contextFilesUsed: number;     // Số file context đưa vào
  contextWasAccurate: boolean;  // Context có đúng không

  // Task metadata
  issueType: string;            // Bug, Task, Story
  tags: string[];
  sprint?: string;
}

interface MetricsStore {
  version: string;
  lastUpdated: string;
  entries: MetricEntry[];
}

// ── Helpers ────────────────────────────────────

async function getStorePath(): Promise<string> {
  const candidates = [
    process.env.METRICS_STORE_PATH,
    path.join(process.cwd(), "metrics-store.json"),
    path.join(process.cwd(), "..", "metrics-store.json"),
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    try { await fs.access(p); return p; }
    catch { /* không tồn tại */ }
  }
  return candidates[candidates.length - 1];
}

async function loadStore(): Promise<MetricsStore> {
  try {
    const raw = await fs.readFile(await getStorePath(), "utf-8");
    return JSON.parse(raw);
  } catch {
    return { version: "1.0.0", lastUpdated: new Date().toISOString(), entries: [] };
  }
}

async function saveStore(store: MetricsStore): Promise<void> {
  store.lastUpdated = new Date().toISOString();
  await fs.writeFile(await getStorePath(), JSON.stringify(store, null, 2), "utf-8");
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

function avg(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ── Tool registration ──────────────────────────

export function registerMetricsTools(server: McpServer) {

  // ── TOOL 1: Track metric ──────────────────────
  server.tool(
    "track_metric",
    "Ghi lại metrics định lượng sau khi hoàn thành một task. " +
    "Track: cycle time, số lần AI cần sửa, ước tính vs thực tế, " +
    "chất lượng code, có security/drift issue không. " +
    "Dùng cùng lúc với submit_task_feedback sau khi merge PR. " +
    "Dữ liệu này giúp đo ROI thực tế của hệ thống AI theo thời gian. " +
    "⚠️ PHẢI hỏi user xác nhận TRƯỚC KHI gọi tool này — hiển thị metrics sẽ ghi cho user review trước.",
    {
      issueKey: z.string().describe("Jira issue key"),
      summary: z.string().describe("Tiêu đề task"),

      taskPickedAt: z.string()
        .describe("Thời điểm bắt đầu làm task, ISO format. VD: '2026-03-19T08:00:00'"),
      prCreatedAt: z.string().optional()
        .describe("Thời điểm tạo PR, ISO format"),
      prMergedAt: z.string().optional()
        .describe("Thời điểm merge PR, ISO format"),

      aiRevisionsNeeded: z.number().min(0)
        .describe("Số lần phải sửa code AI generate trước khi merge. 0 = dùng được ngay"),
      aiSucceeded: z.boolean()
        .describe("AI có implement được task không (true = dùng code AI, false = phải tự viết lại)"),
      aiFailureReason: z.string().optional()
        .describe("Nếu AI fail, lý do. VD: 'Không hiểu business logic phức tạp'"),

      estimatedHours: z.number().describe("Giờ AI ước tính"),
      actualHours: z.number().describe("Giờ thực tế"),
      codeQualityScore: z.number().min(1).max(5)
        .describe("Chất lượng code AI: 1-5"),

      hadSecurityIssue: z.boolean().default(false)
        .describe("AI có generate ra security issue không"),
      hadDriftIssue: z.boolean().default(false)
        .describe("Có bị ảnh hưởng bởi description drift không"),

      contextFilesUsed: z.number().default(5)
        .describe("Số file context đưa cho AI"),
      contextWasAccurate: z.boolean().default(true)
        .describe("Context có thực sự liên quan và hữu ích không"),

      issueType: z.string().default("Task")
        .describe("Loại issue: Task, Bug, Story"),
      tags: z.array(z.string()).default([])
        .describe("Tags: ['auth', 'form', 'bug-fix'...]"),
      sprint: z.string().optional()
        .describe("Tên sprint. VD: 'Sprint 42'"),
    },
    withErrorHandler("track_metric", async (input) => {
      const store = await loadStore();

      // Tính cycle time nếu có đủ dữ liệu
      let cycleTimeMinutes: number | undefined;
      if (input.prMergedAt) {
        const start = new Date(input.taskPickedAt).getTime();
        const end = new Date(input.prMergedAt).getTime();
        cycleTimeMinutes = Math.round((end - start) / (1000 * 60));
      } else if (input.prCreatedAt) {
        const start = new Date(input.taskPickedAt).getTime();
        const end = new Date(input.prCreatedAt).getTime();
        cycleTimeMinutes = Math.round((end - start) / (1000 * 60));
      }

      const entry: MetricEntry = {
        id: generateId(),
        issueKey: input.issueKey,
        summary: input.summary,
        recordedAt: new Date().toISOString(),
        taskPickedAt: input.taskPickedAt,
        prCreatedAt: input.prCreatedAt,
        prMergedAt: input.prMergedAt,
        cycleTimeMinutes,
        aiRevisionsNeeded: input.aiRevisionsNeeded,
        aiSucceeded: input.aiSucceeded,
        aiFailureReason: input.aiFailureReason,
        estimatedHours: input.estimatedHours,
        actualHours: input.actualHours,
        codeQualityScore: input.codeQualityScore as 1|2|3|4|5,
        hadSecurityIssue: input.hadSecurityIssue,
        hadDriftIssue: input.hadDriftIssue,
        contextFilesUsed: input.contextFilesUsed,
        contextWasAccurate: input.contextWasAccurate,
        issueType: input.issueType,
        tags: input.tags,
        sprint: input.sprint,
      };

      store.entries.push(entry);
      await saveStore(store);

      const cycleTimeStr = cycleTimeMinutes
        ? cycleTimeMinutes >= 60
          ? `${Math.round(cycleTimeMinutes / 60)}h ${cycleTimeMinutes % 60}m`
          : `${cycleTimeMinutes}m`
        : "N/A";

      const estRatio = (input.actualHours / input.estimatedHours).toFixed(2);
      const ratioNote =
        Number(estRatio) > 1.3 ? "⚠️ Thực tế lâu hơn ước tính" :
        Number(estRatio) < 0.7 ? "✅ Nhanh hơn ước tính" :
        "✅ Khá chính xác";

      return {
        content: [{
          type: "text",
          text: [
            `# 📈 Metric đã track — ${input.issueKey}`,
            "",
            `- **Cycle time:** ${cycleTimeStr}`,
            `- **AI revisions:** ${input.aiRevisionsNeeded} lần sửa`,
            `- **AI succeeded:** ${input.aiSucceeded ? "✅ Có" : "❌ Không"}`,
            `- **Estimation:** ×${estRatio} — ${ratioNote}`,
            `- **Code quality:** ${"⭐".repeat(input.codeQualityScore)}`,
            input.hadSecurityIssue ? "- ⚠️ Có security issue trong code AI" : "",
            input.hadDriftIssue    ? "- ⚠️ Bị ảnh hưởng bởi description drift" : "",
            "",
            `💾 Tổng metrics đã track: ${store.entries.length} tasks`,
            store.entries.length >= 10
              ? "📊 Đã đủ data — dùng `get_metrics_report` để xem báo cáo!"
              : `📊 Cần thêm ${10 - store.entries.length} tasks nữa để có báo cáo đủ ý nghĩa`,
          ].filter(Boolean).join("\n") + getChainHint("track_metric"),
        }],
      };
    })
  );

  // ── TOOL 2: Get metrics report ────────────────
  server.tool(
    "get_metrics_report",
    "Tạo báo cáo tổng quan metrics theo khoảng thời gian hoặc sprint. " +
    "Bao gồm: cycle time trend, AI success rate, estimation accuracy, " +
    "code quality over time, và so sánh before/after theo sprint. " +
    "Dùng cuối sprint hoặc cuối tháng để đánh giá ROI của hệ thống.",
    {
      lastNDays: z.number().optional()
        .describe("Báo cáo N ngày gần nhất. Bỏ trống = tất cả"),
      sprint: z.string().optional()
        .describe("Filter theo sprint cụ thể"),
      filterTag: z.string().optional()
        .describe("Filter theo tag. VD: 'auth'"),
      compareLastNSprints: z.number().optional()
        .describe("So sánh N sprints gần nhất với nhau"),
    },
    withErrorHandler("get_metrics_report", async ({ lastNDays, sprint, filterTag, compareLastNSprints }) => {
      const store = await loadStore();

      if (store.entries.length === 0) {
        return {
          content: [{
            type: "text",
            text: "Chưa có metrics nào. Dùng `track_metric` sau mỗi task để bắt đầu.",
          }],
        };
      }

      // Apply filters
      let entries = [...store.entries].sort(
        (a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime()
      );

      if (lastNDays) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - lastNDays);
        entries = entries.filter((e) => new Date(e.recordedAt) > cutoff);
      }
      if (sprint) {
        entries = entries.filter((e) => e.sprint === sprint);
      }
      if (filterTag) {
        entries = entries.filter((e) =>
          e.tags.some((t) => t.toLowerCase().includes(filterTag.toLowerCase()))
        );
      }

      if (entries.length === 0) {
        return {
          content: [{ type: "text", text: "Không có data cho filter đã chọn." }],
        };
      }

      // ── Tính các metrics ───────────────────────

      // Cycle time
      const cycleTimes = entries
        .filter((e) => e.cycleTimeMinutes !== undefined)
        .map((e) => e.cycleTimeMinutes!);
      const avgCycleMinutes = avg(cycleTimes);
      const medianCycleMinutes = median(cycleTimes);

      // AI performance
      const aiSuccessRate = entries.filter((e) => e.aiSucceeded).length / entries.length;
      const avgRevisions = avg(entries.map((e) => e.aiRevisionsNeeded));
      const zeroRevisionRate = entries.filter((e) => e.aiRevisionsNeeded === 0).length / entries.length;

      // Estimation accuracy
      const estRatios = entries
        .filter((e) => e.estimatedHours > 0)
        .map((e) => e.actualHours / e.estimatedHours);
      const avgEstRatio = avg(estRatios);

      // Quality
      const avgQuality = avg(entries.map((e) => e.codeQualityScore));
      const securityIssueRate = entries.filter((e) => e.hadSecurityIssue).length / entries.length;
      const driftIssueRate = entries.filter((e) => e.hadDriftIssue).length / entries.length;

      // Task type breakdown
      const byType: Record<string, number> = {};
      entries.forEach((e) => { byType[e.issueType] = (byType[e.issueType] ?? 0) + 1; });

      // Format helper
      const fmtTime = (mins: number) =>
        mins >= 60 ? `${(mins / 60).toFixed(1)}h` : `${Math.round(mins)}m`;

      const pct = (ratio: number) => `${Math.round(ratio * 100)}%`;

      const lines = [
        `# 📊 Metrics Report`,
        sprint ? `**Sprint:** ${sprint}` : lastNDays ? `**${lastNDays} ngày gần nhất**` : "**Tất cả thời gian**",
        `**Tasks analyzed:** ${entries.length}`,
        "",
        "## ⏱️ Cycle Time",
        `- Trung bình: **${fmtTime(avgCycleMinutes)}**`,
        `- Median:     **${fmtTime(medianCycleMinutes)}**`,
        cycleTimes.length < entries.length
          ? `- _(${entries.length - cycleTimes.length} tasks chưa có PR time)_`
          : "",
        "",
        "## 🤖 AI Performance",
        `- Success rate:         **${pct(aiSuccessRate)}** (${entries.filter((e) => e.aiSucceeded).length}/${entries.length} tasks)`,
        `- Zero revision rate:   **${pct(zeroRevisionRate)}** (dùng được ngay không cần sửa)`,
        `- Avg revisions:        **${avgRevisions.toFixed(1)} lần** sửa/task`,
        "",
        "## 📏 Estimation Accuracy",
        `- Avg ratio actual/estimated: **×${avgEstRatio.toFixed(2)}**`,
        avgEstRatio > 1.2
          ? `- ⚠️ Thường underestimate ${Math.round((avgEstRatio - 1) * 100)}% — nhân ước tính với ${avgEstRatio.toFixed(1)}`
          : avgEstRatio < 0.8
          ? `- ℹ️ Thường overestimate — AI ước tính lâu hơn thực tế`
          : "- ✅ Ước tính khá chính xác",
        "",
        "## ⭐ Code Quality",
        `- Avg quality score: **${avgQuality.toFixed(1)}/5**`,
        `- Security issues:   **${pct(securityIssueRate)}** tasks có issue`,
        `- Drift issues:      **${pct(driftIssueRate)}** tasks bị ảnh hưởng drift`,
        "",
        "## 📋 Task Type Breakdown",
        ...Object.entries(byType).map(([type, count]) =>
          `- ${type}: ${count} tasks (${pct(count / entries.length)})`
        ),
        "",
      ];

      // Sprint comparison nếu yêu cầu
      if (compareLastNSprints && compareLastNSprints > 1) {
        const allSprints = [...new Set(
          store.entries.filter((e) => e.sprint).map((e) => e.sprint!)
        )].slice(-compareLastNSprints);

        if (allSprints.length > 1) {
          lines.push("## 📈 Sprint Comparison");
          lines.push("| Sprint | Tasks | AI Success | Avg Revisions | Avg Quality |");
          lines.push("|--------|-------|------------|---------------|-------------|");

          for (const sp of allSprints) {
            const spEntries = store.entries.filter((e) => e.sprint === sp);
            const spSuccess = pct(spEntries.filter((e) => e.aiSucceeded).length / spEntries.length);
            const spRevisions = avg(spEntries.map((e) => e.aiRevisionsNeeded)).toFixed(1);
            const spQuality = avg(spEntries.map((e) => e.codeQualityScore)).toFixed(1);
            lines.push(`| ${sp} | ${spEntries.length} | ${spSuccess} | ${spRevisions} | ${spQuality}/5 |`);
          }
          lines.push("");
        }
      }

      // Insights tự động
      lines.push("## 💡 Insights tự động");
      if (aiSuccessRate < 0.6) {
        lines.push("- ⚠️ AI success rate thấp — cần cải thiện description quality hoặc context accuracy");
      }
      if (avgRevisions > 2) {
        lines.push("- ⚠️ Cần sửa nhiều — review lại GWT template và team context");
      }
      if (securityIssueRate > 0.1) {
        lines.push("- 🔴 Security issue rate cao — tăng cường dùng `security_review_checklist`");
      }
      if (driftIssueRate > 0.2) {
        lines.push("- ⚠️ Nhiều task bị drift — team cần cập nhật description thường xuyên hơn");
      }
      if (avgEstRatio > 1.3) {
        lines.push(`- ℹ️ Nhân ước tính AI với ×${avgEstRatio.toFixed(1)} cho chính xác hơn`);
      }
      if (zeroRevisionRate > 0.7) {
        lines.push("- ✅ AI đang perform tốt — 70%+ tasks dùng được ngay không cần sửa!");
      }

      return {
        content: [{ type: "text", text: lines.filter(Boolean).join("\n") + getChainHint("get_metrics_report") }],
      };
    })
  );

  // ── TOOL 3: Get metrics dashboard (HTML) ─────
  server.tool(
    "get_metrics_dashboard",
    "Tạo dashboard HTML visualize metrics inline trong Antigravity. " +
    "Hiển thị: trend charts, success rate gauge, cycle time histogram. " +
    "Dùng khi muốn nhìn tổng quan trực quan thay vì đọc numbers.",
    {
      lastNDays: z.number().default(30)
        .describe("Hiển thị N ngày gần nhất. Default: 30"),
    },
    withErrorHandler("get_metrics_dashboard", async ({ lastNDays }) => {
      const store = await loadStore();

      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - lastNDays);
      const entries = store.entries
        .filter((e) => new Date(e.recordedAt) > cutoff)
        .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());

      if (entries.length === 0) {
        return {
          content: [{ type: "text", text: "Chưa đủ data để render dashboard. Cần ít nhất 1 entry." }],
        };
      }

      // Chuẩn bị data cho charts
      const labels = entries.map((e) =>
        new Date(e.recordedAt).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" })
      );
      const qualityData = entries.map((e) => e.codeQualityScore);
      const revisionData = entries.map((e) => e.aiRevisionsNeeded);
      const cycleData = entries
        .filter((e) => e.cycleTimeMinutes)
        .map((e) => Math.round(e.cycleTimeMinutes! / 60 * 10) / 10);

      const aiSuccessRate = Math.round(
        (entries.filter((e) => e.aiSucceeded).length / entries.length) * 100
      );
      const avgQuality = (entries.reduce((a, b) => a + b.codeQualityScore, 0) / entries.length).toFixed(1);
      const avgRevisions = (entries.reduce((a, b) => a + b.aiRevisionsNeeded, 0) / entries.length).toFixed(1);
      const avgEstRatio = entries.filter((e) => e.estimatedHours > 0).length > 0
        ? (entries.filter((e) => e.estimatedHours > 0)
            .reduce((a, b) => a + b.actualHours / b.estimatedHours, 0) /
           entries.filter((e) => e.estimatedHours > 0).length).toFixed(2)
        : "N/A";

      const html = buildDashboardHtml(
        lastNDays, entries.length, aiSuccessRate, avgQuality, avgRevisions, avgEstRatio,
        labels, qualityData, revisionData, cycleData
      );

      return {
        content: [{ type: "text", text: html + getChainHint("get_metrics_dashboard") }],
      };
    })
  );
}

// ─────────────────────────────────────────────
// Dashboard HTML builder
// ─────────────────────────────────────────────
function buildDashboardHtml(
  days: number, totalTasks: number, successRate: number,
  avgQuality: string, avgRevisions: string, avgEstRatio: string,
  labels: string[], qualityData: number[], revisionData: number[], cycleData: number[]
): string {
  return `
<!DOCTYPE html><html><head><meta charset="utf-8">
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js"></script>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: var(--font-sans, sans-serif); color: var(--color-text-primary); padding: 16px; }
  h2 { font-size: 14px; font-weight: 500; margin-bottom: 12px; color: var(--color-text-secondary); }
  .header { margin-bottom: 20px; }
  .header h1 { font-size: 18px; font-weight: 500; }
  .header p { font-size: 13px; color: var(--color-text-secondary); margin-top: 4px; }
  .kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 20px; }
  .kpi { background: var(--color-background-secondary); border: 0.5px solid var(--color-border-tertiary);
         border-radius: 8px; padding: 14px; }
  .kpi-label { font-size: 11px; color: var(--color-text-secondary); margin-bottom: 4px; }
  .kpi-value { font-size: 22px; font-weight: 500; }
  .kpi-value.green { color: var(--color-text-success); }
  .kpi-value.amber { color: var(--color-text-warning); }
  .kpi-value.red { color: var(--color-text-danger); }
  .chart-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
  .chart-box { background: var(--color-background-secondary); border: 0.5px solid var(--color-border-tertiary);
               border-radius: 8px; padding: 14px; }
  .chart-single { background: var(--color-background-secondary); border: 0.5px solid var(--color-border-tertiary);
                  border-radius: 8px; padding: 14px; margin-bottom: 12px; }
  canvas { max-height: 180px; }
</style></head><body>

<div class="header">
  <h1>AI Dev Agent — Metrics Dashboard</h1>
  <p>${totalTasks} tasks · ${days} ngày gần nhất</p>
</div>

<div class="kpi-row">
  <div class="kpi">
    <div class="kpi-label">AI Success Rate</div>
    <div class="kpi-value ${successRate >= 70 ? "green" : successRate >= 50 ? "amber" : "red"}">${successRate}%</div>
  </div>
  <div class="kpi">
    <div class="kpi-label">Avg Code Quality</div>
    <div class="kpi-value ${Number(avgQuality) >= 4 ? "green" : Number(avgQuality) >= 3 ? "amber" : "red"}">${avgQuality}/5</div>
  </div>
  <div class="kpi">
    <div class="kpi-label">Avg Revisions</div>
    <div class="kpi-value ${Number(avgRevisions) <= 1 ? "green" : Number(avgRevisions) <= 2 ? "amber" : "red"}">${avgRevisions}×</div>
  </div>
  <div class="kpi">
    <div class="kpi-label">Est. Accuracy</div>
    <div class="kpi-value ${avgEstRatio === "N/A" ? "" : Number(avgEstRatio) <= 1.2 ? "green" : Number(avgEstRatio) <= 1.5 ? "amber" : "red"}">×${avgEstRatio}</div>
  </div>
</div>

<div class="chart-row">
  <div class="chart-box">
    <h2>Code Quality theo task</h2>
    <canvas id="qualityChart"></canvas>
  </div>
  <div class="chart-box">
    <h2>AI Revisions theo task</h2>
    <canvas id="revisionChart"></canvas>
  </div>
</div>

${cycleData.length > 0 ? `
<div class="chart-single">
  <h2>Cycle Time (giờ) theo task</h2>
  <canvas id="cycleChart"></canvas>
</div>` : ""}

<script>
const labels = ${JSON.stringify(labels)};
const colors = { blue: "#378ADD", green: "#639922", amber: "#BA7517", red: "#E24B4A", gray: "#888780" };

new Chart(document.getElementById("qualityChart"), {
  type: "line",
  data: {
    labels,
    datasets: [{
      label: "Code Quality",
      data: ${JSON.stringify(qualityData)},
      borderColor: colors.blue,
      backgroundColor: colors.blue + "22",
      tension: 0.3,
      fill: true,
      pointRadius: 4,
    }]
  },
  options: {
    plugins: { legend: { display: false } },
    scales: {
      y: { min: 0, max: 5, ticks: { stepSize: 1 },
           grid: { color: "rgba(128,128,128,0.1)" } },
      x: { grid: { display: false }, ticks: { maxRotation: 0, maxTicksLimit: 6 } }
    }
  }
});

new Chart(document.getElementById("revisionChart"), {
  type: "bar",
  data: {
    labels,
    datasets: [{
      label: "Revisions",
      data: ${JSON.stringify(revisionData)},
      backgroundColor: ${JSON.stringify(revisionData)}.map(v =>
        v === 0 ? colors.green + "cc" : v <= 2 ? colors.amber + "cc" : colors.red + "cc"
      ),
      borderRadius: 4,
    }]
  },
  options: {
    plugins: { legend: { display: false } },
    scales: {
      y: { beginAtZero: true, ticks: { stepSize: 1 },
           grid: { color: "rgba(128,128,128,0.1)" } },
      x: { grid: { display: false }, ticks: { maxRotation: 0, maxTicksLimit: 6 } }
    }
  }
});

${cycleData.length > 0 ? `
new Chart(document.getElementById("cycleChart"), {
  type: "bar",
  data: {
    labels: ${JSON.stringify(labels.filter((_, i) => revisionData[i] !== undefined).slice(0, cycleData.length))},
    datasets: [{
      label: "Cycle Time (h)",
      data: ${JSON.stringify(cycleData)},
      backgroundColor: colors.blue + "99",
      borderRadius: 4,
    }]
  },
  options: {
    plugins: { legend: { display: false } },
    scales: {
      y: { beginAtZero: true, grid: { color: "rgba(128,128,128,0.1)" } },
      x: { grid: { display: false }, ticks: { maxRotation: 0, maxTicksLimit: 8 } }
    }
  }
});` : ""}
</script></body></html>`;
}