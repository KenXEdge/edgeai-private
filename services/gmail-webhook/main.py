"""
EDGEai Gmail Webhook Service
Receives Gmail Push Notifications via Google Cloud Pub/Sub,
classifies broker replies using Claude, and triggers carrier actions.
"""

import os
import json
import base64
import logging
import secrets
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, timedelta
from email import message_from_bytes
from email.utils import parseaddr, parsedate_to_datetime

import anthropic
from flask import Flask, request, jsonify, redirect, Response, stream_with_context
from supabase import create_client, Client
import telnyx
from google.oauth2.credentials import Credentials as OAuthCredentials
from googleapiclient.discovery import build

# ── Structured JSON logging for Cloud Run ─────────────────────────────────────
logging.basicConfig(
    stream=sys.stdout,
    level=logging.INFO,
    format='{"time":"%(asctime)s","level":"%(levelname)s","msg":%(message)s}',
)
log = logging.getLogger(__name__)

app = Flask(__name__)

_ALLOWED_ORIGINS = {"https://xtxtec.com", "https://edgeai-dashboard.vercel.app"}

def _cors_origin():
    o = request.headers.get("Origin", "")
    return o if o in _ALLOWED_ORIGINS else "https://xtxtec.com"

@app.before_request
def handle_preflight():
    if request.method == "OPTIONS":
        response = app.make_response("")
        response.headers["Access-Control-Allow-Origin"] = _cors_origin()
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        response.status_code = 200
        return response

@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = _cors_origin()
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return response

@app.errorhandler(404)
def not_found(e):
    response = jsonify({"error": "not found"})
    response.status_code = 404
    response.headers["Access-Control-Allow-Origin"] = _cors_origin()
    return response

@app.errorhandler(500)
def server_error(e):
    response = jsonify({"error": "internal server error"})
    response.status_code = 500
    response.headers["Access-Control-Allow-Origin"] = _cors_origin()
    return response

# ── Lazy singletons (initialised once per container cold start) ────────────────
_supabase: Client | None = None
_anthropic: anthropic.Anthropic | None = None


def supabase_client() -> Client:
    global _supabase
    if _supabase is None:
        _supabase = create_client(
            os.environ["SUPABASE_URL"],
            os.environ["SUPABASE_KEY"],
        )
    return _supabase


def anthropic_client() -> anthropic.Anthropic:
    global _anthropic
    if _anthropic is None:
        _anthropic = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    return _anthropic


def gmail_service(refresh_token: str):
    """Build authenticated Gmail service using carrier's own refresh token.
    Token passed per-call, never read from env. Required for multi-carrier."""
    import google.auth.transport.requests as google_requests
    import requests as requests_lib
    if not refresh_token:
        raise ValueError("gmail_service called without refresh_token")
    creds = OAuthCredentials(
        token=None,
        refresh_token=refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=os.environ["GMAIL_CLIENT_ID"],
        client_secret=os.environ["GMAIL_CLIENT_SECRET"],
        scopes=["https://www.googleapis.com/auth/gmail.modify"],
    )
    auth_req = google_requests.Request(session=requests_lib.Session())
    creds.refresh(auth_req)
    return build("gmail", "v1", credentials=creds, cache_discovery=False)


"""
================================================================================
Phase D — Service Account Auth Middleware for cloud-edition endpoints
================================================================================
ADD THIS BLOCK TO main.py

Placement: insert AFTER the `anthropic_client()` function (line ~91) and BEFORE
the "Load board constants" section (line ~114).

Purpose: provides @require_carrier_auth decorator that verifies Google-issued
service account ID tokens on incoming requests. Each carrier has a dedicated
GCP service account; container running for that carrier uses its service
account's ID token to authenticate against main.py endpoints.

Token format expected: Google-signed JWT in header
    Authorization: Bearer <google-id-token>

Verification steps:
  1. Extract token from Authorization header
  2. Verify signature with Google's public keys (via google.oauth2.id_token)
  3. Confirm audience matches our Cloud Run service URL
  4. Confirm issuer is accounts.google.com
  5. Extract email claim — must match pattern ace-carrier-{uuid}@<project>.iam.gserviceaccount.com
  6. Parse carrier_id from service account email
  7. Confirm carrier has active ace_vm_access in Supabase
  8. Attach carrier_id to flask.g for endpoint use

If any step fails: return 401 immediately, log the rejection.

This decorator is applied ONLY to new cloud-edition endpoints. Existing
endpoints (/webhook, /stripe-webhook, /validate-carrier, etc.) keep their
current behavior. Cleanup of those endpoints is separate future work.

REQUIRED ENV VARS (must be set on Cloud Run service):
  CLOUD_RUN_SERVICE_URL  — the public URL of this service
                           (e.g. https://edgeai-gmail-webhook-jh6fc2627a-uc.a.run.app)
                           Used as JWT audience to prevent token reuse across services.
  CARRIER_SA_PROJECT     — GCP project where carrier service accounts live
                           (e.g. "xbase1-prod"). Defense-in-depth check.
================================================================================
"""

# ── Phase D: Service account auth middleware ───────────────────────────────────

from functools import wraps
import re

import google.auth.transport.requests as google_auth_requests
from google.oauth2 import id_token as google_id_token
from flask import g


# Pattern: ace-carrier-{32_hex_uuid_no_dashes}@<gcp_project>.iam.gserviceaccount.com
# Example: ace-carrier-e71595ed72ad46d5a4244265df3b29ec@xbase1-prod.iam.gserviceaccount.com
_CARRIER_SA_EMAIL_RE = re.compile(
    r'^ace-carrier-(?P<uuid_hex>[0-9a-f]{32})@'
    r'(?P<project>[a-z][a-z0-9-]{4,28}[a-z0-9])\.iam\.gserviceaccount\.com$'
)


def _uuid_from_hex(uuid_hex: str) -> str:
    """Convert 32-char hex UUID (no dashes) back to canonical 8-4-4-4-12 form."""
    return f"{uuid_hex[0:8]}-{uuid_hex[8:12]}-{uuid_hex[12:16]}-{uuid_hex[16:20]}-{uuid_hex[20:32]}"


def _audit_log(event: str, **kwargs) -> None:
    """Structured log for auth events. Picked up by Cloud Logging."""
    payload = {"event": event, **kwargs}
    log.info(json.dumps(payload))


def require_carrier_auth(view_func):
    """
    Decorator: enforces Google-signed service account JWT on a Flask endpoint.

    Behavior:
      - Reads Authorization: Bearer <token> header
      - Verifies token via Google's public keys
      - Validates token's audience matches expected Cloud Run URL
      - Extracts carrier UUID from the service account email
      - Confirms carrier has active ace_vm_access in Supabase
      - Sets flask.g.carrier_id and flask.g.sa_email for view to use
      - Returns 401 on any failure

    Usage:
        @app.route("/get-gmail-access-token", methods=["POST"])
        @require_carrier_auth
        def get_gmail_access_token():
            carrier_id = g.carrier_id  # already validated
            ...
    """
    @wraps(view_func)
    def wrapper(*args, **kwargs):
        # Step 1 — Extract token from Authorization header
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            _audit_log("auth_rejected", reason="missing_token",
                       path=request.path, ip=request.remote_addr)
            return jsonify({"error": "unauthorized"}), 401

        token = auth_header.split(" ", 1)[1].strip()
        if not token:
            _audit_log("auth_rejected", reason="empty_token",
                       path=request.path, ip=request.remote_addr)
            return jsonify({"error": "unauthorized"}), 401

        # Step 2 — Server must know its own URL to verify token audience
        expected_audience = os.environ.get("CLOUD_RUN_SERVICE_URL", "")
        if not expected_audience:
            log.error('"[AUTH] CLOUD_RUN_SERVICE_URL env var not set — cannot verify tokens"')
            return jsonify({"error": "server misconfigured"}), 500

        # Step 3 — Verify Google JWT signature and audience
        try:
            req = google_auth_requests.Request()
            claims = google_id_token.verify_token(
                token,
                request=req,
                audience=expected_audience,
            )
        except ValueError as e:
            _audit_log("auth_rejected", reason="invalid_token",
                       path=request.path, ip=request.remote_addr, detail=str(e))
            return jsonify({"error": "unauthorized"}), 401

        # Step 4 — Confirm issuer is Google
        if claims.get("iss") not in ("https://accounts.google.com", "accounts.google.com"):
            _audit_log("auth_rejected", reason="wrong_issuer",
                       path=request.path, ip=request.remote_addr, iss=claims.get("iss"))
            return jsonify({"error": "unauthorized"}), 401

        # Step 5 — Pull service account email claim
        sa_email = claims.get("email", "")
        if not sa_email:
            _audit_log("auth_rejected", reason="no_email_claim",
                       path=request.path, ip=request.remote_addr)
            return jsonify({"error": "unauthorized"}), 401

        # Step 6 — Email must match carrier SA naming pattern
        match = _CARRIER_SA_EMAIL_RE.match(sa_email)
        if not match:
            _audit_log("auth_rejected", reason="not_carrier_sa",
                       path=request.path, ip=request.remote_addr, sa_email=sa_email)
            return jsonify({"error": "unauthorized"}), 401

        # Step 7 — Optional GCP project match (defense in depth)
        expected_project = os.environ.get("CARRIER_SA_PROJECT", "")
        if expected_project and match.group("project") != expected_project:
            _audit_log("auth_rejected", reason="wrong_project",
                       path=request.path, ip=request.remote_addr,
                       sa_project=match.group("project"))
            return jsonify({"error": "unauthorized"}), 401

        # Step 8 — Convert hex UUID back to canonical UUID form
        try:
            carrier_id = _uuid_from_hex(match.group("uuid_hex"))
        except Exception:
            _audit_log("auth_rejected", reason="malformed_carrier_id",
                       path=request.path, ip=request.remote_addr)
            return jsonify({"error": "unauthorized"}), 401

        # Step 9 — Confirm carrier has active ace_vm_access row in Supabase
        try:
            sb = supabase_client()
            resp = (
                sb.table("ace_vm_access")
                .select("active")
                .eq("carrier_id", carrier_id)
                .eq("active", True)
                .limit(1)
                .execute()
            )
            if not resp.data:
                _audit_log("auth_rejected", reason="no_active_vm_access",
                           path=request.path, carrier_id=carrier_id)
                return jsonify({"error": "access revoked"}), 401
        except Exception as e:
            log.error(f'"[AUTH] supabase lookup failed: {e}"')
            return jsonify({"error": "internal"}), 500

        # All checks passed — attach to request context for the view function
        g.carrier_id = carrier_id
        g.sa_email = sa_email
        _audit_log("auth_accepted", path=request.path, carrier_id=carrier_id)

        return view_func(*args, **kwargs)

    return wrapper


# ── End Phase D middleware ─────────────────────────────────────────────────────


"""
================================================================================
Phase C — /get-gmail-access-token endpoint
================================================================================
ADD THIS BLOCK TO main.py

Placement: insert AFTER the Phase D middleware block ends (currently line 304,
the "# ── End Phase D middleware" comment) and BEFORE the
"# ── Load board constants" section (currently line 307).

Purpose: provides a single authoritative endpoint for cloud-edition containers
to obtain a valid Gmail access token for a carrier. All consumers (ACE cloud
containers, future EDGE Outreach, future CMO) call this endpoint rather than
each managing their own token refresh. Centralizes token lifecycle management.

Design:
  - Protected by @require_carrier_auth (Phase D). Only authenticated carrier
    service accounts can call this. carrier_id extracted from JWT — not from
    request body (prevents spoofing).
  - Reads carriers.gmail_token (the refresh token) from Supabase for the
    authenticated carrier.
  - Reuses existing gmail_service() function to refresh the token. This is the
    same function used by the Gmail webhook handler — no duplicate refresh logic.
  - Returns the refreshed access token + expiry. Container caches it for the
    remaining lifetime and calls this endpoint again when it expires.
  - Does NOT return the refresh token. Access token only.

Token lifecycle:
  - Google access tokens expire after ~3600 seconds (1 hour)
  - Container should refresh ~5 minutes before expiry (at ~3300 seconds)
  - Container holds the access token in memory only — never written to disk

Required env vars (already present in main.py from gmail_service()):
  GMAIL_CLIENT_ID
  GMAIL_CLIENT_SECRET

No new env vars required for this endpoint.

Failure modes:
  - 401: invalid or missing service account JWT (handled by @require_carrier_auth)
  - 404: carrier has no gmail_token in Supabase (never connected Gmail)
  - 502: Google token refresh failed (Google API error)
  - 500: unexpected error
================================================================================
"""

# ── Phase C: Gmail access token endpoint ──────────────────────────────────────

import time as _time


@app.route("/get-gmail-access-token", methods=["POST"])
@require_carrier_auth
def get_gmail_access_token():
    """
    Returns a fresh Gmail access token for the authenticated carrier.
    carrier_id is sourced from the verified JWT via flask.g — not from request body.

    Response (200):
        {
            "access_token": "<google-access-token>",
            "expires_at": <unix-timestamp-int>,
            "carrier_id": "<uuid>"
        }

    Error responses:
        404 — carrier has no gmail_token (Gmail not connected)
        502 — Google token refresh failed
        500 — unexpected error
    """
    carrier_id = g.carrier_id  # set by @require_carrier_auth, already validated

    # 1. Fetch carrier's Gmail refresh token from Supabase
    try:
        sb = supabase_client()
        resp = (
            sb.table("carriers")
            .select("gmail_token")
            .eq("id", carrier_id)
            .limit(1)
            .execute()
        )
    except Exception as e:
        log.error(f'"[PHASE-C] supabase fetch failed for carrier {carrier_id}: {e}"')
        return jsonify({"error": "internal"}), 500

    if not resp.data or not resp.data[0].get("gmail_token"):
        log.warning(f'"[PHASE-C] no gmail_token for carrier {carrier_id}"')
        return jsonify({"error": "gmail_not_connected"}), 404

    refresh_token = resp.data[0]["gmail_token"]

    # 2. Refresh the access token using existing gmail_service() function.
    #    gmail_service() calls creds.refresh() internally and returns
    #    an authenticated Gmail service. We extract the access token from
    #    the credentials object after refresh.
    try:
        import google.auth.transport.requests as google_requests
        import requests as requests_lib
        from google.oauth2.credentials import Credentials as OAuthCredentials

        creds = OAuthCredentials(
            token=None,
            refresh_token=refresh_token,
            token_uri="https://oauth2.googleapis.com/token",
            client_id=os.environ["GMAIL_CLIENT_ID"],
            client_secret=os.environ["GMAIL_CLIENT_SECRET"],
            scopes=["https://www.googleapis.com/auth/gmail.modify"],
        )
        auth_req = google_requests.Request(session=requests_lib.Session())
        creds.refresh(auth_req)

        access_token = creds.token
        # creds.expiry is a datetime object. Convert to unix timestamp.
        expires_at = int(creds.expiry.timestamp()) if creds.expiry else int(_time.time()) + 3600

    except Exception as e:
        log.error(f'"[PHASE-C] token refresh failed for carrier {carrier_id}: {e}"')
        return jsonify({"error": "token_refresh_failed"}), 502

    # 3. Return access token to container. Container caches and reuses
    #    until expires_at - 300 (5-min buffer), then calls this endpoint again.
    log.info(json.dumps({
        "event": "gmail_token_issued",
        "carrier_id": carrier_id,
        "expires_at": expires_at
    }))

    return jsonify({
        "access_token": access_token,
        "expires_at": expires_at,
        "carrier_id": carrier_id
    }), 200


