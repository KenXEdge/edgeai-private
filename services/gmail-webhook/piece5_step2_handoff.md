# Piece 5 Step 2 — Claude Code Handoff

**Target file:** `services/gmail-webhook/main.py`
**Source of truth:** EDGE Runbook v8.1 §12 Step 2 + §2 (locked decisions)

---

## CRITICAL — READ FIRST

Before performing any edit, confirm understanding of these constraints. If anything is ambiguous, STOP and ask before touching files.

### SCOPE
- Modify **exactly one** file: `services/gmail-webhook/main.py`
- Perform **exactly two** edits — no more
- Touch **nothing else** in the repository

### HARD CONSTRAINTS — violating any of these is a build failure
1. **DO NOT** modify any file other than `services/gmail-webhook/main.py`
2. **DO NOT** reformat, refactor, or "improve" any code outside the two specified anchor strings
3. **DO NOT** modify imports, comments, or formatting outside the specified anchors
4. **DO NOT** refactor or "clean up" adjacent functions
5. **DO NOT** commit, push, deploy, or run the application
6. **DO NOT** make additional edits even if you think they would help — STOP and ask first
7. **DO NOT** add tests, type stubs, or any auxiliary files
8. If a `str_replace` finds zero matches or multiple matches, STOP and report — do not guess
9. After both edits, run all four verifications — if any fail, run `git checkout services/gmail-webhook/main.py` to revert and report the failure

### WHAT THIS BUILD IS
Adds 14 helper functions to main.py for the Piece 5 load-offer action loop. All helpers are **additive dead code** — nothing calls them yet. Runtime behavior after these edits must be **identical to v8.0**. Step 5 (a later session) wires them in.

---

## EDIT 1 OF 2 — Add `import secrets` to top imports

Use `str_replace` with these exact strings.

**old_str:**
```python
import os
import json
import base64
import logging
import sys
import threading
```

**new_str:**
```python
import os
import json
import base64
import logging
import secrets
import sys
import threading
```

Only one line is added (`import secrets`). The rest of the import block is unchanged.

---

## EDIT 2 OF 2 — Insert Piece 5 helpers block

Insert the Piece 5 helpers block between the end of `send_unknown_broker_sms` and the `# ── Load board helpers ──` section header.

**old_str:**
```python
        log.info('"SMS sent — unknown broker load offer from=%s"', email_data["from_email"])
    except Exception as exc:
        log.error('"send_unknown_broker_sms failed: %s"', exc)


# ── Load board helpers ────────────────────────────────────────────────────────
```

