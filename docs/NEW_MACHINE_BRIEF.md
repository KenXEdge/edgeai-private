# NEW MACHINE BRIEF — Read Before Touching Anything
## May 4, 2026 | Paste this into Claude Code on the new machine

---

## YOUR ONLY JOB THIS SESSION

Re-run `/extract-brokers` for Ken's carrier account. The brokers table is empty. The code is correct and deployed. You just need to trigger the run and verify results.

---

## SYSTEM STATE RIGHT NOW

- **Cloud Run revision:** 00134 — ALREADY DEPLOYED, do not redeploy
- **main.py:** Correct version is on master (`9075c8e`) — `_scan_sent_and_enrich` is the function name
- **Brokers table:** Empty — previous run hit Anthropic rate limit mid-run
- **Code quality:** Stable. Best fill rates already achieved (00128: company 93%, name 92%, title 78%, phone 53%, lanes ~70%). Do not change the prompt, the enrichment logic, or the carrier identity filter.

---

## BEFORE RUNNING — ONE SQL MIGRATION REQUIRED

Apply this in Supabase dashboard → SQL Editor before triggering the run:

```sql
ALTER TABLE brokers ADD CONSTRAINT brokers_carrier_email_unique UNIQUE (carrier_id, email);
```

This prevents duplicate rows if the run is triggered more than once.

---

## HOW TO TRIGGER THE RUN

POST to the Cloud Run service:

```bash
curl -X POST https://edgeai-gmail-webhook-<hash>.run.app/extract-brokers \
  -H "Content-Type: application/json" \
  -d '{"carrier_id":"86fbcaf8-57fe-4f57-8388-10be3ec99e6c"}'
```

Or trigger from the dashboard onboard-gmail page if the UI is accessible.

---

## VERIFY RESULTS AFTER RUN

```sql
-- Fill rate check
SELECT
  COUNT(*) AS total,
  COUNT(name) AS has_name,
  COUNT(company) AS has_company,
  COUNT(phone) AS has_phone,
  COUNT(title) AS has_title,
  COUNT(last_load_origin) AS has_origin,
  COUNT(last_load_destination) AS has_dest,
  ROUND(COUNT(name)::numeric/COUNT(*)*100,1) AS pct_name,
  ROUND(COUNT(company)::numeric/COUNT(*)*100,1) AS pct_company,
  ROUND(COUNT(phone)::numeric/COUNT(*)*100,1) AS pct_phone
FROM brokers
WHERE carrier_id = '86fbcaf8-57fe-4f57-8388-10be3ec99e6c';

-- Contamination check — should return 0 rows
SELECT * FROM brokers
WHERE phone LIKE '%8688'
   OR company ILIKE '%XTX%'
   OR name ILIKE '%Korbel%';
```

Expected: ~147 rows, company ~93%, name ~92%, phone ~53%, 0 contamination rows.

---

## DO NOT TOUCH ANY OF THE FOLLOWING

| What | Why |
|------|-----|
| `services/gmail-webhook/main.py` | Code is correct and deployed. Any change triggers a redeploy and risks regression. |
| Claude prompt inside `_process_broker` | Took many iterations to get right. Unified prompt is intentional — do not split it. |
| `_strip_reply_quotes` function | Gentler version is intentional — aggressive version cut legitimate signature content. |
| `sent_context` line limit (30 lines) | 12 was tried and failed — 30 is correct. |
| Carrier identity filter logic | Domain token derivation (`xtxtransport` → `xtx`) was carefully tuned. Do not change token logic. |
| Cloud Run revision 00134 | Already deployed and correct. Do not redeploy unless Ken explicitly asks. |
| Ken's carriers row in Supabase | Never alter — carrier UUID is tied to auth.users.id |
| brokers table existing rows | Table is empty right now, but once the run completes do not delete or alter rows |
| deploy.sh REQUIRED_VARS | Twilio vars are intentional placeholders — SMS_ENABLED=false, Telnyx coming later |

---

## KEY FACTS

- **GCP account:** ken@xedge-ai.com (NOT korbs827@gmail.com)
- **Repo:** KenXEdge/edgeai-private, branch master
- **Latest commits:** f50dea2 (docs), 9075c8e (code — this is the one that matters)
- **`_scan_sent_and_enrich`** is the correct function name — if you see `_scan_inbox_and_enrich` in logs, the wrong main.py was deployed (old version — needs `git pull` then redeploy)
- **Anthropic rate limit:** If the run fails mid-way, wait a few minutes and re-run. The unique constraint prevents duplicates.
- **SMS_ENABLED=false** — do not change
- **Stripe is TEST mode** — do not change
- **n8n workflows are ARCHIVED** — do not unarchive

---

## IF SOMETHING BREAKS

Roll Cloud Run back to revision 00128 (best known-good extract-brokers config):

```bash
gcloud run services update-traffic edgeai-gmail-webhook \
  --to-revisions=edgeai-gmail-webhook-00128=100 \
  --region=us-central1 \
  --project=edgeai-493115
```

Full context in: `docs/Runbook_v8.2.md` and `docs/Transition_May04.md`

---

*NEW_MACHINE_BRIEF | May 4 2026 | XTX LLC*