# ── End Phase C ────────────────────────────────────────────────────────────────


# ── Load board constants ───────────────────────────────────────────────────────

LOAD_BOARD_SENDERS: dict[str, str] = {
    "noreply@spotinc.com":         "Spot",
    "loadmatches@ntgfreight.com":  "NTG",
    "ftl-projects@prdlax.com":     "NTG",
    "alerts@dat.com":              "DAT",
    "notifications@truckstop.com": "Truckstop",
}

LOAD_BOARD_PARSE_PROMPT = (
    "You are a freight load board email parser. Extract the following fields from the email body.\n"
    "Return ONLY valid JSON. No markdown, no preamble, no explanation.\n\n"
    "Fields:\n"
    "- equipment_type: string (e.g. 'Dry Van', 'Reefer', 'Flatbed') or null\n"
    "- origin: string (City ST format, e.g. 'Dallas TX') or null\n"
    "- destination: string (City ST format, e.g. 'Oklahoma City OK') or null\n"
    "- mileage: integer or null\n"
    "- pickup_date: string (e.g. '4/27') or null\n"
    "- shipment_number: string or null\n\n"
    "Email body:\n{body}"
)


# ── Gmail helpers ──────────────────────────────────────────────────────────────

def get_history(start_history_id: str, refresh_token: str) -> list[dict]:
    """Primary method: return messagesAdded entries since start_history_id.
    Returns [] on 0 records OR on exception — caller is responsible for fallback.
    """
    messages = []
    try:
        print(f"[get_history] calling history.list startHistoryId={start_history_id}", flush=True)
        resp = (
            gmail_service(refresh_token)
            .users()
            .history()
            .list(
                userId="me",
                startHistoryId=start_history_id,
                historyTypes=["messageAdded"],
            )
            .execute()
        )

        print(f"[get_history] response — historyId={resp.get('historyId')} recordCount={len(resp.get('history', []))} nextPageToken={resp.get('nextPageToken')}", flush=True)

        for i, record in enumerate(resp.get("history", [])):
            added = record.get("messagesAdded", [])
            print(f"[get_history] record[{i}] id={record.get('id')} messagesAdded={len(added)}", flush=True)
            for item in added:
                messages.append(item["message"])

        print(f"[get_history] done — extracted={len(messages)}", flush=True)

    except Exception as exc:
        print(f"[get_history] EXCEPTION — startHistoryId={start_history_id} error={exc}", flush=True)
        log.error('"get_history EXCEPTION — startHistoryId=%s error=%s"', start_history_id, exc, exc_info=True)

    return messages


def get_unread_messages(refresh_token: str) -> list[dict]:
    """Fallback: fetch recent inbox messages via messages.list q='in:inbox newer_than:1h'.
    Catches emails regardless of read/unread status.
    Returns a list of minimal message dicts {id, threadId} matching history.list format.
    """
    try:
        print(f"[get_unread] calling messages.list q=in:inbox newer_than:1h maxResults=10", flush=True)
        resp = (
            gmail_service(refresh_token)
            .users()
            .messages()
            .list(
                userId="me",
                q="in:inbox is:unread newer_than:2d",
                maxResults=10,
            )
            .execute()
        )
        messages = resp.get("messages", [])
        print(f"[get_unread] messages.list returned {len(messages)} unread message(s)", flush=True)
        for i, m in enumerate(messages):
            print(f"[get_unread] unread[{i}] id={m.get('id')} threadId={m.get('threadId')}", flush=True)
        return messages
    except Exception as exc:
        print(f"[get_unread] EXCEPTION — {exc}", flush=True)
        log.error('"get_unread_messages EXCEPTION: %s"', exc, exc_info=True)
        return []


def mark_as_read(message_id: str, refresh_token: str) -> None:
    """Remove the UNREAD label after successful processing."""
    try:
        gmail_service(refresh_token).users().messages().modify(
            userId="me",
            id=message_id,
            body={"removeLabelIds": ["UNREAD"]},
        ).execute()
        log.info('"marked as read — messageId=%s"', message_id)
    except Exception as exc:
        log.error('"mark_as_read failed messageId=%s: %s"', message_id, exc)


def fetch_message(message_id: str, refresh_token: str) -> dict | None:
    """Fetch a single Gmail message and return parsed fields."""
    try:
        raw = (
            gmail_service(refresh_token)
            .users()
            .messages()
            .get(userId="me", id=message_id, format="raw")
            .execute()
        )
        raw_bytes = base64.urlsafe_b64decode(raw["raw"] + "==")
        msg = message_from_bytes(raw_bytes)

        from_header = msg.get("From", "")
        _, from_email = parseaddr(from_header)
        subject = msg.get("Subject", "")
        thread_id = raw.get("threadId", "")

        body = extract_body(msg)

        return {
            "message_id": message_id,
            "thread_id": thread_id,
            "from_email": from_email.lower().strip(),
            "subject": subject,
            "body": body[:4000],  # cap for Claude context
        }
    except Exception as exc:
        log.error('"fetch_message %s failed: %s"', message_id, exc)
        return None


def extract_body(msg) -> str:
    """Extract plain-text body from a parsed email, falling back to HTML."""
    if msg.is_multipart():
        plain, html = "", ""
        for part in msg.walk():
            ct = part.get_content_type()
            cd = part.get("Content-Disposition", "")
            if "attachment" in cd:
                continue
            payload = part.get_payload(decode=True)
            if payload is None:
                continue
            charset = part.get_content_charset() or "utf-8"
            text = payload.decode(charset, errors="replace")
            if ct == "text/plain":
                plain += text
            elif ct == "text/html":
                html += text
        return plain.strip() or html.strip()
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            charset = msg.get_content_charset() or "utf-8"
            return payload.decode(charset, errors="replace").strip()
        return ""


# ── Supabase helpers ───────────────────────────────────────────────────────────

def get_stored_history_id(email: str) -> str | None:
    # maybe_single() returns None when no row exists instead of raising APIError
    resp = (
        supabase_client()
        .table("gmail_sync")
        .select("history_id")
        .eq("email", email)
        .maybe_single()
        .execute()
    )
    if resp and resp.data:
        return resp.data["history_id"]
    return None


def upsert_history_id(email: str, history_id: str) -> None:
    supabase_client().table("gmail_sync").upsert(
        {"email": email, "history_id": history_id, "updated_at": datetime.now(timezone.utc).isoformat()},
        on_conflict="email",
    ).execute()


def lookup_broker(from_email: str, carrier_id: str) -> dict | None:
    """Return broker row if the sender is a known broker for this carrier."""
    resp = (
        supabase_client()
        .table("brokers")
        .select("*")
        .eq("email", from_email)
        .eq("carrier_id", carrier_id)
        .limit(1)
        .execute()
    )
    if resp.data:
        return resp.data[0]
    return None


def is_duplicate(message_id: str) -> bool:
    """Check both processed tables so retried Pub/Sub messages are always skipped."""
    in_ela = bool(
        supabase_client()
        .table("edge_load_activity")
        .select("id")
        .eq("gmail_message_id", message_id)
        .limit(1)
        .execute()
        .data
    )
    if in_ela:
        return True
    in_responses = bool(
        supabase_client()
        .table("responses")
        .select("id")
        .eq("gmail_message_id", message_id)
        .limit(1)
        .execute()
        .data
    )
    if in_responses:
        return True
    in_unknown = bool(
        supabase_client()
        .table("unknown_brokers_inbox")
        .select("id")
        .eq("gmail_message_id", message_id)
        .limit(1)
        .execute()
        .data
    )
    return in_unknown


def log_response(email_data: dict, classification: str, carrier_id: str, broker_id: str | None = None, broker_name: str | None = None) -> None:
    try:
        row = {
            "gmail_message_id": email_data["message_id"],
            "thread_id": email_data["thread_id"],
            "broker_email": email_data["from_email"],
            "subject": email_data["subject"],
            "body": email_data["body"],
            "classification": classification,
            "carrier_id": carrier_id,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        if broker_id is not None:
            row["broker_id"] = broker_id
        if broker_name is not None:
            row["broker_name"] = broker_name
        supabase_client().table("responses").insert(row).execute()
    except Exception as exc:
        if "23505" in str(exc) or "duplicate key" in str(exc):
            log.info('"log_response duplicate — already processed messageId=%s"',
                     email_data["message_id"])
            return
        raise


def log_load_win(email_data: dict, carrier_id: str) -> None:
    supabase_client().table("load_wins").insert(
        {
            "broker_email": email_data["from_email"],
            "subject": email_data["subject"],
            "body": email_data["body"],
            "gmail_message_id": email_data["message_id"],
            "carrier_id": carrier_id,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
    ).execute()


STATUS_MAP = {
    "load_offer": "hot",
    "positive": "warm",
    "negative": "cold",
}


def update_broker_status(broker_id: str, classification: str) -> None:
    new_status = STATUS_MAP.get(classification)
    if new_status:
        supabase_client().table("brokers").update(
            {"status": new_status, "last_reply_at": datetime.now(timezone.utc).isoformat()}
        ).eq("id", broker_id).execute()


def _parse_rate_numeric(rate_str: str | None) -> float | None:
    """Extract the first numeric value from a rate string for the numeric DB column.
    Flat dollar amounts: "$1,500 flat" → 1500.0
    Per-mile rates: "$2.50/mile" → None (bypassed — brokers rarely quote RPM in load offers)
    """
    if not rate_str:
        return None
    import re
    # Bypass RPM rates per business rule — broker load offers should be flat dollar
    lowered = str(rate_str).lower()
    if "/mile" in lowered or "/mi" in lowered or "per mile" in lowered:
        return None
    match = re.search(r"[\d,]+\.?\d*", str(rate_str).replace(",", ""))
    if match:
        try:
            return float(match.group().replace(",", ""))
        except ValueError:
            pass
    return None


def log_unknown_broker_inbox(email_data: dict, extracted: dict, carrier_id: str) -> None:
    """Insert an unrecognised sender into unknown_brokers_inbox for carrier review."""
    try:
        supabase_client().table("unknown_brokers_inbox").insert(
            {
                "carrier_id": carrier_id,
                "gmail_message_id": email_data["message_id"],
                "sender_email": email_data["from_email"],
                "sender_name": extracted.get("sender_name"),
                "broker_company": extracted.get("broker_company"),
                "raw_email": email_data["body"],
                "classification": extracted.get("classification", "unknown"),
                "load_origin": extracted.get("load_origin"),
                "load_destination": extracted.get("load_destination"),
                "rate_offered": _parse_rate_numeric(extracted.get("rate_offered")),
                "status": "pending_review",
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
        ).execute()
        log.info('"unknown_brokers_inbox — logged %s classification=%s"',
                 email_data["from_email"], extracted.get("classification"))
    except Exception as exc:
        log.error('"log_unknown_broker_inbox failed: %s"', exc)


def get_carrier_id_for_email(email_address: str) -> str | None:
    """Look up carrier UUID from carriers table by email address."""
    try:
        resp = (
            supabase_client()
            .table("carriers")
            .select("id")
            .eq("email", email_address)
            .limit(1)
            .execute()
        )
        if resp.data:
            return resp.data[0]["id"]
        return None
    except Exception as exc:
        log.error('"get_carrier_id_for_email failed email=%s: %s"', email_address, exc)
        return None


# ── Claude classification ──────────────────────────────────────────────────────

CLASSIFICATION_PROMPT = """You are classifying a freight broker's email reply to a carrier outreach.

Classify the reply as EXACTLY ONE of these labels:
- load_offer   : broker is offering a specific load, lane, or rate
- positive     : interested, wants more info, positive engagement (but no specific load offered)
- negative     : not interested, removed from list, do not contact, out of network, OR cannot determine intent

Reply with only the label, nothing else.

Email subject: {subject}
Email body:
{body}"""


EXTRACT_PROMPT = (
    "You are analyzing a freight broker email sent to a carrier.\n\n"
    "Return a JSON object with exactly these fields:\n"
    "{{\"classification\": \"<label>\", "
    "\"sender_name\": \"<name or null>\", "
    "\"broker_company\": \"<brokerage company name or null>\", "
    "\"load_origin\": \"<city, state or null>\", "
    "\"load_destination\": \"<city, state or null>\", "
    "\"rate_offered\": \"<amount or null>\", "
    "\"miles\": <integer or null>}}\n\n"
    "Classification labels (EXACTLY one of these three):\n"
    "- load_offer   : offering a specific load, lane, or rate\n"
    "- positive     : interested/positive but no specific load offered\n"
    "- negative     : not interested, DNC, out of network, OR cannot determine intent\n\n"
    "Extraction rules:\n"
    "- sender_name: full name from email signature, null if not present\n"
    "- broker_company: brokerage/company name from signature, sender domain, or letterhead. Null if not identifiable.\n"
    "- load_origin: pickup city/state e.g. Dallas TX, null if not mentioned\n"
    "- load_destination: delivery city/state e.g. Chicago IL, null if not mentioned\n"
    "- rate_offered: dollar rate e.g. $2.50/mile or $1500 flat, null if not mentioned\n"
    "- miles: total trip distance as integer e.g. 950, null if not mentioned\n\n"
    "Return ONLY valid JSON, no other text.\n\n"
    "Subject: {subject}\n"
    "Body:\n"
    "{body}"
)


def classify_reply(email_data: dict) -> str:
    """Known-broker path: classify only. Returns one of three labels:
    load_offer, positive, negative. Per v8.1 §2 — 'question' and 'unknown'
    dropped from the value space; negative is the default fallback.
    """
    try:
        msg = anthropic_client().messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=10,
            messages=[
                {
                    "role": "user",
                    "content": CLASSIFICATION_PROMPT.format(
                        subject=email_data["subject"],
                        body=email_data["body"],
                    ),
                }
            ],
        )
        label = msg.content[0].text.strip().lower()
        if label not in {"load_offer", "positive", "negative"}:
            label = "negative"
        return label
    except Exception as exc:
        log.error('"classify_reply failed: %s"', exc)
        return "negative"


def classify_and_extract(email_data: dict) -> dict:
    """Unknown-broker path: classify + extract load details in one Claude call.

    Returns dict with keys: classification, sender_name, load_origin,
    load_destination, rate_offered. Per v8.1 §2 — labels reduced to
    load_offer / positive / negative; negative is the default fallback.
    """
    fallback = {
        "classification": "negative",
        "sender_name": None,
        "broker_company": None,
        "load_origin": None,
        "load_destination": None,
        "rate_offered": None,
        "miles": None,
    }
    try:
        subject = email_data.get("subject", "")
        body = email_data.get("body", "")
        prompt_text = EXTRACT_PROMPT.format(subject=subject, body=body[:3000])
        msg = anthropic_client().messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=600,
            messages=[{"role": "user", "content": prompt_text}],
        )
        raw = msg.content[0].text.strip()
        # Strip markdown code fences if Haiku wrapped the JSON
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1] if "\n" in raw else raw
            if raw.endswith("```"):
                raw = raw.rsplit("```", 1)[0]
            raw = raw.strip()
        try:
            extracted = json.loads(raw)
        except json.JSONDecodeError as _je:
            log.error('"classify_and_extract JSON parse failed raw=%r err=%s"', raw[:500], _je)
            return fallback
        if extracted.get("classification") not in {
            "load_offer", "positive", "negative"
        }:
            extracted["classification"] = "negative"
        return extracted
    except Exception as exc:
        log.error('"classify_and_extract failed: %s"', str(exc))
        if hasattr(exc, 'response'):
            log.error('"classify_and_extract response body: %s"',
                      exc.response.text if hasattr(exc.response, 'text') else str(exc.response))
        return fallback