**new_str:**
```python
        log.info('"SMS sent — unknown broker load offer from=%s"', email_data["from_email"])
    except Exception as exc:
        log.error('"send_unknown_broker_sms failed: %s"', exc)


# ══════════════════════════════════════════════════════════════════════════════
# ── Piece 5 — Load offer action loop helpers (additive, v8.1) ────────────────
#
# All helpers below are introduced by EDGE Runbook v8.1 Piece 5 build.
# They are NOT yet called from process_message — Step 2 of §12 (additive only).
# Step 5 of §12 will rewire process_message to call these.
# Until then, behavior is identical to v8.0.
# ══════════════════════════════════════════════════════════════════════════════

EDGE_LOAD_OFFER_TTL_MINUTES = 60
EDGE_SMS_BROKER_NAME_MAX = 20


def _generate_load_offer_tokens() -> tuple[str, str, str]:
    """Mint three opaque, non-semantic 6-character tokens for one load offer.
    Returns (book_token, rebid_token, pass_token). Per v8.1 §2.
    secrets.token_urlsafe(5) yields ~7 chars; slice to 6 for SMS economy.
    Collision probability is negligible at platform scale (64^6 ≈ 68B values)
    and the UNIQUE index on book_token would catch any collision at INSERT.
    """
    return (
        secrets.token_urlsafe(5)[:6],
        secrets.token_urlsafe(5)[:6],
        secrets.token_urlsafe(5)[:6],
    )


def _resolve_source(carrier_id: str, broker_id: str | None) -> str:
    """Determine the source code for an inbound load offer. Per v8.1 §5.
    - OUTRCH if broker_id is known AND outreach_log has a matching row
    - INBND otherwise (covers known-no-outreach AND unknown sender)
    - SYL is reserved for ACE Chrome extension via /upsert-broker-lane
    Defensive default: INBND on any error (safer than failing the SMS path).
    """
    if not broker_id:
        return "INBND"
    try:
        resp = (
            supabase_client()
            .table("outreach_log")
            .select("id")
            .eq("carrier_id", carrier_id)
            .eq("broker_id", broker_id)
            .limit(1)
            .execute()
        )
        return "OUTRCH" if resp.data else "INBND"
    except Exception as exc:
        log.error('"_resolve_source failed carrier=%s broker=%s: %s"',
                  carrier_id, broker_id, exc)
        return "INBND"


def _build_carrier_signature(carrier_id: str) -> str:
    """Build the stacked email signature for a carrier per v8.1 §7.4.
    Lines: {first_name (skip if single char)} / {company} / {phone} / MC {mc_number}
    Returns multi-line string, or empty string if lookup fails or no fields populated.
    Resilient to missing columns — silently skips any field that isn't present.
    """
    try:
        # SELECT * to tolerate column-name uncertainty on the carriers table.
        # Reads only one row; cost is negligible.
        resp = (
            supabase_client()
            .table("carriers")
            .select("*")
            .eq("id", carrier_id)
            .limit(1)
            .execute()
        )
        if not resp.data:
            return ""
        row = resp.data[0]
        lines: list[str] = []

        # First-name line (skip if single character per §7.4)
        first_name = (row.get("first_name") or "").strip()
        if not first_name:
            # Fall back to the first whitespace-separated token in `name`
            full = (row.get("name") or "").strip()
            first_name = full.split()[0] if full else ""
        if first_name and len(first_name) > 1:
            lines.append(first_name)

        # Company line (try the common candidate column names)
        company = (
            (row.get("company") or "").strip()
            or (row.get("company_name") or "").strip()
            or (row.get("dba_name") or "").strip()
        )
        if company:
            lines.append(company)

        # Phone line (try the common candidate column names)
        phone = (
            (row.get("phone") or "").strip()
            or (row.get("mobile") or "").strip()
            or (row.get("phone_number") or "").strip()
        )
        if phone:
            lines.append(phone)

        # MC line
        mc = (row.get("mc_number") or "").strip()
        if mc:
            lines.append(f"MC {mc}")

        return "\n".join(lines)
    except Exception as exc:
        log.error('"_build_carrier_signature failed carrier=%s: %s"', carrier_id, exc)
        return ""


def _truncate_broker_display(name: str | None, fallback: str | None = None,
                              max_chars: int = EDGE_SMS_BROKER_NAME_MAX) -> str:
    """Build a ≤20-char broker display name for SMS per v8.1 §6.5.
    Prefers `name`, falls back to `fallback`, else "Broker".
    Truncates with ellipsis (…) if longer than max_chars.
    """
    candidate = (name or "").strip() or (fallback or "").strip() or "Broker"
    if len(candidate) <= max_chars:
        return candidate
    return candidate[: max_chars - 1] + "…"


def _split_city_state(value: str | None) -> tuple[str | None, str | None]:
    """Split 'Dallas, TX' (or 'Dallas TX') into ('Dallas', 'TX').
    Defensive: Haiku-extracted strings vary in format. Returns (None, None)
    on bad/empty input. Last 2-char all-caps token is treated as state.
    """
    if not value or not isinstance(value, str):
        return (None, None)
    parts = value.replace(",", " ").split()
    if not parts:
        return (None, None)
    state: str | None = None
    city_parts = list(parts)
    if len(parts[-1]) == 2 and parts[-1].isupper():
        state = parts[-1]
        city_parts = parts[:-1]
    city = " ".join(city_parts) if city_parts else None
    return (city, state)


def _format_load_offer_sms(broker_display: str, pickup: str, delivery: str,
                            miles: int | None, rate,
                            book_token: str, rebid_token: str,
                            pass_token: str) -> str:
    """Build the 3-segment Unicode NTG-card SMS per v8.1 §6.1 (full card)."""
    miles_part = f"{miles}mi · " if miles else ""
    rate_part = f"Offer ${rate}" if rate else "Offer TBD"
    return (
        f"{broker_display} · {pickup} → {delivery}\n"
        f"{miles_part}{rate_part}\n"
        f"\n"
        f"✅ BOOK   xbase1.com/{book_token}\n"
        f"🔄 RE-BID xbase1.com/{rebid_token}\n"
        f"❌ PASS   xbase1.com/{pass_token}"
    )


def _format_nudge_sms(broker_display: str, delivery_city: str) -> str:
    """Build the 1-segment nudge SMS per v8.1 §6.3.
    Fired when Haiku could not extract a rate. ≤67 chars target.
    """
    return f"{broker_display} load offer to {delivery_city} — check your email for details"


def _format_counter_sms(broker_display: str, pickup: str, delivery: str,
                         miles: int | None, original_offer, counter_amount,
                         book_token: str, pass_token: str) -> str:
    """Build the Volley 2 counter card per v8.1 §6.2.
    Two action emojis only — no RE-BID at Volley 2 (2-volley cap).
    """
    miles_part = f"{miles}mi · " if miles else ""
    return (
        f"{broker_display} · {pickup} → {delivery}\n"
        f"{miles_part}Offer ${original_offer} / Counter ${counter_amount}\n"
        f"\n"
        f"✅ BOOK xbase1.com/{book_token}\n"
        f"❌ PASS xbase1.com/{pass_token}"
    )


def _format_win_sms() -> str:
    """Build the 1-segment win SMS per v8.1 §6.4.
    Fires when broker accepts a carrier's RE-BID (Haiku → 'positive').
    """
    return "Broker accepted — looks like you won it. Take it from here!"


def _build_agreement_email(pickup_city: str, delivery_city: str,
                            rate, signature: str) -> str:
    """BOOK agreement email body per v8.1 §7.1.
    Sent via the carrier's Gmail as a reply on thread_id.
    """
    body = (
        f"Let's book the {pickup_city} - {delivery_city} load at ${rate}. "
        f"Thx! Send over the RC or onboard link.\n"
    )
    if signature:
        body += signature
    return body


def _build_counter_email(counter_amount, signature: str) -> str:
    """RE-BID counter email body per v8.1 §7.2."""
    body = f"Do you have room to move to ${counter_amount} on this one? Thanks!\n"
    if signature:
        body += signature
    return body


def _build_decline_email(pickup_city: str, delivery_city: str,
                          signature: str) -> str:
    """PASS courtesy decline email body per v8.1 §7.3.
    Sent only when source=OUTRCH (relationship preservation).
    """
    body = (
        f"Appreciate the offer on {pickup_city} - {delivery_city}. "
        f"Not the right fit this time — keep me in mind for future lanes!\n"
    )
    if signature:
        body += signature
    return body


def _create_edge_load_activity_row(
    carrier_id: str,
    broker_id: str | None,
    source: str,
    email_data: dict,
    extracted: dict,
    book_token: str,
    rebid_token: str,
    pass_token: str,
    ttl_minutes: int = EDGE_LOAD_OFFER_TTL_MINUTES,
) -> dict | None:
    """Insert a row into edge_load_activity at stage='offer' with TTL expiry.
    Returns the inserted row (with id) or None on failure.
    Writes via service-role client per v8.1 §4.1 (RLS bypass).
    """
    try:
        sender_name = extracted.get("sender_name") or ""
        first_name = ""
        last_name = ""
        if sender_name:
            parts = sender_name.split()
            first_name = parts[0] if parts else ""
            last_name = " ".join(parts[1:]) if len(parts) > 1 else ""

        pickup_city, pickup_state = _split_city_state(extracted.get("load_origin"))
        delivery_city, delivery_state = _split_city_state(extracted.get("load_destination"))

        now = datetime.now(timezone.utc)
        expires = now + timedelta(minutes=ttl_minutes)

        row = {
            "carrier_id": carrier_id,
            "broker_id": broker_id,
            "source": source,
            "thread_id": email_data["thread_id"],
            "gmail_message_id": email_data["message_id"],
            "broker_email": email_data["from_email"],
            "broker_first_name": first_name or None,
            "broker_last_name": last_name or None,
            "stage": "offer",
            "book_token": book_token,
            "rebid_token": rebid_token,
            "pass_token": pass_token,
            "consumed": False,
            "expires_at": expires.isoformat(),
            "rate_offered": _parse_rate_numeric(extracted.get("rate_offered")),
            "pickup_city": pickup_city,
            "pickup_state": pickup_state,
            "delivery_city": delivery_city,
            "delivery_state": delivery_state,
            "created_at": now.isoformat(),
        }
        # Drop NULL keys so DB defaults can apply where appropriate
        row = {k: v for k, v in row.items() if v is not None}

        resp = (
            supabase_service_client()
            .table("edge_load_activity")
            .insert(row)
            .execute()
        )
        if resp.data:
            log.info('"edge_load_activity created id=%s source=%s thread=%s"',
                     resp.data[0].get("id"), source, email_data["thread_id"])
            return resp.data[0]
        return None
    except Exception as exc:
        log.error('"_create_edge_load_activity_row failed: %s"', exc, exc_info=True)
        return None


def _write_broker_lanes_row(carrier_id: str, source: str,
                             broker_info: dict, lane: dict,
                             decision: str | None = None) -> str | None:
    """Insert one row into broker_lanes (cross-source intelligence capture).
    Mirrors the row shape ACE's /upsert-broker-lane writes (source='SYL').
    EDGE writes here with source='OUTRCH' or 'INBND'. Per v8.1 §3.4.
    Returns inserted row id or None on failure.
    decision starts NULL at SMS send time; updated to booked/rebid/passed/etc.
    when the carrier acts. Service role write (bypasses RLS).
    """
    try:
        row = {
            "carrier_id": carrier_id,
            "source": source,
            "decision": decision,
            "broker_first_name": broker_info.get("first_name"),
            "broker_last_name": broker_info.get("last_name"),
            "broker_company": broker_info.get("company"),
            "broker_mc": broker_info.get("mc"),
            "broker_email": broker_info.get("email"),
            "broker_phone": broker_info.get("phone"),
            "team_name": broker_info.get("team_name"),
            "pickup_city": lane.get("pickup_city"),
            "pickup_state": lane.get("pickup_state"),
            "pickup_zip": lane.get("pickup_zip"),
            "delivery_city": lane.get("delivery_city"),
            "delivery_state": lane.get("delivery_state"),
            "delivery_zip": lane.get("delivery_zip"),
            "vehicle_size": lane.get("vehicle_size"),
            "miles": lane.get("miles"),
            "posted_amount": lane.get("posted_amount"),
        }
        # Drop NULL keys to keep the row clean
        row = {k: v for k, v in row.items() if v is not None}

        resp = (
            supabase_service_client()
            .table("broker_lanes")
            .insert(row)
            .execute()
        )
        if resp.data:
            return resp.data[0].get("id")
        return None
    except Exception as exc:
        log.error('"_write_broker_lanes_row failed: %s"', exc, exc_info=True)
        return None


# ══════════════════════════════════════════════════════════════════════════════
# ── End Piece 5 helpers ──────────────────────────────────────────────────────
# ══════════════════════════════════════════════════════════════════════════════


# ── Load board helpers ────────────────────────────────────────────────────────
```

