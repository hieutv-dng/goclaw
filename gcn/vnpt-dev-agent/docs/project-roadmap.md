# Project Roadmap — vnpt-dev-agent

Tài liệu này theo dõi lộ trình phát triển, các mốc định hướng chính, và tiến độ dự án.

## Current Status (v1.0.0)

**Release Date:** 2026-03-26
**Status:** Stable Release
**Completion:** ~100% (Phase 1-4 implemented)

### What's Shipped
- ✅ 28 modules với 60+ MCP tools
- ✅ Jira integration (list, read, update, log work)
- ✅ Codebase discovery (6 frameworks supported)
- ✅ Task evaluation (complexity scoring)
- ✅ Security checks (7 domains)
- ✅ Quality gates (GWT, drift detection, pre-commit)
- ✅ Learning loop (feedback, metrics, insights)
- ✅ Session memory (save/load context)
- ✅ Team context management
- ✅ Plugin system (extensibility)

## Roadmap Phases

### Phase 1: Core MCP Tools (✅ COMPLETE)
**Timeline:** Month 1
**Goals:**
- Jira REST API integration
- Basic codebase reading
- Tool registration & MCP protocol

**Deliverables:**
- [x] jira/ module (7 tools)
- [x] codebase/ module (5 tools)
- [x] Jira client (axios)
- [x] Error handling wrapper
- [x] MCP server setup

**Metrics:**
- All 12 core tools functional
- Jira authentication working
- File scanning responds < 1s

---

### Phase 2: Code Discovery & Analysis (✅ COMPLETE)
**Timeline:** Month 1-2
**Goals:**
- Multi-framework file detection
- Intelligent relevance scoring
- Task complexity evaluation

**Deliverables:**
- [x] CodebaseReader (framework detection)
- [x] SmartScorer (multi-signal ranking)
- [x] Stack profiles (6 frameworks)
- [x] evaluator/ module (1 tool)
- [x] Task kickoff workflow

**Metrics:**
- SmartScorer top-5 accuracy > 80%
- Framework detection accuracy > 90%
- Analysis < 500ms for 100 files

---

### Phase 3: Quality & Standards (✅ COMPLETE)
**Timeline:** Month 2-3
**Goals:**
- Enforce code quality standards
- Security-first checks
- Requirement drift detection
- Format compliance validation

**Deliverables:**
- [x] gwt/ module (Given-When-Then validation)
- [x] security/ module (7 domain checklist)
- [x] drift/ module (requirement change detection)
- [x] parser/ module (description parsing)
- [x] quality-gate/ module (pre-commit checks)
- [x] git-standard/ module (workflow standards)

**Metrics:**
- GWT grade A-F working
- 7 security domains covered
- Drift detection accuracy > 85%
- Quality gate coverage 100%

---

### Phase 4: Learning Loop & Extensions (✅ COMPLETE)
**Timeline:** Month 3-4
**Goals:**
- Feedback-based learning
- Metrics tracking & insights
- Session persistence
- Extensibility via plugins

**Deliverables:**
- [x] feedback/ module (3 tools)
- [x] metric-stores/ module (3 tools)
- [x] session/ module (3 tools)
- [x] team-context/ module (2 tools)
- [x] plugin system (loadProjectPlugins)
- [x] knowledge sharing (cross-project)
- [x] impact analysis (dependency graph)
- [x] PR auto-generation
- [x] Worklog auto-generation
- [x] Estimation suggestion

**Metrics:**
- Feedback store persistent
- Metrics aggregation working
- Session load/save < 100ms
- Plugin reload functional

---

### Phase 5: Dashboard & Reporting (⏳ PLANNED)
**Timeline:** Month 4-5
**Status:** Not started
**Goals:**
- Web dashboard for metrics visualization
- Team performance dashboard
- Trend analysis
- Automated reporting

**Deliverables:**
- [ ] React dashboard (Vite)
- [ ] Metrics API endpoints
- [ ] Real-time updates
- [ ] Export to CSV/PDF
- [ ] Weekly digest emails

**Estimated Effort:** 3-4 weeks
**Dependencies:** Phase 4 complete

---

### Phase 6: Enterprise Features (📋 BACKLOG)
**Timeline:** Month 5-6+
**Status:** Planned
**Goals:**
- Multi-Jira instance support
- Team-level configuration
- Advanced permission model
- Audit logging

**Deliverables:**
- [ ] Multi-tenant architecture
- [ ] Jira instance registry
- [ ] RBAC (role-based access)
- [ ] Audit trail
- [ ] Encryption for sensitive data

**Estimated Effort:** 4-6 weeks
**Dependencies:** Dashboard, feedback on multi-team usage

---

### Phase 7: AI Enhancements (🔮 FUTURE)
**Timeline:** Month 6+
**Status:** Exploration
**Goals:**
- ML-based code quality prediction
- Anomaly detection in metrics
- Intelligent workload balancing
- Proactive risk detection

**Deliverables:**
- [ ] Training pipeline for feedback data
- [ ] ML model for complexity prediction
- [ ] Anomaly detection service
- [ ] Trend forecasting

**Estimated Effort:** 8+ weeks
**Dependencies:** Large feedback dataset, Phase 5 complete

---

## Key Milestones

| Date | Milestone | Status | Notes |
|------|-----------|--------|-------|
| 2026-03-26 | v1.0.0 Release | ✅ Done | Core + Learning loop shipped |
| 2026-04-26 | v1.1.0 (Polish) | ⏳ Next | Docs, examples, template fixes |
| 2026-05-26 | v1.2.0 (Dashboard) | 📋 Planned | Web UI for metrics |
| 2026-06-26 | v2.0.0 (Enterprise) | 📋 Planned | Multi-tenant, RBAC |
| 2026-07-26 | v2.1.0 (AI/ML) | 🔮 Future | ML enhancements |