# ── Telnyx SMS ─────────────────────────────────────────────────────────────────

def send_load_offer_sms(email_data: dict) -> None:
    if os.environ.get("SMS_ENABLED", "true") == "false":
        log.info('"SMS disabled — skipping load offer SMS"')
        return
    body = (
        f"LOAD OFFER from {email_data['from_email']}\n"
        f"Subject: {email_data['subject']}\n"
        f"{email_data['body'][:200]}"
    )
    try:
        telnyx.api_key = os.environ["TELNYX_API_KEY"]
        telnyx.Message.create(
            from_=os.environ["TELNYX_FROM"],
            to=os.environ["TELNYX_TO"],
            text=body,
        )
        log.info('"SMS sent — known broker load offer from=%s"', email_data["from_email"])
    except Exception as exc:
        log.error('"send_load_offer_sms failed: %s"', exc, exc_info=True)


def send_unknown_broker_sms(email_data: dict, extracted: dict) -> None:
    if os.environ.get("SMS_ENABLED", "true") == "false":
        log.info('"SMS disabled — skipping unknown broker SMS"')
        return
    origin = extracted.get("load_origin") or "Unknown"
    destination = extracted.get("load_destination") or "Unknown"
    rate = extracted.get("rate_offered") or "Not specified"
    sender = extracted.get("sender_name") or email_data["from_email"]

    body = (
        f"Non-EDGEai Broker Alert\n"
        f"From: {sender} <{email_data['from_email']}>\n"
        f"Origin: {origin}\n"
        f"Destination: {destination}\n"
        f"Rate: {rate}\n"
        f"---\n"
        f"{email_data['body'][:160]}\n"
        f"\nReply Y to accept, P to pass"
    )
    try:
        telnyx.api_key = os.environ["TELNYX_API_KEY"]
        telnyx.Message.create(
            from_=os.environ["TELNYX_FROM"],
            to=os.environ["TELNYX_TO"],
            text=body,
        )
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


def _promote_unknown_broker_to_brokers(row: dict, carrier_id: str) -> None:
    """Y4: promote unknown sender to brokers table on BOOK/RE-BID.
    Fire-and-forget — failure never blocks the calling action. v8.1 §2."""
    if row.get("broker_id"):
        return
    broker_email = row.get("broker_email")
    if not broker_email:
        return
    try:
        first = (row.get("broker_first_name") or "").strip()
        last = (row.get("broker_last_name") or "").strip()
        full_name = f"{first} {last}".strip() or broker_email
        existing = (
            supabase_service_client()
            .table("brokers")
            .select("id")
            .eq("carrier_id", carrier_id)
            .eq("email", broker_email)
            .limit(1)
            .execute()
        )
        if existing.data:
            broker_id = existing.data[0]["id"]
        else:
            inserted = (
                supabase_service_client()
                .table("brokers")
                .insert({
                    "carrier_id": carrier_id,
                    "email": broker_email,
                    "name": full_name,
                    "first_name": first or None,
                    "last_name": last or None,
                    "company": row.get("broker_company"),
                    "status": "active",
                    "contact_enabled": True,
                    "response_count": 0,
                    "load_count": 0,
                    "touch_count": 0,
                    "notes": "auto-promoted on carrier interaction",
                })
                .execute()
            )
            broker_id = inserted.data[0]["id"]
        supabase_service_client().table("edge_load_activity").update({
            "broker_id": broker_id,
        }).eq("id", row["id"]).execute()
        log.info('"_promote_unknown_broker: promoted email=%s broker_id=%s row=%s"',
                 broker_email, broker_id, row["id"])
    except Exception as exc:
        log.error('"_promote_unknown_broker failed row=%s: %s"',
                  row.get("id"), exc, exc_info=True)


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
            "broker_company": extracted.get("broker_company"),
            "stage": "offer",
            "book_token": book_token,
            "rebid_token": rebid_token,
            "pass_token": pass_token,
            "consumed": False,
            "expires_at": expires.isoformat(),
            "rate_offered": _parse_rate_numeric(extracted.get("rate_offered")),
            "miles": extracted.get("miles"),
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


# ══════════════════════════════════════════════════════════════════════════════
# ── Piece 5 — v2 SMS sender + supporting glue ────────────────────────────────
# ══════════════════════════════════════════════════════════════════════════════

def _get_carrier_dict(carrier_id: str) -> dict:
    """Fetch the carrier row needed for SMS sending and signature templating.
    Returns the row dict, or empty dict on lookup failure (defensive — SMS
    code path should still attempt with whatever it has).
    """
    try:
        resp = (
            supabase_client()
            .table("carriers")
            .select("*")
            .eq("id", carrier_id)
            .limit(1)
            .execute()
        )
        return resp.data[0] if resp.data else {}
    except Exception as exc:
        log.error('"_get_carrier_dict failed carrier=%s: %s"', carrier_id, exc)
        return {}


def send_load_offer_sms_v2(
    carrier: dict,
    broker: dict | None,
    extracted: dict,
    email_data: dict,
) -> bool:
    """Piece 5 tokenized SMS sender.

    Resolves source, writes edge_load_activity + broker_lanes rows, formats
    the NTG-card or nudge SMS, and sends via Telnyx. Returns True on success.

    Per v8.1 standing rule: legacy send_load_offer_sms / send_unknown_broker_sms
    remain in this file as dead code (no callers) until end-to-end verification
    is complete.
    """
    try:
        carrier_id = carrier.get("id") if carrier else None
        if not carrier_id:
            log.error('"send_load_offer_sms_v2: missing carrier_id — aborting"')
            return False

        broker_id = broker.get("id") if broker else None

        # 1. Source resolution (OUTRCH / INBND — SYL is ACE's domain)
        source = _resolve_source(carrier_id, broker_id)

        # 2. Mint tokens
        book_token, rebid_token, pass_token = _generate_load_offer_tokens()

        # 3. Write edge_load_activity row
        ela_row = _create_edge_load_activity_row(
            carrier_id=carrier_id,
            broker_id=broker_id,
            source=source,
            email_data=email_data,
            extracted=extracted,
            book_token=book_token,
            rebid_token=rebid_token,
            pass_token=pass_token,
        )
        if not ela_row:
            log.error('"send_load_offer_sms_v2: edge_load_activity insert failed message=%s"',
                      email_data.get("message_id"))
            return False

        # 4. Write broker_lanes row (intelligence capture — decision starts NULL)
        broker_info = {}
        sender_name = extracted.get("sender_name") or ""
        if sender_name:
            _parts = sender_name.split()
            broker_info["first_name"] = _parts[0] if _parts else None
            broker_info["last_name"] = " ".join(_parts[1:]) if len(_parts) > 1 else None
        if broker:
            broker_info["first_name"] = broker_info.get("first_name") or broker.get("first_name")
            broker_info["last_name"] = broker_info.get("last_name") or broker.get("last_name")
            broker_info["company"] = broker.get("company") or extracted.get("broker_company")
            broker_info["mc"] = broker.get("mc_number")
            broker_info["phone"] = broker.get("phone")
            broker_info["team_name"] = broker.get("team_name")
        else:
            broker_info["company"] = extracted.get("broker_company")
        broker_info["email"] = email_data.get("from_email")

        pickup_city, pickup_state = _split_city_state(extracted.get("load_origin"))
        delivery_city, delivery_state = _split_city_state(extracted.get("load_destination"))
        lane = {
            "pickup_city": pickup_city,
            "pickup_state": pickup_state,
            "delivery_city": delivery_city,
            "delivery_state": delivery_state,
            "miles": extracted.get("miles"),
            "posted_amount": (f"${_rn:g}" if (_rn := _parse_rate_numeric(extracted.get('rate_offered'))) is not None else None),
        }
        broker_lane_id = _write_broker_lanes_row(
            carrier_id=carrier_id,
            source=source,
            broker_info=broker_info,
            lane=lane,
            decision=None,  # set on carrier action
        )
        if broker_lane_id and ela_row:
            try:
                supabase_service_client().table("edge_load_activity").update({
                    "broker_lane_id": broker_lane_id,
                }).eq("id", ela_row["id"]).execute()
            except Exception as _exc:
                log.error('"send_load_offer_sms_v2: broker_lane_id backfill failed: %s"', _exc)

        # 5. Format SMS body
        broker_display = _truncate_broker_display(
            name=(broker_info.get("first_name") and broker_info.get("last_name")
                  and f"{broker_info['first_name']} {broker_info['last_name']}"),
            fallback=broker_info.get("company") or broker_info.get("email"),
        )
        rate = _parse_rate_numeric(extracted.get("rate_offered"))
        miles_val = ela_row.get("miles")
        pickup_disp = (f"{pickup_city}, {pickup_state}"
                       if pickup_city and pickup_state else (pickup_city or "—"))
        delivery_disp = (f"{delivery_city}, {delivery_state}"
                         if delivery_city and delivery_state else (delivery_city or "—"))

        if rate:
            sms_body = _format_load_offer_sms(
                broker_display=broker_display,
                pickup=pickup_disp,
                delivery=delivery_disp,
                miles=miles_val,
                rate=int(rate) if rate == int(rate) else rate,
                book_token=book_token,
                rebid_token=rebid_token,
                pass_token=pass_token,
            )
        else:
            sms_body = _format_nudge_sms(
                broker_display=broker_display,
                delivery_city=delivery_city or "your area",
            )

        # 6. Send via Telnyx
        carrier_phone = carrier.get("phone")
        if not carrier_phone:
            log.error('"send_load_offer_sms_v2: no phone on carrier %s — SMS not sent"',
                      carrier_id)
            return False

        if os.environ.get("SMS_ENABLED", "false").lower() != "true":
            log.info('"send_load_offer_sms_v2: SMS_ENABLED=false — would have sent to=%s body=%s"',
                     carrier_phone, sms_body)
            return True

        telnyx.api_key = os.environ.get("TELNYX_API_KEY", "")
        telnyx.Message.create(
            from_=os.environ["TELNYX_FROM"],
            to=carrier_phone,
            text=sms_body,
        )
        log.info('"send_load_offer_sms_v2: SMS sent to=%s source=%s message=%s"',
                 carrier_phone, source, email_data.get("message_id"))
        return True

    except Exception as exc:
        log.error('"send_load_offer_sms_v2 failed: %s"', exc, exc_info=True)
        return False


def _handle_volley2_reply(
    row: dict,
    classification: str,
    email_data: dict,
    carrier_id: str,
    broker: dict,
) -> None:
    """Process broker reply on a thread with an open stage='counter' row.
    Per v8.1 §3.7:
      positive  → win SMS, stage=closed, broker_lanes decision='won'
      load_offer with new $ → volley 2 SMS, stage=counter, mint new BOOK/PASS
      negative  → no SMS, stage=closed, broker_lanes decision='declined'
    """
    try:
        if classification.lower() == "positive":
            # Broker accepted the carrier's rebid — fire win SMS, close out
            _carrier = _get_carrier_dict(carrier_id)
            phone = _carrier.get("phone")
            if phone and os.environ.get("SMS_ENABLED", "false").lower() == "true":
                telnyx.api_key = os.environ.get("TELNYX_API_KEY", "")
                telnyx.Message.create(
                    from_=os.environ["TELNYX_FROM"],
                    to=phone,
                    text=_format_win_sms(),
                )
                log.info('"volley2: win SMS sent to=%s row=%s"', phone, row["id"])
            elif phone:
                log.info('"volley2: would have sent win SMS to=%s (SMS_ENABLED=false)"', phone)

            supabase_service_client().table("edge_load_activity").update({
                "stage": "closed",
            }).eq("id", row["id"]).execute()
            supabase_service_client().table("broker_lanes").update({
                "decision": "won",
            }).eq("id", row.get("broker_lane_id")).execute()

        elif classification.lower() == "load_offer":
            # Broker counter-countered with a new $ — fire volley 2 SMS with BOOK/PASS only
            _extracted = classify_and_extract(email_data)
            new_rate = _parse_rate_numeric(_extracted.get("rate_offered"))
            if not new_rate:
                log.info('"volley2: load_offer but no rate extracted — closing thread"')
                supabase_service_client().table("edge_load_activity").update({
                    "stage": "closed",
                }).eq("id", row["id"]).execute()
                return

            _carrier = _get_carrier_dict(carrier_id)
            phone = _carrier.get("phone")
            if not phone:
                log.error('"volley2: no phone for carrier %s"', carrier_id)
                return

            # Mint new BOOK and PASS tokens (RE-BID not offered at volley 2)
            new_book, _new_rebid_unused, new_pass = _generate_load_offer_tokens()
            broker_display = _truncate_broker_display(
                name=(row.get("broker_first_name") and row.get("broker_last_name")
                      and f"{row['broker_first_name']} {row['broker_last_name']}"),
                fallback=row.get("broker_company") or row.get("broker_email"),
            )
            pickup_disp = (f"{row.get('pickup_city')}, {row.get('pickup_state')}"
                           if row.get("pickup_city") and row.get("pickup_state")
                           else (row.get("pickup_city") or "—"))
            delivery_disp = (f"{row.get('delivery_city')}, {row.get('delivery_state')}"
                             if row.get("delivery_city") and row.get("delivery_state")
                             else (row.get("delivery_city") or "—"))
            original_offer = row.get("rate_offered")
            counter_value = int(new_rate) if new_rate == int(new_rate) else new_rate

            sms_body = _format_counter_sms(
                broker_display=broker_display,
                pickup=pickup_disp,
                delivery=delivery_disp,
                miles=row.get("miles"),
                original_offer=int(original_offer) if original_offer and original_offer == int(original_offer) else original_offer,
                counter_amount=counter_value,
                book_token=new_book,
                pass_token=new_pass,
            )

            # Update edge_load_activity: rotate tokens, stash counter_offered amount
            supabase_service_client().table("edge_load_activity").update({
                "stage": "counter",
                "counter_offered": counter_value,
                "book_token": new_book,
                "pass_token": new_pass,
                "rebid_token": None,
                "consumed_token": None,
                "consumed_at": None,
                "expires_at": (datetime.now(timezone.utc) +
                               timedelta(minutes=EDGE_LOAD_OFFER_TTL_MINUTES)).isoformat(),
            }).eq("id", row["id"]).execute()

            if os.environ.get("SMS_ENABLED", "false").lower() == "true":
                telnyx.api_key = os.environ.get("TELNYX_API_KEY", "")
                telnyx.Message.create(
                    from_=os.environ["TELNYX_FROM"],
                    to=phone,
                    text=sms_body,
                )
                log.info('"volley2: counter SMS sent to=%s row=%s"', phone, row["id"])
            else:
                log.info('"volley2: would have sent counter SMS to=%s (SMS_ENABLED=false) body=%s"',
                         phone, sms_body)

        else:
            # Negative or fallthrough — log only, close out
            log.info('"volley2: broker negative — closing thread row=%s"', row["id"])
            supabase_service_client().table("edge_load_activity").update({
                "stage": "closed",
            }).eq("id", row["id"]).execute()
            supabase_service_client().table("broker_lanes").update({
                "decision": "declined",
            }).eq("id", row.get("broker_lane_id")).execute()

    except Exception as exc:
        log.error('"_handle_volley2_reply failed row=%s: %s"', row.get("id"), exc, exc_info=True)