The new_str re-states the old anchor verbatim and adds the helpers block in the middle. The result is one large block of additive code, no existing line is modified.

---

## VERIFICATION — run all four after both edits

### 1. Python syntax must parse cleanly
```bash
python3 -c "import ast; ast.parse(open('services/gmail-webhook/main.py').read()); print('OK')"
```
Expected output: `OK`

### 2. Line count
```bash
wc -l services/gmail-webhook/main.py
```
Expected: **2853**

### 3. SHA-256 hash
```bash
sha256sum services/gmail-webhook/main.py
```
Expected: `a1c7461935c5889ef96b7f0d6ceb593049988cdf045f4b6625dc3ebd264f9957`

The hash is the strongest single check. If the hash matches exactly, no extra whitespace, no stray edits, no character drift.

### 4. Top-level def count
```bash
grep -c "^def " services/gmail-webhook/main.py
```
Expected: **70** (was 56 in v8.0 baseline; 14 new helpers added)

---

## ON SUCCESS

Output to the operator (Ken):
- "Both edits applied successfully"
- The output of all four verification commands
- **STOP.** Do not commit, do not push, do not deploy.
- Ken will inspect the diff with `git diff services/gmail-webhook/main.py | head -50` and commit manually.

---

## ON FAILURE

If any `str_replace` fails or any verification fails:
1. Revert with: `git checkout services/gmail-webhook/main.py`
2. Report which step failed and the exact error
3. **Do not attempt to fix it yourself.** Stop and wait for instructions.
