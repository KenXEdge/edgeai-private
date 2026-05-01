# XEdge — PitchBook
**Version:** 1.2 | **Date:** May 1, 2026 | **Company:** XTX LLC | **Founder:** Ken Korbel

---

## Executive Summary

EDGE is an agentic AI platform conceived and built as a solo founder project — from zero to production in weeks using Claude Code and AI-assisted development. EDGE puts ACE, an Agentic Carrier Employee, inside every small carrier's Gmail inbox. ACE monitors broker emails 24/7, alerts the carrier the instant a load offer arrives, and briefs them every morning so they start the day ahead. The result: small carriers compete on response time with fleets ten times their size — without hiring a dispatcher.

**Entity structure:**
- **XTX LLC** — parent entity (Wyoming)
- **EDGE** — AI automation platform (this product)
- **XTX Transport** — separate operating context (Ken's own motor carrier operation, MC# active)
- **ACE** — the AI agent inside EDGE

---

## 1. The Problem

### The Spot Freight Reality

Every day, freight brokers post hundreds of load offers via email. The spot freight market is winner-take-first — the broker calls the first carrier who responds, not the best carrier or the cheapest carrier. **First bid wins.**

Owner-operators and small fleets are on the road, at the dock, or asleep when these offers arrive. By the time they check email, the load is gone.

### The Dispatcher Problem

Traditional dispatchers solve this — but at $1,500–3,000/month, they are out of reach for owner-operators. And even dispatchers who manage multiple carrier clients do it manually: phone, email, spreadsheets. There is no automation layer. A dispatcher managing 10 carriers has 10 inboxes to watch, no unified view, and no AI assist.

The freight market has a two-sided gap: carriers need real-time response without a dispatcher, and dispatchers need automation tools to scale beyond manual labor.

---

## 2. The Solution — EDGE + ACE

**ACE** connects to a carrier's Gmail via OAuth. It watches for broker emails around the clock, classifies each one using Claude AI, and texts the carrier the moment a load offer arrives. Setup takes under 10 minutes. No hardware. No dispatcher. No long-term contract.

**ACE Morning Brief** — every morning at the carrier's configured time, ACE sends a daily SMS with the carrier's active focus zone and top broker activity. The carrier can text back a city, state, or ZIP to shift ACE's routing focus for the day. ACE adapts instantly. No app. No dashboard login required. Just a text.

The Morning Brief is where the relationship starts — ACE and the carrier, talking every day, building a working rhythm. That daily touchpoint is the moat. No load board app has it. No dispatcher tool has it. It is the difference between a tool and a teammate.

**ACE Scout** (next build) — ACE extends into Sylectus load boards, scraping load postings, extracting broker emails, and initiating outreach through the carrier's own Gmail — building the broker network automatically. The Scout is where ACE stops being reactive and starts being proactive: finding loads, finding brokers, initiating contact on the carrier's behalf.

The long-term vision: ACE doesn't just alert. ACE responds. ACE negotiates rate. ACE books the load. The carrier drives.

---

## 3. How It Works

```
Broker sends email
  → ACE intercepts via Gmail Watch (Google Pub/Sub)
  → Claude Haiku classifies: load_offer / positive / negative / question
  → If load_offer → SMS alert fires to carrier immediately
  → Broker relationship logged and scored in dashboard
  → Carrier responds first → Carrier wins the load

Every morning at outreach_time:
  → ACE Morning Brief SMS fires via n8n scheduler
  → Active focus zone + top broker activity summary
  → Carrier replies with city/state/ZIP to shift today's focus
  → ACE routes load offer alerts to the new zone all day

ACE Scout (next build):
  → Scrapes Sylectus for new load postings
  → Extracts broker emails from postings
  → Inserts to brokers table
  → Sends initial outreach via carrier's Gmail OAuth
```

---

## 4. Product

**Platform:** EDGE at xtxtec.com
**Agent:** ACE — Agentic Carrier Employee
**Stack:** React dashboard (Vercel) + Python/Flask backend (Google Cloud Run) + Supabase + Claude Haiku + Gmail API + Telnyx SMS + Resend email + n8n

**Feature set:**

| Feature | Status |
|---------|--------|
| Gmail inbox monitoring 24/7 | Live |
| Claude AI email classification | Live |
| SMS alert on load_offer | Built — Telnyx pending |
| Broker tracking — hot/warm/cold | Live |
| ACE Morning Brief daily SMS | Built — wiring pending |
| Active focus zone — SMS + dashboard input | Built |
| Load board email separation | Live |
| Carrier dashboard — brokers, responses, wins | Live |
| Broker extraction from SENT mail | Live |
| ACE Scout — Sylectus automation | Designed |
| Two-way SMS loop (Base Plus) | Designed |
| Dispatcher Pro multi-carrier dashboard | Roadmap |

---

## 5. Load Board Intelligence

ACE monitors and separates load board alerts from broker relationship emails. Each source has a distinct email path and SMS alert format.

| Load Board | Sender Domain | Signal Type | ACE Action |
|------------|--------------|-------------|------------|
| DAT | alerts@dat.com | Load match alert | Parse → SMS if equipment match |
| Truckstop | notifications@truckstop.com | Load match alert | Parse → SMS if equipment match |
| Spot (NTG) | noreply@spotinc.com / loadmatches@ntgfreight.com | Load offer | Parse → SMS if equipment match |
| Sylectus | ACE Scout (scrape) | Load postings | Extract broker email → outreach |
| ArcBest / TQL | Inbound broker email | Direct load offer | Classified by Claude → load_offer path |

Load board emails are intercepted before the broker lookup path — they bypass Claude classification and go directly to a structured parse → equipment match → SMS pipeline.

---

## 6. Market

**Target:** Owner-operators and small fleets (1–5 trucks) in the United States

**Market size:**
- ~3.5 million commercial truck drivers in the US
- ~500,000 registered carrier operations (FMCSA)
- ~200,000 owner-operators actively bidding spot freight
- ~15,000 independent freight dispatchers managing carrier fleets

**Why now:** AI APIs are cheap enough that per-carrier classification costs pennies per day. Gmail API OAuth is free. Cloud Run scales to zero. The spot freight market already runs on SMS and email — no new behavior required from the carrier. The infrastructure cost to serve 10,000 carriers is trivial.

---

## 7. Go-To-Market

### GTM Channels

**FMCSA database — 1M+ carrier contacts**
Every registered motor carrier in the US is in the FMCSA database with email, MC#, and address. This is the most targeted B2B contact list in freight. Direct outreach to owner-operators with a specific, relevant pain message — not generic SaaS.

**Facebook freight forums**
Owner-operator and small fleet Facebook groups have 50K–500K members each. These carriers talk about missing loads, broker relationships, and dispatcher costs daily. EDGE fits the conversation exactly.

**Dispatcher cluster acquisition**
Independent freight dispatchers manage 5–20 carrier relationships each. One dispatcher converted to EDGE brings their entire carrier roster. Target dispatcher forums, Facebook groups, and load board communities. The Dispatcher Pro tier aligns incentives — the dispatcher gets their own multi-carrier dashboard, ACE watches every inbox they manage, and they stop juggling 10 separate email tabs manually. Dispatcher cluster acquisition is a force multiplier: one sale = up to 20 carrier seats.

### Four-Phase Vision

| Phase | Description | Milestone |
|-------|-------------|-----------|
| 1 — Tool | ACE as a standalone tool for individual carriers | 500 paying carriers |
| 2 — Network | Broker relationship data aggregated across carriers creates a network signal — which brokers pay well, which are slow | 2,000 carriers, broker scoring live |
| 3 — Preferred Network | Carriers in the EDGE network get preferential load matching — brokers target EDGE carriers for fast response | 5,000 carriers, broker partnership |
| 4 — Augment Partnership | EDGE integrates with Augment and similar dispatcher tools — ACE handles carrier inbox layer, Augment handles dispatcher workflow layer | Integration live |

---

## 8. Pricing

| Tier | Price | Positioning |
|------|-------|-------------|
| Base | $47/mo | Solo owner-operator — 24/7 monitoring, SMS alerts, Morning Brief |
| Base Plus | $97/mo | Small fleet — adds two-way SMS loop with ACE |
| Dispatcher Pro | $297/mo | Dispatcher managing multiple carriers — multi-carrier dashboard |

**Month-to-month.** No lock-in. Cancel anytime.

A carrier who wins one extra load per month at $1,500 average revenue covers Base tier 30x over.

---

## 9. Competitive Analysis

| Factor | EDGE / ACE | Traditional Dispatcher | Load Board Apps | Augment |
|--------|-----------|----------------------|-----------------|---------|
| Works in existing Gmail | Yes | No | No | No |
| 24/7 availability | Yes | No | Partial | Yes |
| AI classification | Yes | No | No | Yes |
| Morning Brief / proactive SMS | Yes | Manual call | No | No |
| Active focus zone routing | Yes | Manual | No | No |
| Two-way SMS with AI | Base Plus | No | No | No |
| Multi-carrier dispatcher view | Dispatcher Pro | Spreadsheets | No | Partial |
| Per-carrier cost | $47–297/mo | $1,500–3,000/mo | $50–150/mo | Unknown |
| Broker relationship scoring | Yes | Manual | No | Partial |
| Setup time | <10 min | Weeks | Hours | Unknown |
| No new app for carrier | Yes (SMS + Gmail) | No | No | No |

### Augment — competitive analysis and partnership angle

Augment operates in the dispatcher workflow management layer. EDGE operates at the carrier Gmail inbox layer. These are architecturally complementary, not competing.

- Augment's user is the dispatcher
- EDGE's user is the carrier (and in Dispatcher Pro, also the dispatcher)
- Augment manages dispatch task flow; EDGE automates the carrier's email response layer

**Partnership angle:** A dispatcher using Augment currently has no automated way to monitor carrier inboxes. EDGE's Dispatcher Pro tier could integrate directly — Augment dispatchers use EDGE to watch their carrier fleet's Gmail, surface load offers, and route Morning Briefs. The ACE Scout module adds broker discovery that benefits both sides. This is a natural Phase 4 integration.

---

## 10. Traction

- Platform live at xtxtec.com — production on Vercel + Google Cloud Run
- Stripe billing integrated (TEST mode — ready to flip live)
- Full onboarding flow live: OTP signup (8-digit, Magic Link via Resend) → subscribe → onboard → Gmail OAuth → ACE live
- Gmail OAuth confirmed connected — live on production
- Stripe webhook confirmed working — subscription activation end-to-end
- ACE Morning Brief built — n8n scheduler, inbound SMS parser, dashboard input, midnight reset
- Active focus zone routing live — classification uses active_focus_zip when set
- ACE Scout designed — Sylectus automation module queued for next build cycle
- Founder (Ken) onboarding as first production carrier at $0 cost
- Supabase schema fully operational — carriers, brokers, responses, load_wins, gmail_sync
- Load board intelligence live — DAT, Truckstop, Spot, NTG on separate parse + SMS path

---

## 11. Team

**Ken Korbel — Founder**

Career background: IBM, payments industry, public finance (CFO and CSBO roles). Active motor carrier operator — MC# live, XTX Transport operating. Built EDGE to solve a problem he lives as a carrier: missing load offers while on the road.

Built the entire platform solo using Claude Code and AI-assisted development — from zero to production in weeks. This is the build velocity that EDGE will bring to operations as it scales.

Company: XTX LLC (Wyoming). Platform: EDGE. Agent: ACE.

---

## 12. Ask

EDGE is pre-revenue but production-ready. Seeking:

- **$150K seed** — covers 18 months runway, first 500 carrier signups, Telnyx SMS integration, Google OAuth verification, dispatcher partner program launch, ACE Scout build
- **Strategic partners** — freight brokerages, load board operators (Sylectus partnership for ACE Scout), independent dispatcher agencies, Augment integration

**Use of funds:**
- 40% — Carrier acquisition (FMCSA outreach + Facebook + dispatcher cluster program)
- 30% — Engineering (ACE Scout, multi-carrier architecture, two-way SMS, mobile app)
- 20% — Operations (support, infrastructure, legal, Google OAuth verification)
- 10% — Marketing + brand

---

## 13. Vision

ACE is the first AI employee every small carrier can afford.

The Morning Brief is where the relationship starts — ACE and the carrier, talking every day, building a working rhythm. That daily touchpoint is the moat. No load board app has it. No dispatcher tool has it. It is the difference between a tool and a teammate.

The Scout is where ACE stops being reactive and starts being proactive — finding loads, finding brokers, initiating contact on the carrier's behalf.

The network is where EDGE becomes infrastructure — broker relationship data aggregated across thousands of carriers, creating a signal no individual carrier or dispatcher can see.

**EDGE: Carriers gain an edge.**

---

*XEdge PitchBook v1.2 | XTX LLC | May 1 2026 | ken@xtxtec.com | xtxtec.com*