# ══════════════════════════════════════════════════════════════════════════════
# ── End Piece 5 v2 sender ────────────────────────────────────────────────────
# ══════════════════════════════════════════════════════════════════════════════


# ── Load board helpers ────────────────────────────────────────────────────────

def is_load_board_email(from_email: str) -> bool:
    """Return True if the sender is a known load board system address."""
    return from_email.lower().strip() in LOAD_BOARD_SENDERS


def parse_load_board_email(email_data: dict) -> dict:
    """Call Claude to extract structured fields from a load board email.
    Returns dict with keys: equipment_type, origin, destination, mileage,
    pickup_date, shipment_number. All values may be None on parse failure.
    """
    fallback = {
        "equipment_type": None,
        "origin": None,
        "destination": None,
        "mileage": None,
        "pickup_date": None,
        "shipment_number": None,
    }
    try:
        body = email_data["body"]
        prompt_text = (
            LOAD_BOARD_PARSE_PROMPT[: LOAD_BOARD_PARSE_PROMPT.rfind("Email body:")]
            + f"Email body:\n{body[:3000]}"
        )
        msg = anthropic_client().messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=200,
            messages=[{"role": "user", "content": prompt_text}],
        )
        parsed = json.loads(msg.content[0].text.strip())
        return parsed
    except Exception as exc:
        log.error('"parse_load_board_email failed: %s"', str(exc))
        return fallback


def get_carrier_profile(carrier_id: str) -> dict | None:
    """Query the carriers table for the current carrier's profile.
    Returns the first row (equipment_type, max_radius, home_base_zip) or None.
    """
    try:
        resp = (
            supabase_client()
            .table("carriers")
            .select("equipment_type, max_radius, home_base_zip")
            .eq("id", carrier_id)
            .limit(1)
            .execute()
        )
        if resp.data:
            return resp.data[0]
    except Exception as exc:
        log.error('"get_carrier_profile failed: %s"', exc)
    return None


def load_board_matches_carrier(parsed: dict, carrier: dict) -> bool:
    """Return True if the load's equipment type matches the carrier's.
    Case-insensitive substring check — e.g. carrier 'Dry Van' matches load 'dry van'.
    Logs and returns False on mismatch.
    """
    carrier_equip = (carrier.get("equipment_type") or "").lower()
    load_equip = (parsed.get("equipment_type") or "").lower()
    if not carrier_equip or not load_equip:
        return True  # no data to disqualify on — let it through
    if carrier_equip in load_equip or load_equip in carrier_equip:
        return True
    log.info(
        '"load_board_matches_carrier — mismatch carrier_equip=%s load_equip=%s"',
        carrier_equip, load_equip,
    )
    return False


def send_load_board_sms(email_data: dict, parsed: dict, board_name: str) -> None:
    origin = parsed.get("origin") or "?"
    destination = parsed.get("destination") or "?"
    mileage = parsed.get("mileage")
    equip = parsed.get("equipment_type") or "?"
    pickup = parsed.get("pickup_date") or "?"
    shipment = parsed.get("shipment_number") or "?"

    body = (
        f"{board_name.upper()} ALERT — "
        f"{origin} to {destination} — "
        f"{mileage} mi — "
        f"{equip} — "
        f"Pickup {pickup} — "
        f"Shipment {shipment}"
    )
    try:
        telnyx.api_key = os.environ["TELNYX_API_KEY"]
        telnyx.Message.create(
            from_=os.environ["TELNYX_FROM"],
            to=os.environ["TELNYX_TO"],
            text=body,
        )
        log.info(
            '"SMS sent — load board alert board=%s shipment=%s"',
            board_name, shipment,
        )
    except Exception as exc:
        log.error('"send_load_board_sms failed: %s"', exc)


# ── Thread helpers ────────────────────────────────────────────────────────────

def has_carrier_replied(thread_id: str, refresh_token: str, carrier_email: str) -> bool:
    """Return True if the carrier's own Gmail account has sent a message in this thread.
    Checks thread message headers for carrier_email as the From address.
    Returns False on any exception so SMS is never suppressed due to an API error.
    """
    try:
        thread = (
            gmail_service(refresh_token)
            .users()
            .threads()
            .get(
                userId="me",
                id=thread_id,
                format="metadata",
                metadataHeaders=["From"],
            )
            .execute()
        )
        carrier_email = (carrier_email or "").lower()
        for message in thread.get("messages", []):
            headers = message.get("payload", {}).get("headers", [])
            for h in headers:
                if h.get("name", "").lower() == "from" and carrier_email in h.get("value", "").lower():
                    return True
    except Exception as exc:
        log.error('"has_carrier_replied failed thread=%s: %s"', thread_id, exc)
    return False


# ── Core processing pipeline ───────────────────────────────────────────────────

def process_message(message_id: str, carrier_id: str, refresh_token: str, carrier_email: str) -> None:
    """Full pipeline for one Gmail message."""
    print("[BUILD_MARKER_20260603A] entered", flush=True)

    # Step 1 — deduplication FIRST, before any API calls or processing
    # Prevents 150x replay: if the message is already in either table, stop immediately.
    if is_duplicate(message_id):
        log.info('"duplicate message %s — skipping"', message_id)
        return

    # Step 2 — fetch email content from Gmail API
    email_data = fetch_message(message_id, refresh_token)
    if not email_data:
        return

    log.info('"processing message %s from %s"', message_id, email_data["from_email"])

    # Step 2.5 — Y5 thread-state dedup (v8.1 §2): suppress SMS on threads
    # already in a terminal ELA stage. Scoped by (carrier_id, thread_id).
    try:
        _y5 = (
            supabase_service_client()
            .table("edge_load_activity")
            .select("id, stage")
            .eq("carrier_id", carrier_id)
            .eq("thread_id", email_data["thread_id"])
            .in_("stage", ["booked", "passed", "closed", "expired"])
            .limit(1)
            .execute()
        )
        if _y5.data:
            log.info('"Y5 dedup — thread=%s stage=%s — suppressing"',
                     email_data["thread_id"], _y5.data[0]["stage"])
            return
    except Exception as _exc:
        log.error('"Y5 dedup lookup failed: %s"', _exc)

    # Step 3a — load board intercept (before broker lookup)
    if is_load_board_email(email_data["from_email"]):
        board_name = LOAD_BOARD_SENDERS[email_data["from_email"].lower().strip()]
        log.info('"load board email detected board=%s message=%s"', board_name, message_id)

        parsed = parse_load_board_email(email_data)
        if parsed is None:
            log.error('"load board parse failed — skipping message=%s"', message_id)
            return
        carrier = get_carrier_profile(carrier_id)

        if carrier and not load_board_matches_carrier(parsed, carrier):
            log.info('"load board message skipped — equipment mismatch message=%s"', message_id)
            return

        send_load_board_sms(email_data, parsed, board_name)
        return

    # ── Pre-Haiku Gates (v8.0) ────────────────────────────────────
    # Purpose: prevent unnecessary Haiku API calls. A gate that drops an email
    # simply returns — it does NOT mark the message read and does NOT touch
    # inbox state. The carrier's Gmail inbox is left exactly as delivered.
    #
    #   Gate A  — platform subject catch-all (ACE LOAD, ACE ALERT, ACE , EDGE )
    #   Gate B  — noise match (hardcoded prefixes + platform_noise + carrier_noise)
    #   Gate C1 — exact email match in brokers table (known contact)
    #   Gate C2 — domain match derived from broker emails (known brokerage,
    #              unknown contact — e.g. mary@ when john@ is the known contact)
    #   Cleared — unknown sender that passed all gates → Haiku decides:
    #              load_offer   → log to unknown_brokers_inbox + SMS to carrier
    #              anything else → log to unknown_brokers_inbox, silent drop
    #   Auto-promotion: any carrier interaction (reply, BOOK, RE-BID, PASS)
    #              promotes sender from unknown_brokers_inbox to brokers table.
    #
    # LOCKED: broker extraction process is untouchable. Gate C2 derives domain
    # from existing broker email records — no schema changes required.

    _sender = (email_data.get("from_email") or "").lower().strip()
    _local  = _sender.split("@")[0] if "@" in _sender else ""
    _domain = _sender.split("@")[-1] if "@" in _sender else ""

    # ── Gate A — platform subject catch-all ───────────────────────
    # Drops any email whose subject starts with a platform-generated prefix.
    # Covers all ACE and EDGE generated alerts in all forms. Option 1 locked:
    # simple prefix match, zero SB reads, no broker domain cross-check.
    _PLATFORM_SUBJECT_PREFIXES = (
        "ACE LOAD",
        "ACE ALERT",
        "ACE ",
        "EDGE ",
    )
    _subject = (email_data.get("subject") or "").strip().upper()
    if _subject.startswith(_PLATFORM_SUBJECT_PREFIXES):
        log.info('"gate A — platform subject dropped subject=%s"', _subject)
        return

    # ── Gate B — noise match ──────────────────────────────────────────
    # Hardcoded core prefixes and domains are universal and un-deletable.
    # Expanded prefix list catches common automated freight/logistics senders.
    # platform_noise: admin-managed global suppressions (all carriers).
    # carrier_noise:  per-carrier suppressions managed via carrier dashboard UI.
    # Fail-open: Supabase read failure falls back to hardcoded core only.
    _core_noise_domains = {
        "stripe.com", "paypal.com", "amazonaws.com", "github.com",
        "squarespace.com", "twilio.com", "supabase.io", "anthropic.com",
        "irs.gov", "dol.gov", "fmcsa.dot.gov", "dot.gov",
    }
    _core_noise_prefixes = {
        "noreply", "no-reply", "donotreply", "do-not-reply",
        "notifications", "automated", "mailer", "bounce",
        "loadmatch", "alert", "alerts", "dispatch-auto",
        "billing", "invoice", "payment", "support",
        "newsletter", "marketing", "unsubscribe",
    }
    _noise_domains:   set[str] = set(_core_noise_domains)
    _noise_prefixes:  set[str] = set(_core_noise_prefixes)
    _noise_addresses: set[str] = set()

    try:
        _pf = (
            supabase_client()
            .table("platform_noise")
            .select("match_type, value")
            .eq("active", True)
            .execute()
        )
        for _row in (_pf.data or []):
            _mt  = _row.get("match_type")
            _val = (_row.get("value") or "").lower().strip()
            if not _val:
                continue
            if _mt == "domain":
                _noise_domains.add(_val)
            elif _mt == "prefix":
                _noise_prefixes.add(_val)
            elif _mt == "address":
                _noise_addresses.add(_val)
    except Exception as _exc:
        log.error('"gate B — platform_noise read failed: %s"', _exc)

    try:
        _cn = (
            supabase_client()
            .table("carrier_noise")
            .select("match_type, value")
            .eq("carrier_id", carrier_id)
            .eq("active", True)
            .execute()
        )
        for _row in (_cn.data or []):
            _mt  = _row.get("match_type")
            _val = (_row.get("value") or "").lower().strip()
            if not _val:
                continue
            if _mt == "domain":
                _noise_domains.add(_val)
            elif _mt == "prefix":
                _noise_prefixes.add(_val)
            elif _mt == "address":
                _noise_addresses.add(_val)
    except Exception as _exc:
        log.error('"gate B — carrier_noise read failed: %s"', _exc)

    if (
        _sender in _noise_addresses
        or _local in _noise_prefixes
        or any(_domain == d or _domain.endswith("." + d) for d in _noise_domains)
    ):
        log.info('"gate B — noise dropped sender=%s"', _sender)
        return

    # ── Gate C1 — exact email match in brokers table ──────────────────
    # Fastest broker path: sender is a fully validated known contact for this
    # carrier. Single SB read on indexed email+carrier_id columns.
    _broker = None
    try:
        _c1 = (
            supabase_client()
            .table("brokers")
            .select("*")
            .eq("email", _sender)
            .eq("carrier_id", carrier_id)
            .limit(1)
            .execute()
        )
        if _c1.data:
            _broker = _c1.data[0]
            log.info('"gate C1 — known contact matched sender=%s broker_id=%s"',
                     _sender, _broker.get("id"))
    except Exception as _exc:
        log.error('"gate C1 — brokers exact lookup failed: %s"', _exc)

    # ── Gate C2 — domain match derived from broker emails ─────────────────
    # Handles unknown contacts at known brokerages (e.g. mary@ntgfreight.com
    # when john@ntgfreight.com is the validated contact). Derives domain from
    # existing broker email column via LIKE query — no schema changes required.
    # LOCKED: broker extraction process is not touched.
    if _broker is None and _domain:
        try:
            _c2 = (
                supabase_client()
                .table("brokers")
                .select("*")
                .eq("carrier_id", carrier_id)
                .ilike("email", f"%@{_domain}")
                .limit(1)
                .execute()
            )
            if _c2.data:
                _broker = _c2.data[0]
                log.info('"gate C2 — known domain matched sender=%s domain=%s broker_id=%s"',
                         _sender, _domain, _broker.get("id"))
        except Exception as _exc:
            log.error('"gate C2 — brokers domain lookup failed: %s"', _exc)

    # ── Known broker path (C1 or C2 matched) ──────────────────────
    if _broker:
        log.info('"known broker path — classifying message_id=%s from=%s"',
                 message_id, _sender)

        classification = classify_reply(email_data)
        log.info('"classified %s as %s"', message_id, classification)

        # Insert into responses FIRST — this is the dedup anchor.
        # Must succeed before SMS so any retry finds it and stops.
        log_response(email_data, classification, carrier_id,
                     broker_id=_broker.get("id"),
                     broker_name=_broker.get("name"))

        # ── Volley 2 detection (v8.1 §3.7) ───────────────────────────
        # If this thread already has an open edge_load_activity row at
        # stage='counter', the broker is replying to our carrier's counter.
        # Haiku verdict drives the next action — independent of the regular
        # load_offer branch below.
        try:
            _vol2_lookup = (
                supabase_service_client()
                .table("edge_load_activity")
                .select("id, stage, rate_offered, carrier_rebid, broker_email, "
                        "broker_first_name, broker_last_name, broker_company, "
                        "pickup_city, pickup_state, delivery_city, delivery_state, "
                        "miles, source")
                .eq("thread_id", email_data["thread_id"])
                .eq("carrier_id", carrier_id)
                .eq("stage", "counter")
                .order("created_at", desc=True)
                .limit(1)
                .execute()
            )
            _vol2_row = _vol2_lookup.data[0] if _vol2_lookup.data else None
        except Exception as _exc:
            log.error('"volley2 lookup failed: %s"', _exc)
            _vol2_row = None

        if _vol2_row:
            log.info('"volley 2 detected — thread=%s row=%s classification=%s"',
                     email_data["thread_id"], _vol2_row["id"], classification)
            _handle_volley2_reply(
                row=_vol2_row,
                classification=classification,
                email_data=email_data,
                carrier_id=carrier_id,
                broker=_broker,
            )
            update_broker_status(_broker["id"], classification)
            return  # volley 2 handled — do not fall through to regular load_offer branch

        if classification.lower() == "load_offer":
            log.info('"SMS DIAGNOSTIC — entering load_offer branch message_id=%s thread_id=%s carrier_email=%s"',
                     email_data["message_id"], email_data["thread_id"], carrier_email)
            replied = has_carrier_replied(email_data["thread_id"], refresh_token, carrier_email)
            log.info('"SMS DIAGNOSTIC — has_carrier_replied returned %s for thread=%s"',
                     replied, email_data["thread_id"])
            if not replied:
                # Per v8.1 §2 — extract load details only after classification confirms
                # load_offer. Avoids unnecessary Haiku call on positive/negative.
                _extracted = classify_and_extract(email_data)
                log.error('"DIAG_EXTRACT: %s"', _extracted)
                if _extracted.get("classification") != "load_offer":
                    # Haiku disagreement between classify_reply and classify_and_extract.
                    # Trust the extract (it had more context) and log the disagreement.
                    log.info('"haiku disagreement — classify_reply=load_offer extract=%s message=%s"',
                             _extracted.get("classification"), message_id)
                else:
                    # Fetch carrier dict for signature templating + phone
                    _carrier = _get_carrier_dict(carrier_id)
                    log.info('"SMS — calling send_load_offer_sms_v2 for known broker"')
                    send_load_offer_sms_v2(
                        carrier=_carrier,
                        broker=_broker,
                        extracted=_extracted,
                        email_data=email_data,
                    )
            else:
                log.info('"SMS suppressed — carrier already replied in thread=%s"',
                         email_data["thread_id"])

        update_broker_status(_broker["id"], classification)

    # ── Cleared all gates — unknown sender ──────────────────────────────────────────
    # Sender passed Gates A, B, C1, C2 but is not a known broker or domain.
    # Haiku classifies via classify_and_extract (classify + extract in one call).
    #   load_offer   → log to unknown_brokers_inbox + SMS to carrier (v8.1 v2 path).
    #                  Auto-promotion to brokers table on carrier interaction:
    #                  reply, BOOK, RE-BID, or PASS.
    #   anything else → log to unknown_brokers_inbox only, silent drop.
    #                  Carrier reviews pending queue via dashboard.
    else:
        log.info('"gate cleared — unknown sender %s — classifying"', _sender)

        extracted = classify_and_extract(email_data)
        classification = extracted.get("classification", "negative")
        log.info('"unknown sender classified %s as %s"', message_id, classification)

        log_unknown_broker_inbox(email_data, extracted, carrier_id)

        if classification.lower() == "load_offer":
            log.info('"unknown sender load offer — SMS firing from=%s"', _sender)
            _carrier = _get_carrier_dict(carrier_id)
            send_load_offer_sms_v2(
                carrier=_carrier,
                broker=None,  # unknown sender — broker_id will be NULL on edge_load_activity
                extracted=extracted,
                email_data=email_data,
            )
            # Auto-promotion to brokers table occurs on carrier interaction.
            # See: BOOK/RE-BID/PASS token handlers (§8) and reply detection.
        else:
            log.info('"unknown sender non-offer — logged to unknown_brokers_inbox silent drop from=%s"',
                     _sender)



