# XEdge — PitchBook
**Version:** 1.1 | **Date:** April 25, 2026 | **Company:** XTX LLC | **Founder:** Ken Korbel

---

## 1. The Problem

Every day, freight brokers send hundreds of load offers to carriers via email. Owner-operators and small fleets are on the road, at the dock, or asleep — they miss these offers. By the time they check their inbox, the load is gone.

**In freight: first bid wins.**

Small carriers cannot compete with large fleets that have full-time dispatchers watching email all day. The playing field is uneven — not because of trucks or talent — but because of response time.

Dispatchers face the same problem from the other side: they work multiple carriers manually, juggling email, phone, and load boards with no automation layer. The entire spot freight market runs on reaction speed — and everyone is under-tooled.

---

## 2. The Solution — EDGE

**EDGE** gives every carrier a 24/7 automated dispatcher in their Gmail inbox.

**ACE** (Agentic Carrier Employee) connects to a carrier's Gmail via OAuth, watches for broker emails around the clock, classifies each message using Claude AI, and texts the carrier the moment a load offer arrives.

Every morning, ACE sends a **Morning Brief** — a daily SMS with the carrier's active focus zone and top broker activity — so they start the day ready to move, not catching up.

No more missed loads. No more lost revenue. No more losing to carriers who happen to be awake.

---

## 3. How It Works

```
Broker sends email
  → ACE intercepts via Gmail Watch (Google Pub/Sub)
  → Claude Haiku classifies: load_offer / positive / negative / question
  → If load_offer → SMS alert fires to carrier immediately
  → Broker relationship tracked in dashboard
  → Carrier responds first → Carrier wins the load

Every morning at outreach_time:
  → ACE Morning Brief SMS fires
  → Active focus zone + broker activity summary
  → Carrier sets today's focus zone via SMS reply or dashboard
  → ACE routes load offers to the right zone all day
```

Setup takes under 10 minutes. No hardware. No dispatcher. No long-term contract.

---

## 4. Product

**Platform:** EDGE (spoken) — XEdge (product) at xtxtec.com
**Agent:** ACE — Agentic Carrier Employee
**Parent Entity:** XTX LLC
**Stack:** React dashboard (Vercel) + Python/Flask backend (Google Cloud Run) + Supabase + Claude Haiku + Gmail API + Telnyx SMS + Resend email

**Key Features:**
- Gmail inbox monitoring — real-time, 24/7
- AI email classification — load offers, relationship signals, questions
- Instant SMS alerts on hot leads
- ACE Morning Brief — daily SMS at configured time with active focus zone
- Active focus zone — carrier sets zone by SMS or dashboard; classification routes to it
- Broker relationship tracking and scoring (hot/warm/cold)
- Load board email separation (DAT, Truckstop, Spot, NTG)
- Full carrier dashboard — brokers, responses, wins, focus zone
- Stripe subscription billing — month-to-month

---

## 5. Market

**Target:** Owner-operators and small fleets (1–5 trucks) in the United States

**Market Size:**
- ~3.5 million commercial truck drivers in the US
- ~500,000 registered carrier operations
- ~200,000 owner-operators actively bidding spot freight
- ~15,000 freight dispatchers operating independently or in small agencies

**Why now:** AI APIs (Claude) are cheap enough that per-carrier classification costs pennies per day. Gmail API OAuth is free. Cloud Run scales to zero — cost is near-zero until revenue arrives. The spot freight market runs on SMS and email — no new behavior required from the carrier.

**Two-sided market opportunity:** EDGE serves carriers directly. The same infrastructure — broker relationship data, load offer patterns, response rates — creates a parallel value layer for freight dispatchers managing multiple carrier clients. Dispatcher cluster acquisition is a GTM multiplier: one dispatcher brings 5–20 carrier relationships.

---

## 6. Go-To-Market

### Phase 1 — Founder Carrier (Now)
- Ken onboards as first production carrier at $0
- Full end-to-end validation: signup → Gmail OAuth → broker extraction → ACE live → Morning Brief

### Phase 2 — First 50 Carriers (Q2 2026)
- FMCSA carrier database — 1M+ registered carrier contacts with email and MC#
- Facebook freight carrier and owner-operator groups — direct community outreach
- Dispatcher cluster acquisition — target independent dispatchers managing 5–20 carriers each; one dispatcher converts to 5–20 carrier activations

