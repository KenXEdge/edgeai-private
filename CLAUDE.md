# EDGEai — Claude Code Standing Rules

## Credentials & Sensitive Data
- NEVER display full API keys, tokens, UUIDs, Stripe keys, Supabase keys, or any credential
- Always truncate to first 4 characters followed by **** in all chat output
- NEVER paste or suggest pasting .env contents into chat
- NEVER expose entity structure details in any EDGEai output

## Git & Deploy
- git push auto-deploys to Vercel — always show diff and get Ken approval before pushing
- Exception: brand new standalone pages may push without approval
- Never push credentials, keys, or sensitive values to git under any circumstance

## Code Rules
- Node.js only — Python is NOT installed on this machine
- Never recreate logo geometry — use PNG files only: logo-edge-white.png and logo-edge-black.png
- Never set height/width CSS on logo img tag
- gmail_service() must never cache globally — every call builds fresh
- SMS_ENABLED=false — do not flip until Telnyx is live and tested
- Stripe is in TEST mode — do not flip to live until Ken instructs
- n8n workflows are ARCHIVED — do not unarchive

## Supabase
- Never alter Ken's carriers row e84dfb58**** — all broker/response/outreach history tied to it
- Never cross-contaminate or delete production data without explicit Ken approval

## Brand — All Locked
- Platform name: EDGE (spoken) — XEdge (product)
- Agent name: ACE — Agentic Carrier Employee
- Taglines: Carriers gain an edge. / First bid wins. / Be the ACE card.
- CTA copy: Request Access — never Start Free Trial
- Pricing copy: Month-to-month — never No credit card required
- Footer: © 2026 XTX LLC · All rights reserved · xedge-ai.com