# ── Flask route ────────────────────────────────────────────────────────────────

@app.route("/webhook", methods=["POST"])
def webhook():
    """
    Receive Pub/Sub push messages from Gmail Watch.
    ALWAYS returns 200 — any non-200 causes Pub/Sub to retry indefinitely.
    The outer try/except guarantees this even on unexpected exceptions.
    """

    # Token verification runs outside the outer try so a bad token still
    # gets a 403 (deliberate — not a Pub/Sub delivery).
    expected_token = os.environ.get("PUBSUB_VERIFICATION_TOKEN", "")
    if expected_token:
        received_token = request.args.get("token", "")
        if received_token != expected_token:
            log.warning('"invalid verification token"')
            return jsonify({"error": "forbidden"}), 403

    try:
        # ── Parse envelope ────────────────────────────────────────────────────
        envelope = request.get_json(silent=True)
        if not envelope or "message" not in envelope:
            log.warning('"malformed pub/sub envelope"')
            return jsonify({"ok": True}), 200

        pubsub_message = envelope["message"]

        try:
            raw_data = base64.b64decode(pubsub_message.get("data", "")).decode("utf-8")
            notification = json.loads(raw_data)
        except Exception as exc:
            log.error('"failed to decode pub/sub data: %s"', exc)
            return jsonify({"ok": True}), 200

        email_address = notification.get("emailAddress", "")
        new_history_id = str(notification.get("historyId", ""))

        if not email_address or not new_history_id:
            log.warning('"notification missing emailAddress or historyId"')
            return jsonify({"ok": True}), 200

        print(f"[WEBHOOK] pubsub notification received — emailAddress={email_address} newHistoryId={new_history_id}", flush=True)

        carrier_resp = (
            supabase_client()
            .table("carriers")
            .select("id, gmail_token, email")
            .eq("email", email_address)
            .limit(1)
            .execute()
        )
        if not carrier_resp.data:
            log.warning('"[WEBHOOK] no carrier found for email=%s — skipping"', email_address)
            return jsonify({"ok": True}), 200
        carrier_row = carrier_resp.data[0]
        carrier_id = carrier_row["id"]
        refresh_token = carrier_row.get("gmail_token")
        carrier_email = carrier_row.get("email", email_address)
        if not refresh_token:
            log.error('"[WEBHOOK] carrier %s has no gmail_token — skipping"', email_address)
            return jsonify({"ok": True}), 200

        # ── historyId tracking ────────────────────────────────────────────────
        stored_history_id = get_stored_history_id(email_address)
        print(f"[WEBHOOK] gmail_sync lookup result — email={email_address} storedHistoryId={stored_history_id!r}", flush=True)

        if not stored_history_id:
            print(f"[WEBHOOK] BRANCH: no stored historyId — seeding with {new_history_id} and returning 200", flush=True)
            upsert_history_id(email_address, new_history_id)
            return jsonify({"ok": True}), 200

        delta = int(new_history_id) - int(stored_history_id) if new_history_id.isdigit() and stored_history_id.isdigit() else "?"
        print(f"[WEBHOOK] BRANCH: stored historyId found — startHistoryId={stored_history_id} delta={delta}", flush=True)

        # ── Fetch messages (primary then fallback) ────────────────────────────
        new_messages = get_history(stored_history_id, refresh_token)
        print(f"[WEBHOOK] get_history returned — messageCount={len(new_messages)}", flush=True)

        if not new_messages:
            print(f"[WEBHOOK] messageCount=0 — triggering fallback now", flush=True)
            new_messages = get_unread_messages(refresh_token)
            print(f"[WEBHOOK] fallback returned — messageCount={len(new_messages)}", flush=True)

        # ── Process each message ──────────────────────────────────────────────
        for idx, msg in enumerate(new_messages):
            print(f"[WEBHOOK] dispatching message[{idx}] id={msg.get('id')}", flush=True)
            try:
                process_message(msg["id"], carrier_id, refresh_token, carrier_email)
            except Exception as exc:
                log.error('"unhandled error processing %s: %s"', msg.get("id"), exc)
                print(f"[WEBHOOK] ERROR processing message {msg.get('id')}: {exc}", flush=True)

        # ── Advance stored historyId ──────────────────────────────────────────
        print(f"[WEBHOOK] advancing historyId from {stored_history_id} to {new_history_id}", flush=True)
        upsert_history_id(email_address, new_history_id)

    except Exception as exc:
        # Catch-all: log the error but always return 200 to prevent Pub/Sub retries
        log.error('"WEBHOOK unhandled exception — returning 200 to prevent retry loop: %s"', exc, exc_info=True)
        print(f"[WEBHOOK] UNHANDLED EXCEPTION (returning 200): {exc}", flush=True)

    return jsonify({"ok": True}), 200


@app.route("/health", methods=["GET"])
def health():
    """Cloud Run health check."""
    return jsonify({"status": "ok", "service": "edgeai-gmail-webhook"}), 200


@app.route("/debug-telnyx", methods=["GET"])
def debug_telnyx():
    """Verify which telnyx version is actually deployed and what attributes exist."""
    info = {
        "telnyx_version": getattr(telnyx, "__version__", "UNKNOWN"),
        "has_Message": hasattr(telnyx, "Message"),
        "telnyx_module_file": getattr(telnyx, "__file__", "UNKNOWN"),
        "dir_telnyx_top10": [x for x in dir(telnyx) if not x.startswith("_")][:30],
    }
    return jsonify(info)


@app.route("/debug-gmail", methods=["GET"])
def debug_gmail():
    try:
        carrier_id = request.args.get("carrier_id")
        if not carrier_id:
            return jsonify({"error": "carrier_id query param required"}), 400
        resp = supabase_client().table("carriers").select("gmail_token").eq("id", carrier_id).limit(1).execute()
        if not resp.data:
            return jsonify({"error": "carrier not found"}), 404
        refresh_token = resp.data[0].get("gmail_token")
        if not refresh_token:
            return jsonify({"error": "carrier has no gmail_token"}), 400
        svc = gmail_service(refresh_token)
        profile = svc.users().getProfile(userId="me").execute()
        return jsonify({"email": profile.get("emailAddress"), "messagesTotal": profile.get("messagesTotal")})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/confirm-win", methods=["POST"])
def confirm_win():
    """
    Dashboard calls this when a carrier confirms a load offer as won.
    Marks the response row load_accepted=true and logs it to load_wins.
    Never returns 5xx.
    """
    try:
        data = request.get_json(silent=True) or {}
        message_id = data.get("message_id")
        if not message_id:
            return jsonify({"error": "message_id required"}), 400

        resp = (
            supabase_client()
            .table("responses")
            .select("*")
            .eq("gmail_message_id", message_id)
            .limit(1)
            .execute()
        )

        if not resp.data:
            return jsonify({"error": "not found"}), 404

        row = resp.data[0]

        if row["classification"] != "load_offer":
            return jsonify({"error": "not a load offer"}), 400

        supabase_client().table("responses").update(
            {"load_accepted": True}
        ).eq("gmail_message_id", message_id).execute()

        log_load_win({
            "from_email": row["broker_email"],
            "subject": row["subject"],
            "body": row["body"],
            "message_id": row["gmail_message_id"],
        }, row["carrier_id"])

        return jsonify({"ok": True, "win_logged": True}), 200

    except Exception as exc:
        log.error('"confirm_win — unhandled exception: %s"', exc, exc_info=True)
        return jsonify({"ok": False, "error": "internal error"}), 200


@app.route("/renew-watches", methods=["POST"])
def renew_watches():
    """
    Renew Gmail Watch for all active carriers using per-carrier gmail_token
    from carriers table. Gmail Watch expires every 7 days — invoke weekly
    via Cloud Scheduler. Always returns 200 so Cloud Scheduler does not retry.
    """
    count_success = 0
    count_errors = 0

    try:
        project = os.environ.get("GOOGLE_CLOUD_PROJECT", "edgeai-493115")
        topic_name = f"projects/{project}/topics/edgeai-gmail"

        resp = (
            supabase_client()
            .table("carriers")
            .select("email, gmail_token")
            .eq("status", "active")
            .eq("subscription_status", "active")
            .execute()
        )
        carriers = resp.data or []

        if not carriers:
            log.warning('"renew_watches — no active carriers with active subscriptions"')
            return jsonify({"renewed": 0, "errors": 0}), 200

        for carrier in carriers:
            email = carrier.get("email", "")
            refresh_token = carrier.get("gmail_token")
            try:
                if not refresh_token:
                    log.error('"renew_watches — no gmail_token for carrier email=%s"', email)
                    count_errors += 1
                    continue
                result = (
                    gmail_service(refresh_token)
                    .users()
                    .watch(
                        userId="me",
                        body={"topicName": topic_name, "labelIds": ["INBOX"]},
                    )
                    .execute()
                )
                new_history_id = str(result.get("historyId", ""))
                if new_history_id:
                    upsert_history_id(email, new_history_id)
                log.info('"renew_watches — renewed email=%s historyId=%s expiration=%s"',
                         email, new_history_id, result.get("expiration"))
                count_success += 1
            except Exception as exc:
                log.error('"renew_watches — failed for email=%s: %s"', email, exc)
                count_errors += 1

    except Exception as exc:
        log.error('"renew_watches — unhandled exception: %s"', exc, exc_info=True)
        return jsonify({"renewed": 0, "errors": 1}), 200

    return jsonify({"renewed": count_success, "errors": count_errors}), 200


_NOISE_DOMAINS_INBOX = {
    "apple.com", "icloud.com", "google.com", "gmail.com",
    "microsoft.com", "outlook.com", "hotmail.com",
    "amazonaws.com", "twilio.com", "supabase.io", "stripe.com",
    "anthropic.com", "github.com", "squarespace.com",
    "highway.com", "truckstop.com", "dat.com",
    "sylectus.com", "omnitracs.com", "paypal.com",
    "ntgfreight.com", "e.truckstop.com", "spotinc.com",
    "prdlax.com", "loadmatches.com", "notifications.com",
    "macropoint.com", "fourkites.com", "project44.com",
    "keeptruckin.com", "motive.com", "samsara.com",
    "irs.gov", "dol.gov", "fmcsa.dot.gov",
    "xtxtransport.com", "xedge-ai.com", "xtxtec.com",
}

_ENRICH_PROMPT = (
    "You are enriching a freight broker contact record from an email.\n\n"
    "Return ONLY a valid JSON object with exactly these fields:\n"
    "{{\n"
    '  "name": "First Last or null",\n'
    '  "company": "Brokerage name or null",\n'
    '  "phone": "mobile phone only — null if not found or only landline",\n'
    '  "status": "hot | warm | cold — hot=recent active load offer, cold=old/generic",\n'
    '  "priority": "high | medium | low — based on load volume signals in the email",\n'
    '  "notes": "1-sentence summary of relationship or load type or null",\n'
    '  "last_load_origin": "City ST format or null",\n'
    '  "last_load_destination": "City ST format or null"\n'
    "}}\n\n"
    "Sender name hint: {name}\n"
    "Email body:\n{body}"
)


