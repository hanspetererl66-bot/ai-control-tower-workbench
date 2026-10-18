insert into control_tower.meta (id,version,note,risk_threshold_pct,agents_total,agents_production,agents_unregistered,agents_overprivileged,discovery_more_note,discovery_more_status,discovery_more_status_tone,overprivileged_rest_severity,overprivileged_rest_description,access_tier_target,budget_total_actual_m,budget_ceiling_m) values
(1,1,'Illustrative sample data. Source of truth for the AI Control Tower space; embedded into index.html by `npm run sync:control-tower`.',40,186,125,47,31,'Azure ML, Salesforce Einstein, internal Python/OpenAI, LangChain scripts, various n8n flows','Queued','gr','high','Various n8n, BTP monitoring, ABAP assist, OData agents. All queued Q1 2027 review.','Target: 0 full write/admin agents by Q1 2027.',2.74,3.6);

insert into control_tower.risks (id,sort_order,severity,title,description,owner,owner_team,eta,eta_tone,progress_pct,progress_color,progress_note,action,tile,short) values
('R1',0,'high','AI-driven instability spike','CFR 9.1% ↑, Rework 12.8% ↑. ~1,500 extra failed deploys/month at 30k scale.','VP Engineering','CTO Office','Q1 2027','red',20,'red','Test gate spec done; implementation pending','Mandatory AI-PR test gates in design. CFR dashboard alert threshold set at 8%.','Instability spike','Instability'),
('R2',1,'high','Overprivileged agent identities (31)','10 agents with full admin write to SAP S/4HANA & BTP prod. 21 exceed least-privilege scope.','CISO','Platform Security','Dec 2026','red',35,'amber','11 of 31 agents re-scoped','Weekly remediation sprints. 2 critical (L2C orch + report bot) blocked on SAP API key reissue.','Overprivileged agents','Overprivileged agents'),
('R3',2,'high','47 unregistered AI assets','BTP extension agent (confidential data), n8n prod LLM node, Joule skill #7 + 44 more. No owner, no token cap.','AI Platform Lead','AI Platform Team','Jan 2027','amber',26,'amber','12 of 47 triaged; 4 registered; 8 blocked','BTP extension agent escalated to CISO. Auto-registration pipeline under review.','Unregistered assets','Unregistered assets'),
('R4',3,'high','Hallucination in financial outputs','14 incidents/month. AI-generated SAP GL figures used in reports without HITL gate.','CFO Office','L2C Agent Owner','Dec 2026','red',58,'amber','7 of 12 finance agents gated','HITL gate design complete. 7 deployed, 5 pending ServiceNow workflow integration.','Hallucinations in finance','Hallucinations in finance'),
('R5',4,'medium','Shadow AI (89 flagged accounts)','Personal ChatGPT / Claude accounts. Real number estimated 10× higher at 30k scale. No auditability.','CISO / HR','IT Security','Q4 2026','amber',45,'blue','SSO enforced for 40 of 89 flagged accounts','Acceptable use policy refresh published. Network egress block on personal AI endpoints pending.','Shadow AI accounts (89)','Shadow AI'),
('R6',5,'medium','EU AI Act — 18 high-risk agents','18 agents require conformity assessment before Feb 2027 audit. 10 outstanding.','General Counsel','Legal & Compliance','Feb 2027','blue',44,'purple','8 of 18 assessments complete','External assessor engaged. Remaining 10 scheduled Dec–Jan. Audit prep kicked off.','EU AI Act assessments outstanding (10/18)','EU AI Act'),
('R7',6,'low','Prompt injection via untrusted content','Agents reading external emails, docs, web content. 0 confirmed incidents this quarter.','Security Eng.','Platform Security','Done','green',100,'green','Content isolation active on all 186 agents','Monitoring alerts configured. Quarterly red-team exercise scheduled Q1 2027.','Prompt injection defence 100% complete across all 186 agents','Prompt injection');

insert into control_tower.agent_types (key,sort_order,label,tone,count,description,examples) values
('autonomous',0,'Autonomous','b',58,'End-to-end, no HITL. Schedule / event triggered. CISO sign-off required.','SAP SPC ticket routers (8) · OData enrichment pipelines (6) · Report gen bots (7) · Shift roster sync (4) · Contract classification (5) · BTP monitoring (5) · +23 more'),
('copilot',1,'Copilot','p',97,'Assist human in real-time. Draft, suggest, enrich — human approves output.','L2C deal advisors (12) · ABAP code assistants (18) · Contract drafters (9) · Presales proposal gen (8) · Fiori UX reviewer (6) · +44 more'),
('orchestrator',2,'Orchestrator','a',31,'Coordinate multi-agent pipelines. Architecture board review required.','L2C pipeline orchestrators (6) · BTP deploy coordinators (5) · n8n workflow builders (8) · Test suite generators (4) · +8 more');

insert into control_tower.discovery_assets (asset,sort_order,source,model,first_seen,signal_tone,signal,status_tone,status) values
('BTP Extension Agent (prod)',0,'SAP BTP','GPT-4o · Azure OpenAI','2026-05-18','r','High — confidential data','a','Pending review'),
('n8n LLM Node (prod pipeline)',1,'n8n Cloud','Claude Sonnet 4.6','2026-05-20','a','Med — no token cap','a','Pending review'),
('Joule Custom Skill #7',2,'SAP AI Core','SAP proprietary','2026-05-21','a','Med — unclassified','a','Pending review'),
('Cursor AI Agent batch (6 devs)',3,'Cursor IDE','GPT-4.1','2026-05-22','g','Low — dev env only','b','Auto-register');

insert into control_tower.overprivileged_queue (name,sort_order,severity,count,description) values
('L2C pipeline orchestrator (3 instances)',0,'critical',3,'Admin write access to SAP S/4HANA prod. Least-privilege reissue in progress. Owner: Eng Leads.'),
('Report gen bots (4 instances)',1,'critical',4,'Admin BTP credentials inherited from setup. Blocking Q1 2027 audit. Reissue escalated.'),
('Contract drafters (Icertis, 3)',2,'high',3,'Read all templates, not assigned scope. Access narrowing scheduled Dec 2026.');

insert into control_tower.access_tiers (label,sort_order,count,color) values
('Read-only',0,74,'green'),
('Read + limited write',1,41,'amber'),
('Full write / admin',2,10,'red');

insert into control_tower.budget_groups (name,sort_order,budget_k,utilisation_pct,color) values
('Engineering',0,1100,107,'red'),
('Sales & Presales',1,560,88,'amber'),
('Product & Design',2,420,76,'purple'),
('Operations',3,360,62,'green'),
('Finance',4,280,104,'red'),
('HR / L&D',5,182,46,'green');