### Phase 3 — First 500 Carriers (Q3 2026)
- Paid acquisition via freight forums, Facebook, and trucking YouTube
- Referral loop: carrier who wins a load credits EDGE — built-in word-of-mouth
- Dispatcher partner program — revenue share for dispatcher-referred carriers

### Phase 4 — Platform Expansion (Q4 2026+)
- Multi-carrier architecture (current: single-carrier per deployment)
- ACE responds, not just alerts — automated broker reply with carrier's rate
- ACE negotiates — rate negotiation flow before human handoff
- Mobile app for on-the-road access
- Broker outreach module — ACE proactively contacts new brokers on carrier's behalf

---

## 7. Pricing

| Tier | Price | Positioning |
|------|-------|-------------|
| Base | $47/mo | Solo owner-operator — ACE monitoring, SMS alerts, Morning Brief |
| Custom | $97/mo | Small fleet (2–5 trucks) — custom lane rules, priority SMS |
| Premium | $349 setup + custom | Enterprise / fleet operators — white-glove setup + custom reporting |

**Month-to-month.** No lock-in. Cancel anytime.

A carrier who wins one extra load per month at $1,500 average revenue covers the Base tier cost 30x over.

---

## 8. Competitive Analysis

| Factor | EDGE / ACE | Traditional Dispatcher | Load Board Apps | Augment |
|--------|-----------|----------------------|-----------------|---------|
| Works in existing Gmail | Yes | No | No | No |
| 24/7 availability | Yes | No | Partial | Yes |
| AI classification | Yes | No | No | Yes |
| Morning Brief / proactive SMS | Yes | Manual call | No | No |
| Active focus zone routing | Yes | Manual | No | No |
| Per-carrier cost | $47–97/mo | $1,500–3,000/mo | $50–150/mo | Unknown |
| Broker relationship tracking | Yes | Manual | No | Partial |
| Setup time | <10 min | Weeks | Hours | Unknown |
| No new app for carrier | Yes (SMS) | No | No | No |

**Partnership angle — Augment:** Augment and similar AI dispatcher tools operate in the dispatch management layer. EDGE operates at the carrier inbox layer. These are complementary, not competing — Augment manages the dispatcher workflow; EDGE automates the carrier's email response layer. Partnership or integration opportunity: Augment dispatchers use EDGE to monitor their carrier fleet's inboxes from one pane.

---

## 9. Traction

- Platform live at xtxtec.com — production on Vercel + Google Cloud Run
- Stripe billing integrated (TEST mode — ready to flip live)
- Full onboarding flow live: signup → OTP (8-digit) → subscribe → onboard → Gmail OAuth → ACE live
- Gmail OAuth confirmed connected — live on production
- ACE Morning Brief built — daily SMS via n8n at carrier outreach_time
- Active focus zone routing live — SMS parser + dashboard input path
- Founder (Ken) onboarding as first production carrier at $0 cost
- Supabase schema fully operational: carriers, brokers, responses, load_wins, gmail_sync

---

## 10. Team

**Ken Korbel — Founder**
- Freight industry background — firsthand understanding of the carrier load-response problem
- Owner-operator experience — built this to solve a problem he lived
- Built entire platform solo using Claude Code + AI-assisted development
- Company: XTX LLC (Wyoming) — platform brand: EDGE / XEdge

---

## 11. Ask

EDGE is pre-revenue but production-ready. Seeking:

- **$150K seed** — covers 18 months runway, first 500 carrier signups, Telnyx SMS integration, Google OAuth verification, dispatcher partner program launch
- **Strategic partners** — freight brokerages, load board operators, independent dispatcher agencies, fleet management platforms

**Use of funds:**
- 40% — Carrier acquisition (first 500 paying carriers via FMCSA outreach + Facebook + dispatcher clusters)
- 30% — Engineering (multi-carrier architecture, ACE response/negotiation, mobile app, broker outreach module)
- 20% — Operations (support, infrastructure, legal, Google OAuth verification)
- 10% — Marketing + brand

---

## 12. Vision

ACE is the first AI employee every small carrier can afford. The long-term vision: ACE doesn't just alert — ACE responds. ACE negotiates rate. ACE books the load. The carrier drives.

The Morning Brief is the beginning of that relationship — ACE and the carrier, talking every day, building a working rhythm. That daily touchpoint is the moat. No load board app has it. No dispatcher app has it. It's the difference between a tool and a teammate.

**EDGE: Carriers gain an edge.**

---

*XEdge PitchBook v1.1 | XTX LLC | April 25 2026 | ken@xtxtec.com | xtxtec.com*