def _scan_sent_and_enrich(carrier_id: str, days: int = 180) -> None:
    """Background thread: scan SENT 180 days, extract broker contacts, Claude-enrich, write to brokers."""
    log.info('[extract-brokers] scan started carrier_id=%s days=%d', carrier_id, days)
    try:
        # ── Carrier + Gmail setup ─────────────────────────────────────────────
        carrier_resp = (
            supabase_client()
            .table("carriers")
            .select("*")
            .eq("id", carrier_id)
            .limit(1)
            .execute()
        )
        if not carrier_resp.data:
            log.error('[extract-brokers] carrier not found carrier_id=%s', carrier_id)
            return
        carrier = carrier_resp.data[0]

        refresh_token = carrier.get("gmail_token")
        if not refresh_token:
            log.error('[extract-brokers] no gmail_token carrier_id=%s', carrier_id)
            return

        import google.auth.transport.requests as google_requests
        import requests as requests_lib
        carrier_creds = OAuthCredentials(
            token=None,
            refresh_token=refresh_token,
            token_uri="https://oauth2.googleapis.com/token",
            client_id=os.environ["GMAIL_CLIENT_ID"],
            client_secret=os.environ["GMAIL_CLIENT_SECRET"],
            scopes=["https://www.googleapis.com/auth/gmail.modify"],
        )
        carrier_creds.refresh(google_requests.Request(session=requests_lib.Session()))
        svc = build("gmail", "v1", credentials=carrier_creds, cache_discovery=False)

        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y/%m/%d")

        # ── Step 1: Page through SENT message IDs ────────────────────────────
        message_ids: list[str] = []
        page_token = None
        while True:
            list_kwargs: dict = {
                "userId": "me",
                "labelIds": ["SENT"],
                "q": f"after:{cutoff}",
                "maxResults": 500,
            }
            if page_token:
                list_kwargs["pageToken"] = page_token
            try:
                resp = svc.users().messages().list(**list_kwargs).execute()
            except Exception as exc:
                log.error('[extract-brokers] gmail list failed: %s', exc)
                break
            message_ids.extend(m["id"] for m in resp.get("messages", []))
            page_token = resp.get("nextPageToken")
            if not page_token or len(message_ids) >= 500:
                break
        message_ids = message_ids[:500]
        log.info('[extract-brokers] sent scan total_ids=%d', len(message_ids))

        # ── Step 2: Batch metadata — TO: + Subject: headers ──────────────────
        # Hard drop: definitely not a broker, no review value
        _HARD_NOISE_DOMAINS = {
            # EDGEai own domains
            "xtxtransport.com", "xedge-ai.com", "xtxtec.com",
            # Cloud / dev infrastructure
            "amazonaws.com", "oraclecloud.com", "github.com",
            # Payment / billing
            "stripe.com", "paypal.com", "zellepay.com",
            "triumphpay.com", "expressfreightfinance.com",
            # SaaS / platforms
            "squarespace.com", "twilio.com", "supabase.io",
            "anthropic.com", "webinarjam.net",
            # TMS / visibility / ELD platforms
            "sylectus.com", "omnitracs.com", "macropoint.com",
            "fourkites.com", "project44.com", "keeptruckin.com",
            "motive.com", "samsara.com", "truckertools.com",
            # Load boards / brokerage platforms — NOT blocked; real broker contacts work here
            # e.g. tql.com, ntgfreight.com, spotinc.com, dat.com, truckstop.com, priority1.com
            # Insurance / compliance
            "trkinsure.com", "registrymonitoring.com", "lgiinc.com",
            # Marketing / notifications
            "notifications.com", "linkt.io",
            # Automotive / unrelated commerce
            "carmax.com",
            # Government
            "irs.gov", "dol.gov", "fmcsa.dot.gov", "dot.gov",
            # Misc junk
            "g2mint.com", "e.truckstop.com",
        }
        # Personal domains: route to unknown_brokers_inbox for carrier review
        _PERSONAL_DOMAINS = {
            "gmail.com", "googlemail.com", "google.com",
            "yahoo.com", "yahoo.co.uk",
            "outlook.com", "hotmail.com", "live.com", "msn.com",
            "icloud.com", "apple.com",
            "aol.com", "protonmail.com", "proton.me",
            "microsoft.com",
        }
        # No-reply automated senders — hard drop. "info" removed: info@brokerfirm.com is valid.
        _NOREPLY_PREFIXES = {
            "noreply", "no-reply", "donotreply", "do-not-reply",
            "notifications", "automated", "mailer", "bounce",
            "newsletter", "updates",
        }
        # Role prefixes that may carry load opportunities — route to unknown_brokers_inbox for review
        _REVIEW_PREFIXES = {"dispatch", "dispatcher"}

        email_subjects: dict[str, list[str]] = {}
        email_names: dict[str, str] = {}
        email_message_ids: dict[str, str] = {}
        email_sent_dates: dict[str, str] = {}  # most recent SENT timestamp per recipient
        personal_domain_contacts: dict[str, str] = {}  # email -> display name (for unknown review)

        def _is_hard_noise(email: str) -> bool:
            if "@" not in email:
                return True
            local, domain = email.rsplit("@", 1)
            if local in _NOREPLY_PREFIXES:
                return True
            for noise in _HARD_NOISE_DOMAINS:
                if domain == noise or domain.endswith("." + noise):
                    return True
            return False

        def _is_personal_domain(email: str) -> bool:
            if "@" not in email:
                return False
            _, domain = email.rsplit("@", 1)
            return domain in _PERSONAL_DOMAINS

        def _handle_meta(request_id, response, exception):
            if exception or not response:
                return
            headers = response.get("payload", {}).get("headers", [])
            to_val = subject_val = date_val = ""
            for h in headers:
                n = h.get("name", "").lower()
                if n == "to":
                    to_val = h.get("value", "")
                elif n == "subject":
                    subject_val = h.get("value", "")
                elif n == "date":
                    date_val = h.get("value", "")
            if not to_val:
                return
            to_name, to_email = parseaddr(to_val)
            to_email = to_email.lower().strip()
            if not to_email or "@" not in to_email:
                return
            if _is_hard_noise(to_email):
                return
            _to_local = to_email.split("@")[0]
            _to_domain = to_email.split("@")[1]
            if _is_personal_domain(to_email) or _to_local in _REVIEW_PREFIXES or "dispatch" in _to_domain:
                if to_email not in personal_domain_contacts:
                    personal_domain_contacts[to_email] = to_name.strip() if to_name else ""
                return
            # Parse sent date — Date header is most reliable in batch responses
            sent_ts = None
            if date_val:
                try:
                    sent_ts = parsedate_to_datetime(date_val).astimezone(timezone.utc).isoformat()
                except Exception:
                    pass
            if not sent_ts:
                internal_ms = response.get("internalDate")
                if internal_ms:
                    try:
                        sent_ts = datetime.fromtimestamp(int(internal_ms) / 1000, tz=timezone.utc).isoformat()
                    except Exception:
                        pass
            if sent_ts:
                if to_email not in email_sent_dates or sent_ts > email_sent_dates[to_email]:
                    email_sent_dates[to_email] = sent_ts
            if to_email not in email_message_ids:
                email_message_ids[to_email] = request_id
            if to_email not in email_names and to_name:
                email_names[to_email] = to_name.strip()
            if to_email not in email_subjects:
                email_subjects[to_email] = []
            if subject_val and subject_val not in email_subjects[to_email]:
                email_subjects[to_email].append(subject_val)

        chunks = [message_ids[i:i + 100] for i in range(0, len(message_ids), 100)]
        for chunk_idx, chunk in enumerate(chunks):
            batch_req = svc.new_batch_http_request(callback=_handle_meta)
            for msg_id in chunk:
                batch_req.add(
                    svc.users().messages().get(
                        userId="me", id=msg_id, format="metadata",
                        metadataHeaders=["To", "Subject", "Date"],
                    ),
                    request_id=msg_id,
                )
            try:
                batch_req.execute()
            except Exception as exc:
                log.error('[extract-brokers] batch meta failed chunk=%d: %s', chunk_idx + 1, exc)
        log.info('[extract-brokers] unique recipients=%d personal_domain_contacts=%d',
                 len(email_subjects), len(personal_domain_contacts))

        # ── Step 2b: Route personal-domain sent contacts to unknown_brokers_inbox ─
        if personal_domain_contacts:
            existing_unknown_resp = (
                supabase_client()
                .table("unknown_brokers_inbox")
                .select("sender_email")
                .eq("carrier_id", carrier_id)
                .execute()
            )
            known_unknown = {row["sender_email"].lower() for row in (existing_unknown_resp.data or [])}
            for p_email, p_name in personal_domain_contacts.items():
                if p_email in known_unknown:
                    continue
                try:
                    supabase_client().table("unknown_brokers_inbox").insert({
                        "carrier_id": carrier_id,
                        "gmail_message_id": email_message_ids.get(p_email) or f"sent-scan-{p_email}",
                        "sender_email": p_email,
                        "sender_name": p_name or None,
                        "raw_email": "[Found in SENT — personal domain — review to add as broker]",
                        "classification": "unknown",
                        "status": "pending_review",
                        "created_at": datetime.now(timezone.utc).isoformat(),
                    }).execute()
                except Exception as exc:
                    log.error('[extract-brokers] unknown_inbox insert failed email=%s: %s', p_email, exc)
            log.info('[extract-brokers] personal domain contacts routed to unknown_brokers_inbox count=%d',
                     len(personal_domain_contacts))

        # ── Step 3: Deduplicate — new vs. enhanceable (existing with null fields) ─
        known_resp = (
            supabase_client()
            .table("brokers")
            .select("email,phone,company,title")
            .eq("carrier_id", carrier_id)
            .execute()
        )
        known_map: dict[str, dict] = {row["email"].lower(): row for row in (known_resp.data or [])}
        new_emails = [e for e in email_subjects if e not in known_map]
        # Enhanceable = existing record missing phone, company, or title
        enhance_emails = [
            e for e in email_subjects if e in known_map and
            not all([known_map[e].get("phone"), known_map[e].get("company"), known_map[e].get("title")])
        ]
        process_emails = new_emails + enhance_emails
        log.info('[extract-brokers] new=%d enhance=%d skip=%d',
                 len(new_emails), len(enhance_emails),
                 len(email_subjects) - len(new_emails) - len(enhance_emails))

        # ── Steps 4+5: Per-broker pipeline — fetch sig → enrich → write (streaming) ─
        # Each broker goes start-to-finish in one thread. Records land in SB as they
        # complete. A crash mid-run loses only the in-flight batch, not everything.

        def _extract_body_text(msg):
            def _get_text(part):
                if part.get("mimeType") == "text/plain":
                    data = part.get("body", {}).get("data", "")
                    if data:
                        return base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="ignore")
                for subpart in part.get("parts", []):
                    result = _get_text(subpart)
                    if result:
                        return result
                return ""
            return _get_text(msg.get("payload", {}))

        imported = 0
        enhanced = 0

        def _process_broker(email):
            nonlocal imported, enhanced
            import google.auth.transport.requests as _greq
            import requests as _rlib

            # ── 4a: Build thread-local Gmail service (httplib2 not thread-safe) ──
            signature = ""
            try:
                _creds = OAuthCredentials(
                    token=None,
                    refresh_token=refresh_token,
                    token_uri="https://oauth2.googleapis.com/token",
                    client_id=os.environ["GMAIL_CLIENT_ID"],
                    client_secret=os.environ["GMAIL_CLIENT_SECRET"],
                    scopes=["https://www.googleapis.com/auth/gmail.modify"],
                )
                _creds.refresh(_greq.Request(session=_rlib.Session()))
                _svc = build("gmail", "v1", credentials=_creds, cache_discovery=False)
                resp = _svc.users().messages().list(
                    userId="me",
                    q=f'from:"{email}"',
                    maxResults=1,
                ).execute()
                msgs = resp.get("messages", [])
                if msgs:
                    msg = _svc.users().messages().get(
                        userId="me", id=msgs[0]["id"], format="full"
                    ).execute()
                    body = _extract_body_text(msg)
                    lines = [l.strip() for l in body.splitlines() if l.strip()]
                    signature = "\n".join(lines[-10:])
            except Exception as exc:
                log.error('[extract-brokers] sig fetch failed email=%s: %s', email, exc)

            # ── 4b: Claude enrich ─────────────────────────────────────────────────
            to_name = email_names.get(email, "")
            prompt_text = (
                "Extract contact details from the email signature block below.\n\n"
                "Return a JSON object with exactly these fields:\n"
                "{\"name\": \"first last or null\", "
                "\"title\": \"job title max 25 chars or null\", "
                "\"company\": \"brokerage or company name or null\", "
                "\"phone\": \"mobile number only or null\"}\n\n"
                "Phone rules — ONLY return a number explicitly labeled Mobile, Cell, or M. "
                "Return null if the only numbers present are labeled Office, Afterhours, "
                "After Hours, Direct, Desk, Ext, or are 800/toll-free numbers. "
                "Never return an office number or afterhours number.\n\n"
                "Title rule: max 25 characters — truncate if longer.\n\n"
                "Return ONLY valid JSON, no other text.\n\n"
                f"Sender name hint: {to_name or 'unknown'}\n"
                f"Signature:\n{signature or 'not available'}"
            )
            try:
                claude_msg = anthropic_client().messages.create(
                    model="claude-haiku-4-5-20251001",
                    max_tokens=200,
                    messages=[{"role": "user", "content": prompt_text}],
                )
                enriched = json.loads(claude_msg.content[0].text.strip())
            except Exception as exc:
                log.error('[extract-brokers] enrich failed email=%s: %s', email, exc)
                enriched = {}

            # ── 4c: Write to SB immediately ───────────────────────────────────────
            last_contacted = email_sent_dates.get(email)
            is_new = email not in known_map
            try:
                if is_new:
                    supabase_client().table("brokers").insert({
                        "carrier_id": carrier_id,
                        "email": email,
                        "name": enriched.get("name") or to_name or None,
                        "title": (enriched.get("title") or "")[:25] or None,
                        "company": enriched.get("company"),
                        "phone": enriched.get("phone"),
                        "last_contacted": last_contacted,
                        "status": "warm",
                        "priority": "medium",
                        "days_cadence": 3,
                    }).execute()
                    imported += 1
                    log.info('[extract-brokers] inserted email=%s', email)
                else:
                    existing = known_map[email]
                    patch = {}
                    if not existing.get("phone") and enriched.get("phone"):
                        patch["phone"] = enriched["phone"]
                    if not existing.get("company") and enriched.get("company"):
                        patch["company"] = enriched["company"]
                    if not existing.get("title") and enriched.get("title"):
                        patch["title"] = (enriched["title"])[:25]
                    if last_contacted:
                        patch["last_contacted"] = last_contacted
                    if patch:
                        supabase_client().table("brokers").update(patch).eq(
                            "carrier_id", carrier_id).eq("email", email).execute()
                        enhanced += 1
                        log.info('[extract-brokers] enhanced email=%s', email)
                return True
            except Exception as exc:
                log.error('[extract-brokers] write failed email=%s: %s', email, exc)
                return False

        with ThreadPoolExecutor(max_workers=3) as pool:
            futures = {pool.submit(_process_broker, e): e for e in process_emails}
            for future in as_completed(futures):
                future.result()

        log.info('[extract-brokers] done imported=%d enhanced=%d carrier_id=%s', imported, enhanced, carrier_id)

    except Exception as e:
        log.exception('[extract-brokers] background thread crashed: %s', e)