## Version Schedule

### v1.0.0 (Stable) — Now
**Features:** All Phase 1-4
**Support:** Critical bugs only

### v1.1.0 (Polish) — End of April
**Planned:**
- [ ] Comprehensive documentation
- [ ] Template improvements
- [ ] Example workflows per stack
- [ ] Performance optimizations
- [ ] Test suite (Jest)

### v1.2.0 (Dashboard) — End of May
**Planned:**
- [ ] Web UI (React + Vite)
- [ ] Metrics visualization
- [ ] Team performance charts
- [ ] Export & reporting

### v2.0.0 (Enterprise) — End of June
**Planned:**
- [ ] Multi-Jira instance support
- [ ] RBAC
- [ ] Audit logging
- [ ] API versioning

### v3.0.0 (AI/ML) — Future
**Planned:**
- [ ] ML-based predictions
- [ ] Anomaly detection
- [ ] Workload forecasting
- [ ] Advanced analytics

## Known Limitations (Current)

### Technical
1. **Single Jira Instance** — Not multi-tenant
   - Workaround: Deploy separate servers for different instances
   - Target Fix: v2.0.0

2. **No Test Suite** — Manual testing only
   - Impact: Slower regression detection
   - Target Fix: v1.1.0

3. **Local Storage Only** — No central metrics database
   - Impact: Can't aggregate metrics across team
   - Target Fix: v2.0.0

4. **No Codebase Indexing** — Scan-on-demand only
   - Impact: Slower on large codebases (1000+ files)
   - Target Fix: v1.1.0

### Feature Gaps
1. No real-time notifications
2. No Slack/Teams integration
3. No automated PR review
4. No code diff analysis
5. No time tracking accuracy prediction

## Community & Feedback

### Feedback Channels
- GitHub Issues: Bug reports, feature requests
- Internal Wiki: Team discussions, use cases
- Metrics Dashboard: Usage analytics (future)

### Contribution Guidelines
- Follow code-standards.md
- Test locally before PR
- Update docs if API changes
- Add feedback entry after each task

### Roadmap Voting
Features ranked by:
1. User feedback (surveys, GitHub issues)
2. Business value (adoption impact)
3. Technical complexity (effort estimate)
4. Dependencies (blocking other features)

## Success Criteria

### By Phase
- **Phase 1:** Core tools working, no crashes ✅
- **Phase 2:** File detection accurate > 80% ✅
- **Phase 3:** Quality gates enforced ✅
- **Phase 4:** Learning loop active ✅
- **Phase 5:** Dashboard 80% uptime
- **Phase 6:** Multi-tenant isolation verified
- **Phase 7:** ML models > 85% accuracy

### Overall
- Adoption: 5+ teams by end of 2026
- Usage: 50+ tasks/week by Q3 2026
- Quality: < 5% false positive in security checks
- Satisfaction: 4+ rating (1-5 scale)

## Dependencies & Blockers

### External Dependencies
- **Jira Cloud API:** Stable (Atlassian SLA)
- **Claude AI:** Stable (Anthropic)
- **Node.js:** v18+ (LTS)

### Current Blockers
None identified.

### Potential Blockers (Future)
1. Large codebase performance (>10,000 files)
   - Mitigation: Implement indexing, parallel scanning
2. ML training data insufficient
   - Mitigation: Collect feedback for 2-3 months first

## Team & Resources

### Current Team
- **Core Dev:** 1 FTE (TypeScript/Node.js)
- **QA:** Part-time (manual testing)
- **Product:** Part-time (roadmap, feedback)

### Resources Needed (If Scaling)
- **Dashboard Dev:** 1 FTE (React/Vite)
- **Infra/DevOps:** 0.5 FTE (deployment, monitoring)
- **Community Manager:** 0.5 FTE (docs, support)

## Budget & Timeline

### Estimated Effort
- **Phase 1-4:** 8 weeks (complete)
- **Phase 5:** 4 weeks (planned)
- **Phase 6:** 6 weeks (planned)
- **Phase 7:** 8 weeks (future)

**Total:** 26 weeks for all phases

### Resource Cost (Estimated)
- Dev salaries: ~$50K (assuming 1 FTE @ $200/day)
- Infrastructure: $0 (no servers, cloud-hosted Jira only)
- Tools & Services: ~$2K/year (npm packages, hosting if needed)

## Post-Launch Plans

### Metrics to Track
- Daily active teams
- Tasks per week (trend)
- Feedback submission rate
- Tool error rate
- User satisfaction (NPS)

### Support Plan
- GitHub issues (1-2 day response)
- Internal Slack channel
- Monthly team retrospectives
- Quarterly product reviews

### Continuous Improvement
- Monthly feature releases (minor)
- Quarterly major releases (v1.x, v2.x)
- Quarterly roadmap reviews
- Annual strategic planning

## References

- **Project Overview:** docs/project-overview-pdr.md
- **Code Standards:** docs/code-standards.md
- **System Architecture:** docs/system-architecture.md
- **Codebase Summary:** docs/codebase-summary.md
- **GitHub:** https://github.com/vnpt-dev/vnpt-dev-agent

---

**Last Updated:** 2026-03-26
**Next Review:** 2026-04-26 (post-v1.1.0 release)
**Owner:** VNPT Dev Team