@app.route("/extract-brokers", methods=["POST"])
def extract_brokers():
    data = request.get_json(silent=True) or {}
    carrier_id = data.get("carrier_id")
    if not carrier_id:
        return jsonify({"error": "carrier_id required"}), 400
    days = int(data.get("days", 180))

    def run():
        # Yield immediately so client gets status:started without waiting
        yield json.dumps({"status": "started", "carrier_id": carrier_id}) + "\n"
        try:
            _scan_sent_and_enrich(carrier_id, days)
            yield json.dumps({"status": "done", "carrier_id": carrier_id}) + "\n"
        except Exception as exc:
            log.error('"extract-brokers stream error: %s"', exc, exc_info=True)
            yield json.dumps({"status": "error", "error": str(exc)}) + "\n"

    return Response(
        stream_with_context(run()),
        mimetype="application/x-ndjson",
        headers={"X-Accel-Buffering": "no"},
    )


@app.route("/import-brokers", methods=["POST"])
def import_brokers():
    """
    Import enriched broker contacts into the brokers table.
    Accepts JSON body: {"carrier_id": "<uuid>", "brokers": [...]}.
    Each broker dict may contain: email, name, company, mobile, direct.
    Always returns 200.
    """
    imported = 0
    duplicates = 0
    errors = 0
    total = 0

    try:
        data = request.get_json(silent=True) or {}

        carrier_id = data.get("carrier_id")
        if not carrier_id:
            return jsonify({"error": "carrier_id required"}), 400

        broker_list = data.get("brokers")
        if not broker_list or not isinstance(broker_list, list):
            return jsonify({"error": "brokers list required"}), 400

        total = len(broker_list)

        # Pre-fetch existing records so we can enhance nulls rather than skip
        existing_resp = (
            supabase_client()
            .table("brokers")
            .select("email,phone,company")
            .eq("carrier_id", carrier_id)
            .execute()
        )
        existing_map: dict[str, dict] = {row["email"].lower(): row for row in (existing_resp.data or [])}

        for broker in broker_list:
            email = (broker.get("email") or "").lower().strip()
            if not email:
                log.error('"import_brokers — skipping entry with no email"')
                errors += 1
                continue

            try:
                if email not in existing_map:
                    supabase_client().table("brokers").insert({
                        "carrier_id": carrier_id,
                        "email": email,
                        "name": broker.get("name"),
                        "company": broker.get("company"),
                        "phone": broker.get("mobile") or broker.get("direct") or broker.get("phone"),
                        "status": "warm",
                        "priority": "medium",
                        "days_cadence": 3,
                    }).execute()
                    existing_map[email] = {}
                    imported += 1
                else:
                    # Enhance nulls only — never overwrite existing data
                    existing = existing_map[email]
                    patch = {}
                    incoming_phone = broker.get("mobile") or broker.get("direct") or broker.get("phone")
                    if not existing.get("phone") and incoming_phone:
                        patch["phone"] = incoming_phone
                    if not existing.get("company") and broker.get("company"):
                        patch["company"] = broker["company"]
                    if patch:
                        supabase_client().table("brokers").update(patch).eq(
                            "carrier_id", carrier_id).eq("email", email).execute()
                        imported += 1
                    else:
                        duplicates += 1
            except Exception as exc:
                log.error('"import_brokers — write failed email=%s: %s"', email, exc)
                errors += 1

        log.info(
            '"import_brokers — done imported=%d duplicates=%d errors=%d total=%d"',
            imported, duplicates, errors, total,
        )

        return jsonify({
            "ok": True,
            "imported": imported,
            "duplicates": duplicates,
            "errors": errors,
            "total": total,
        }), 200

    except Exception as exc:
        log.error('"import_brokers — unhandled exception: %s"', exc, exc_info=True)
        return jsonify({
            "ok": False,
            "imported": imported,
            "duplicates": duplicates,
            "errors": errors,
            "total": total,
        }), 200

# ── Supabase service-role client (bypasses RLS) ───────────────────────────────

_supabase_service: Client | None = None

def supabase_service_client() -> Client:
    global _supabase_service
    if _supabase_service is None:
        _supabase_service = create_client(
            os.environ["SUPABASE_URL"],
            os.environ["SUPABASE_KEY"],
        )
    return _supabase_service


# ── /upsert-broker-lane ───────────────────────────────────────────────────────

@app.route("/upsert-broker-lane", methods=["POST"])
def upsert_broker_lane():
    """
    ACE writes one row to broker_lanes per captured load.
    Uses service role key — bypasses RLS so carrier_id is set explicitly from payload.
    """
    try:
        data = request.get_json(silent=True) or {}

        required = ["broker_email", "pickup_state", "delivery_state"]
        missing = [f for f in required if not data.get(f)]
        if missing:
            return jsonify({"success": False, "error": f"missing fields: {', '.join(missing)}"}), 400

        miles_raw = data.get("miles")
        try:
            miles = int(miles_raw) if miles_raw is not None else None
        except (ValueError, TypeError):
            miles = None

        row = {
            "carrier_id":        data.get("carrier_id") or None,
            "broker_first_name": data.get("broker_first_name") or None,
            "broker_last_name":  data.get("broker_last_name") or None,
            "broker_company":    data.get("broker_company") or None,
            "broker_mc":         data.get("broker_mc") or None,
            "broker_email":      data.get("broker_email"),
            "broker_phone":      data.get("broker_phone") or None,
            "team_name":         data.get("team_name") or None,
            "pickup_city":       data.get("pickup_city") or None,
            "pickup_state":      data.get("pickup_state"),
            "pickup_zip":        data.get("pickup_zip") or None,
            "delivery_city":     data.get("delivery_city") or None,
            "delivery_state":    data.get("delivery_state"),
            "delivery_zip":      data.get("delivery_zip") or None,
            "vehicle_size":      data.get("vehicle_size") or None,
            "miles":             miles,
            "decision":          data.get("decision") or None,
            "source":            data.get("source") or "SYL",
        }

        supabase_service_client().table("broker_lanes").insert(row).execute()

        log.info(
            '"upsert-broker-lane — inserted broker=%s lane=%s→%s decision=%s"',
            row["broker_email"], row["pickup_state"], row["delivery_state"], row["decision"],
        )
        return jsonify({"success": True}), 200

    except Exception as exc:
        log.error('"upsert-broker-lane — error: %s"', exc, exc_info=True)
        return jsonify({"success": False, "error": str(exc)}), 500


# ── Gmail OAuth ──────────────────────────────────────────────────────────────
from urllib.parse import urlencode
import requests as _http

_CLOUD_RUN_BASE = "https://edgeai-gmail-webhook-417422203146.us-central1.run.app"
_OAUTH_REDIRECT = f"{_CLOUD_RUN_BASE}/oauth/gmail/callback"
_GMAIL_SCOPE    = "https://www.googleapis.com/auth/gmail.modify"


@app.route("/oauth/gmail/start", methods=["GET"])
def oauth_gmail_start():
    carrier_id = request.args.get("carrier_id")
    if not carrier_id:
        return jsonify({"error": "carrier_id required"}), 400
    params = {
        "client_id":     os.environ["GMAIL_CLIENT_ID"],
        "redirect_uri":  _OAUTH_REDIRECT,
        "response_type": "code",
        "scope":         _GMAIL_SCOPE,
        "access_type":   "offline",
        "prompt":        "consent",
        "state":         carrier_id,
    }
    return jsonify({"url": "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(params)})


@app.route("/oauth/gmail/callback", methods=["GET"])
def oauth_gmail_callback():
    code       = request.args.get("code")
    carrier_id = request.args.get("state")
    error      = request.args.get("error")

    if error or not code or not carrier_id:
        log.error('"oauth_gmail_callback — denied or missing: error=%s"', error)
        return redirect("https://xtxtec.com/onboard/gmail?connected=error")

    token_resp    = _http.post("https://oauth2.googleapis.com/token", data={
        "code":          code,
        "client_id":     os.environ["GMAIL_CLIENT_ID"],
        "client_secret": os.environ["GMAIL_CLIENT_SECRET"],
        "redirect_uri":  _OAUTH_REDIRECT,
        "grant_type":    "authorization_code",
    })
    tokens        = token_resp.json()
    refresh_token = tokens.get("refresh_token")

    if not refresh_token:
        log.error('"oauth_gmail_callback — no refresh_token in response"')
        return redirect("https://xtxtec.com/onboard/gmail?connected=error")

    supabase_client().table("carriers").update({
        "gmail_token": refresh_token,
        "ace_status":  "pending",
    }).eq("id", carrier_id).execute()

    log.info('"oauth_gmail_callback — connected carrier_id=%s"', carrier_id)
    return redirect("https://xtxtec.com/onboard/gmail?connected=true")


# ── Stripe ───────────────────────────────────────────────────────────────────
import stripe
import os

stripe.api_key = os.environ.get("STRIPE_SECRET_KEY")

PRICE_IDS = {
    "base":    "price_1TN2Y5PyMuFPyN5Gl2cTFgVj",
    "custom":  "price_1TN2YhPyMuFPyN5GChyx5zvT",
    "premium": "price_1TN2dgPyMuFPyN5Ghu1erL5c",
}

@app.route("/create-checkout-session", methods=["POST", "OPTIONS"])
def create_checkout_session():
    if request.method == "OPTIONS":
        response = app.make_default_options_response()
        response.headers["Access-Control-Allow-Origin"] = "https://edgeai-dashboard.vercel.app"
        response.headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type"
        return response
    try:
        data = request.get_json()
        tier = data.get("tier")
        carrier_id = data.get("carrier_id")
        email = data.get("email")
        if tier not in PRICE_IDS:
            return jsonify({"error": "Invalid tier"}), 400
        price_id = PRICE_IDS[tier]
        mode = "payment" if tier == "premium" else "subscription"
        session = stripe.checkout.Session.create(
            payment_method_types=["card"],
            mode=mode,
            customer_email=email,
            line_items=[{"price": price_id, "quantity": 1}],
            success_url="https://edgeai-dashboard.vercel.app/onboard?session_id={CHECKOUT_SESSION_ID}",
            cancel_url="https://edgeai-dashboard.vercel.app/subscribe?cancelled=true",
            metadata={"carrier_id": carrier_id, "tier": tier},
        )
        response = jsonify({"url": session.url})
        response.headers["Access-Control-Allow-Origin"] = "https://edgeai-dashboard.vercel.app"
        return response
    except Exception as e:
        logging.error(f"[STRIPE] Checkout session error: {e}")
        response = jsonify({"error": str(e)})
        response.headers["Access-Control-Allow-Origin"] = "https://edgeai-dashboard.vercel.app"
        return response, 500


@app.route("/stripe-webhook", methods=["POST"])
@app.route("/api/stripe-webhook", methods=["POST"])
def stripe_webhook():
    payload = request.get_data()
    sig_header = request.headers.get("Stripe-Signature")
    webhook_secret = os.environ.get("STRIPE_WEBHOOK_SECRET")

    try:
        event = stripe.Webhook.construct_event(payload, sig_header, webhook_secret)
    except stripe.error.SignatureVerificationError as e:
        logging.error(f"[STRIPE] Webhook signature failed: {e}")
        return jsonify({"error": "Invalid signature"}), 400

    # Handle successful payment
    if event["type"] == "checkout.session.completed":
        session = event["data"]["object"]
        carrier_id = session["metadata"]["carrier_id"] if "carrier_id" in session["metadata"] else None
        tier = session["metadata"]["tier"] if "tier" in session["metadata"] else None

        if carrier_id:
            # Update carrier subscription in Supabase
            sb = supabase_client()

            if tier == "premium":
                # Premium is setup fee only — don't change subscription tier
                sb.table("carriers").update({
                    "onboarding_complete": False,
                    "subscription_status": "trial",
                }).eq("id", carrier_id).execute()
            else:
                sb.table("carriers").update({
                    "subscription_tier": tier,
                    "subscription_status": "active",
                    "subscription_start": "now()",
                    "stripe_customer_id": session["customer"] if "customer" in session else None,
                }).eq("id", carrier_id).execute()

            logging.info(f"[STRIPE] Payment complete — carrier {carrier_id} — tier {tier}")

    # Handle subscription cancellation
    if event["type"] == "customer.subscription.deleted":
        customer_id = event["data"]["object"]["customer"]
        sb = supabase_client()
        sb.table("carriers").update({
            "subscription_status": "cancelled",
        }).eq("stripe_customer_id", customer_id).execute()
        logging.info(f"[STRIPE] Subscription cancelled — customer {customer_id}")

    return jsonify({"status": "ok"})


@app.route('/log-sylectus-activity', methods=['POST'])
def log_sylectus_activity():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data'}), 400
        carrier_id = data.get('carrier_id')
        if not carrier_id:
            return jsonify({'error': 'Missing carrier_id'}), 400
        payload = {
            'carrier_id':           carrier_id,
            'order_no':             data.get('order_no'),
            'broker_name':          data.get('broker_name'),
            'broker_email':         data.get('broker_email'),
            'pickup_city':          data.get('pickup_city'),
            'pickup_state':         data.get('pickup_state'),
            'delivery_city':        data.get('delivery_city'),
            'delivery_state':       data.get('delivery_state'),
            'miles':                data.get('miles'),
            'load_type':            data.get('load_type'),
            'suggested_rate':       data.get('suggested_rate'),
            'bid_amount':           data.get('bid_amount'),
            'decision':             data.get('decision'),
            'pass_count':           data.get('pass_count', 0),
            't1_posted_at':         data.get('t1_posted_at'),
            't2_detected_at':       data.get('t2_detected_at'),
            't3_alerted_at':        data.get('t3_alerted_at'),
            't4_reviewed_at':       data.get('t4_reviewed_at'),
            't5_decision_at':       data.get('t5_decision_at'),
            't6_sent_at':           data.get('t6_sent_at'),
            'detection_speed_sec':  data.get('detection_speed_sec'),
            'alert_speed_sec':      data.get('alert_speed_sec'),
            'response_time_sec':    data.get('response_time_sec'),
            'bid_speed_sec':        data.get('bid_speed_sec'),
            'performance_tier':     data.get('performance_tier')
        }
        payload = {k: v for k, v in payload.items() if v is not None}
        sb = supabase_client()
        result = sb.table('ace_sylectus_activity').upsert(
            payload,
            on_conflict='carrier_id,order_no'
        ).execute()
        return jsonify({'status': 'ok'}), 200
    except Exception as e:
        logging.error(f'[log-sylectus-activity] Error: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/update-broker-win', methods=['POST'])
def update_broker_win():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data'}), 400

        carrier_id  = data.get('carrier_id')
        email       = data.get('email')
        if not carrier_id or not email:
            return jsonify({'error': 'Missing carrier_id or email'}), 400

        now = datetime.utcnow().isoformat()

        # Find existing broker row for this carrier + email
        existing = supabase_client().table('brokers') \
            .select('id, load_count') \
            .eq('carrier_id', carrier_id) \
            .eq('email', email) \
            .execute()

        if existing.data:
            row = existing.data[0]
            new_count = (row.get('load_count') or 0) + 1
            supabase_client().table('brokers') \
                .update({
                    'load_count':            new_count,
                    'last_load_date':        data.get('last_load_date', now),
                    'last_load_origin':      data.get('last_load_origin'),
                    'last_load_destination': data.get('last_load_destination')
                }) \
                .eq('id', row['id']) \
                .execute()
            logging.info(f'[update-broker-win] Updated broker {email} — load_count: {new_count}')
        else:
            logging.warning(f'[update-broker-win] Broker not found: {email} for carrier {carrier_id}')

        return jsonify({'status': 'ok'}), 200

    except Exception as e:
        logging.error(f'[update-broker-win] Error: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/validate-carrier', methods=['GET'])
def validate_carrier():
    try:
        uuid = request.args.get('uuid')
        if not uuid:
            return jsonify({'active': False, 'reason': 'missing_uuid'}), 400

        result = supabase_client().table('carriers') \
            .select('id, status, subscription_status, tier, secondary_email, email, name, email_signature') \
            .eq('id', uuid) \
            .execute()

        if not result.data:
            return jsonify({'active': False, 'reason': 'not_found'}), 200

        carrier = result.data[0]
        is_active = (
            carrier.get('status') == 'active' and
            carrier.get('subscription_status') == 'active'
        )

        return jsonify({
            'active':           is_active,
            'reason':           'active' if is_active else 'inactive',
            'tier':             carrier.get('tier'),
            'secondary_email':  carrier.get('secondary_email'),
            'email':            carrier.get('email'),
            'carrier_name':     carrier.get('name'),
            'email_signature':  carrier.get('email_signature')
        }), 200

    except Exception as e:
        logging.error(f'[validate-carrier] Error: {e}')
        return jsonify({'active': True, 'reason': 'offline_failopen'}), 200


# ══════════════════════════════════════════════════════════════════════════════
# ── Piece 5 — Backend routes (v8.1 §8) ───────────────────────────────────────
# ══════════════════════════════════════════════════════════════════════════════

EDGE_VERCEL_BASE = os.environ.get(
    "EDGE_VERCEL_BASE",
    "https://edgeai-dashboard.vercel.app",
)


@app.route("/<token>", methods=["GET"])
def token_resolver(token: str):
    """Universal token resolver. Looks up edge_load_activity by token,
    handles state checks (expired, already-used), and dispatches:
      BOOK   → 302 to Vercel /book-confirm?t=<token> (verification page)
      RE-BID → 302 to Vercel /rebid?t=<token>&offer=<rate> (amount entry)
      PASS   → fires action immediately, 302 to /passed (no verification)
    Per v8.1 §8.1.
    """
    # Guard: only treat as token if it looks like one (6-char urlsafe).
    # Prevents collision with any other future top-level route.
    if not token or len(token) > 16 or "/" in token or "." in token:
        return jsonify({"error": "not found"}), 404

    try:
        result = (
            supabase_service_client()
            .table("edge_load_activity")
            .select("*")
            .or_(f"book_token.eq.{token},rebid_token.eq.{token},pass_token.eq.{token}")
            .limit(1)
            .execute()
        )
        if not result.data:
            return redirect(f"{EDGE_VERCEL_BASE}/expired", code=302)

        row = result.data[0]

        # Idempotent re-tap → "already actioned" page
        if row.get("consumed_at") is not None:
            return redirect(f"{EDGE_VERCEL_BASE}/already-used", code=302)

        # Expiry check (server-side; nightly sweep does this for analytics)
        expires_at = row.get("expires_at")
        if expires_at:
            try:
                exp = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
                if datetime.now(timezone.utc) > exp:
                    return redirect(f"{EDGE_VERCEL_BASE}/expired", code=302)
            except Exception:
                pass  # malformed timestamp — let action proceed

        # Dispatch by which token matched
        if token == row.get("book_token"):
            return redirect(f"{EDGE_VERCEL_BASE}/book-confirm?t={token}", code=302)

        if token == row.get("rebid_token"):
            # Mark rebid_token as the consumed token at TAP time (not at submit).
            # Stage stays 'offer' until /rebid-submit completes the action.
            supabase_service_client().table("edge_load_activity").update({
                "consumed_token": token,
                "consumed_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", row["id"]).execute()
            rate = row.get("rate_offered") or ""
            return redirect(f"{EDGE_VERCEL_BASE}/rebid?t={token}&offer={rate}", code=302)

        if token == row.get("pass_token"):
            # PASS is one-tap, no verification page. Fire action server-side.
            supabase_service_client().table("edge_load_activity").update({
                "stage": "passed",
                "consumed_token": token,
                "consumed_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", row["id"]).execute()
            supabase_service_client().table("broker_lanes").update({
                "decision": "passed",
            }).eq("id", row.get("broker_lane_id")).execute()
            # OUTRCH source → courtesy decline reply via carrier's Gmail
            if row.get("source") == "OUTRCH":
                try:
                    _send_decline_email_for_row(row)
                except Exception as _exc:
                    log.error('"PASS decline send failed: %s"', _exc)
            return redirect(f"{EDGE_VERCEL_BASE}/passed", code=302)

        # No token field matched (shouldn't happen given the OR query)
        return redirect(f"{EDGE_VERCEL_BASE}/expired", code=302)

    except Exception as exc:
        log.error('"token_resolver failed token=%s: %s"', token, exc, exc_info=True)
        return redirect(f"{EDGE_VERCEL_BASE}/expired", code=302)


@app.route("/book-confirm", methods=["POST"])
def book_confirm():
    """POST endpoint called by the Vercel book-confirm.html YES button.
    Body: {"token": "<book_token>"}. Sends agreement email via carrier's
    Gmail, marks stage='booked', updates broker_lanes decision='booked'.
    Per v8.1 §8.2.
    """
    try:
        data = request.get_json(force=True, silent=True) or {}
        token = data.get("token")
        if not token:
            return jsonify({"error": "missing token"}), 400

        result = (
            supabase_service_client()
            .table("edge_load_activity")
            .select("*")
            .eq("book_token", token)
            .limit(1)
            .execute()
        )
        if not result.data:
            return jsonify({"error": "invalid token"}), 404

        row = result.data[0]

        if row.get("consumed_at") is not None:
            return jsonify({"status": "already_actioned"}), 200

        expires_at = row.get("expires_at")
        if expires_at:
            try:
                exp = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
                if datetime.now(timezone.utc) > exp:
                    return jsonify({"error": "expired"}), 410
            except Exception:
                pass

        carrier = _get_carrier_dict(row["carrier_id"])
        if not carrier:
            return jsonify({"error": "carrier not found"}), 404

        # Build and send agreement email via carrier's Gmail
        signature = _build_carrier_signature(row["carrier_id"])
        body = _build_agreement_email(
            pickup_city=row.get("pickup_city") or "",
            delivery_city=row.get("delivery_city") or "",
            rate=row.get("rate_offered") or "",
            signature=signature,
        )
        try:
            _send_gmail_reply_in_thread(
                carrier=carrier,
                thread_id=row["thread_id"],
                body=body,
                to_email=row["broker_email"],
            )
        except Exception as _exc:
            log.error('"book_confirm: gmail send failed: %s"', _exc)
            return jsonify({"error": "email send failed"}), 500

        _promote_unknown_broker_to_brokers(row, row["carrier_id"])

        # Mark booked
        supabase_service_client().table("edge_load_activity").update({
            "stage": "booked",
            "consumed_token": token,
            "consumed_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", row["id"]).execute()

        supabase_service_client().table("broker_lanes").update({
            "decision": "booked",
        }).eq("id", row.get("broker_lane_id")).execute()

        log.info('"book_confirm: booked row=%s carrier=%s"', row["id"], row["carrier_id"])
        return jsonify({"status": "booked"}), 200

    except Exception as exc:
        log.error('"book_confirm failed: %s"', exc, exc_info=True)
        return jsonify({"error": "internal error"}), 500


@app.route("/rebid-submit", methods=["POST"])
def rebid_submit():
    """POST endpoint called by the Vercel rebid.html SEND COUNTER button.
    Body: {"token": "<rebid_token>", "counter_amount": <number>}. Sends
    counter email via carrier's Gmail, sets stage='counter', updates
    broker_lanes decision='rebid'. Per v8.1 §8.3.
    """
    try:
        data = request.get_json(force=True, silent=True) or {}
        token = data.get("token")
        counter_amount = data.get("counter_amount")
        if not token or counter_amount is None:
            return jsonify({"error": "missing token or counter_amount"}), 400

        try:
            counter_amount = float(counter_amount)
            if counter_amount <= 0:
                return jsonify({"error": "counter must be positive"}), 400
        except (TypeError, ValueError):
            return jsonify({"error": "counter not a number"}), 400

        result = (
            supabase_service_client()
            .table("edge_load_activity")
            .select("*")
            .eq("rebid_token", token)
            .limit(1)
            .execute()
        )
        if not result.data:
            return jsonify({"error": "invalid token"}), 404

        row = result.data[0]

        # If already at stage=booked or passed, the rebid was overridden by another action
        if row.get("stage") in ("booked", "passed", "closed", "expired"):
            return jsonify({"error": "no longer active"}), 410

        carrier = _get_carrier_dict(row["carrier_id"])
        if not carrier:
            return jsonify({"error": "carrier not found"}), 404

        # Round display to int if whole number
        display_amount = (int(counter_amount)
                          if counter_amount == int(counter_amount)
                          else counter_amount)

        signature = _build_carrier_signature(row["carrier_id"])
        body = _build_counter_email(
            counter_amount=display_amount,
            signature=signature,
        )
        try:
            _send_gmail_reply_in_thread(
                carrier=carrier,
                thread_id=row["thread_id"],
                body=body,
                to_email=row["broker_email"],
            )
        except Exception as _exc:
            log.error('"rebid_submit: gmail send failed: %s"', _exc)
            return jsonify({"error": "email send failed"}), 500

        _promote_unknown_broker_to_brokers(row, row["carrier_id"])

        supabase_service_client().table("edge_load_activity").update({
            "stage": "counter",
            "carrier_rebid": counter_amount,
        }).eq("id", row["id"]).execute()

        supabase_service_client().table("broker_lanes").update({
            "decision": "rebid",
        }).eq("id", row.get("broker_lane_id")).execute()

        log.info('"rebid_submit: counter=%s sent row=%s"', counter_amount, row["id"])
        return jsonify({"status": "counter_sent"}), 200

    except Exception as exc:
        log.error('"rebid_submit failed: %s"', exc, exc_info=True)
        return jsonify({"error": "internal error"}), 500


@app.route("/expiry-sweep", methods=["POST", "GET"])
def expiry_sweep():
    """Nightly cron target. Marks expired edge_load_activity rows and updates
    broker_lanes.decision='no_action' for analytics hygiene. Per v8.1 §8.6.
    Idempotent — safe to run repeatedly.
    """
    try:
        now_iso = datetime.now(timezone.utc).isoformat()

        # Find rows that are still 'offer' but past their expiry with no action taken
        expired_lookup = (
            supabase_service_client()
            .table("edge_load_activity")
            .select("id, carrier_id, broker_email")
            .eq("stage", "offer")
            .is_("consumed_at", "null")
            .lt("expires_at", now_iso)
            .execute()
        )
        candidates = expired_lookup.data or []
        count = 0
        for cand in candidates:
            try:
                supabase_service_client().table("edge_load_activity").update({
                    "stage": "expired",
                }).eq("id", cand["id"]).execute()
                supabase_service_client().table("broker_lanes").update({
                    "decision": "no_action",
                }).eq("id", cand.get("broker_lane_id")).is_("decision", "null").execute()
                count += 1
            except Exception as _exc:
                log.error('"expiry_sweep row=%s failed: %s"', cand.get("id"), _exc)

        log.info('"expiry_sweep: marked %d rows expired"', count)
        return jsonify({"status": "ok", "expired": count}), 200

    except Exception as exc:
        log.error('"expiry_sweep failed: %s"', exc, exc_info=True)
        return jsonify({"error": "internal error"}), 500


@app.route("/telnyx-webhook", methods=["POST"])
def telnyx_webhook():
    """Placeholder for Telnyx delivery receipts and inbound SMS callbacks.
    Telnyx Console is configured to POST here. We log the payload type and
    return 200 to stop the retry storm. Full handling (delivery state to
    edge_load_activity, inbound SMS reply parsing) is future scope.
    """
    try:
        payload = request.get_json(force=True, silent=True) or {}
        event_type = payload.get("data", {}).get("event_type", "unknown")
        log.info('"telnyx_webhook: received event_type=%s"', event_type)
        return jsonify({"status": "received"}), 200
    except Exception as exc:
        log.error('"telnyx_webhook handler failed: %s"', exc)
        return jsonify({"status": "received"}), 200  # always 200 to stop retries


def _send_decline_email_for_row(row: dict) -> None:
    """Send the OUTRCH-only PASS courtesy decline email."""
    carrier = _get_carrier_dict(row["carrier_id"])
    if not carrier:
        log.error('"_send_decline_email_for_row: carrier not found row=%s"', row.get("id"))
        return
    signature = _build_carrier_signature(row["carrier_id"])
    body = _build_decline_email(
        pickup_city=row.get("pickup_city") or "",
        delivery_city=row.get("delivery_city") or "",
        signature=signature,
    )
    _send_gmail_reply_in_thread(
        carrier=carrier,
        thread_id=row["thread_id"],
        body=body,
        to_email=row["broker_email"],
    )


def _send_gmail_reply_in_thread(
    carrier: dict, thread_id: str, body: str, to_email: str
) -> None:
    """Send a Gmail reply on behalf of the carrier into an existing thread.
    Uses the carrier's stored OAuth refresh_token. Reuses gmail_service().
    """
    refresh_token = (carrier.get("gmail_token") or
                     carrier.get("refresh_token") or "")
    if not refresh_token:
        raise RuntimeError(
            f"no gmail refresh token on carrier {carrier.get('id')}"
        )

    service = gmail_service(refresh_token)

    from email.mime.text import MIMEText  # local import to avoid top-level churn
    msg = MIMEText(body, _charset="utf-8")
    msg["to"] = to_email
    msg["subject"] = "Re: Load offer"
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()

    service.users().messages().send(
        userId="me",
        body={"raw": raw, "threadId": thread_id},
    ).execute()
    log.info('"_send_gmail_reply_in_thread: sent to=%s thread=%s"', to_email, thread_id)


# ══════════════════════════════════════════════════════════════════════════════
# ── End Piece 5 routes ───────────────────────────────────────────────────────
# ══════════════════════════════════════════════════════════════════════════════


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    app.run(host="0.0.0.0", port=port)

# sync revision 2026-04-17 22:15:26
