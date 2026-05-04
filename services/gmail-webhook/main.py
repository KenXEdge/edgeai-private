"""
EDGEai Gmail Webhook Service
Receives Gmail Push Notifications via Google Cloud Pub/Sub,
classifies broker replies using Claude, and triggers carrier actions.
"""

import os
import json
import re
import base64
import logging
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, timedelta
from email import message_from_bytes
from email.utils import parseaddr, parsedate_to_datetime

import anthropic
from flask import Flask, request, jsonify, redirect, Response, stream_with_context
from supabase import create_client, Client
from twilio.rest import Client as TwilioClient
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
_twilio: TwilioClient | None = None


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


def twilio_client() -> TwilioClient:
    global _twilio
    if _twilio is None:
        _twilio = TwilioClient(
            os.environ["TWILIO_ACCOUNT_SID"],
            os.environ["TWILIO_AUTH_TOKEN"],
        )
    return _twilio


def gmail_service():
    import google.auth.transport.requests as google_requests
    import requests as requests_lib
    creds = OAuthCredentials(
        token=None,
        refresh_token=os.environ["GMAIL_OAUTH_REFRESH_TOKEN"],
        token_uri="https://oauth2.googleapis.com/token",
        client_id=os.environ["GMAIL_CLIENT_ID"],
        client_secret=os.environ["GMAIL_CLIENT_SECRET"],
        scopes=["https://www.googleapis.com/auth/gmail.modify"],
    )
    auth_req = google_requests.Request(session=requests_lib.Session())
    creds.refresh(auth_req)
    return build("gmail", "v1", credentials=creds, cache_discovery=False)


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

def get_history(start_history_id: str) -> list[dict]:
    """Primary method: return messagesAdded entries since start_history_id.
    Returns [] on 0 records OR on exception — caller is responsible for fallback.
    """
    messages = []
    try:
        print(f"[get_history] calling history.list startHistoryId={start_history_id}", flush=True)
        resp = (
            gmail_service()
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


def get_unread_messages() -> list[dict]:
    """Fallback: fetch recent inbox messages via messages.list q='in:inbox newer_than:1h'.
    Catches emails regardless of read/unread status.
    Returns a list of minimal message dicts {id, threadId} matching history.list format.
    """
    try:
        print(f"[get_unread] calling messages.list q=in:inbox newer_than:1h maxResults=10", flush=True)
        resp = (
            gmail_service()
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


def mark_as_read(message_id: str) -> None:
    """Remove the UNREAD label after successful processing."""
    try:
        gmail_service().users().messages().modify(
            userId="me",
            id=message_id,
            body={"removeLabelIds": ["UNREAD"]},
        ).execute()
        log.info('"marked as read — messageId=%s"', message_id)
    except Exception as exc:
        log.error('"mark_as_read failed messageId=%s: %s"', message_id, exc)


def fetch_message(message_id: str) -> dict | None:
    """Fetch a single Gmail message and return parsed fields."""
    try:
        raw = (
            gmail_service()
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
    "$2.50/mile" → 2.50   "$1,500 flat" → 1500.0   None → None
    """
    if not rate_str:
        return None
    import re
    match = re.search(r"[\d,]+\.?\d*", rate_str.replace(",", ""))
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
- negative     : not interested, removed from list, do not contact, out of network
- question     : asking a clarifying question before committing
- unknown      : cannot determine intent

Reply with only the label, nothing else.

Email subject: {subject}
Email body:
{body}"""


EXTRACT_PROMPT = (
    "You are analyzing a freight broker email sent to a carrier.\n\n"
    "Return a JSON object with exactly these fields:\n"
    "{\"classification\": \"<label>\", "
    "\"sender_name\": \"<name or null>\", "
    "\"load_origin\": \"<city, state or null>\", "
    "\"load_destination\": \"<city, state or null>\", "
    "\"rate_offered\": \"<amount or null>\"}\n\n"
    "Classification labels:\n"
    "- load_offer   : offering a specific load, lane, or rate\n"
    "- positive     : interested/positive but no specific load offered\n"
    "- negative     : not interested, DNC, out of network\n"
    "- question     : asking a clarifying question\n"
    "- unknown      : cannot determine intent\n\n"
    "Extraction rules:\n"
    "- sender_name: full name from email signature, null if not present\n"
    "- load_origin: pickup city/state e.g. Dallas TX, null if not mentioned\n"
    "- load_destination: delivery city/state e.g. Chicago IL, null if not mentioned\n"
    "- rate_offered: dollar rate e.g. $2.50/mile or $1500 flat, null if not mentioned\n\n"
    "Return ONLY valid JSON, no other text.\n\n"
    "Subject: {subject}\n"
    "Body:\n"
    "{body}"
)


def classify_reply(email_data: dict) -> str:
    """Known-broker path: classify only. Returns one of the 5 labels."""
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
        if label not in {"load_offer", "positive", "negative", "question", "unknown"}:
            label = "unknown"
        return label
    except Exception as exc:
        log.error('"classify_reply failed: %s"', exc)
        return "unknown"


def classify_and_extract(email_data: dict) -> dict:
    """Unknown-broker path: classify + extract load details in one Claude call.

    Returns dict with keys: classification, sender_name, load_origin,
    load_destination, rate_offered.
    """
    fallback = {
        "classification": "unknown",
        "sender_name": None,
        "load_origin": None,
        "load_destination": None,
        "rate_offered": None,
    }
    try:
        subject = email_data["subject"]
        body = email_data["body"]
        prompt_text = (
            "You are analyzing a freight broker email sent to a carrier.\n\n"
            "Return ONLY valid JSON with these exact fields:\n"
            "{\"classification\": \"\", \"sender_name\": null, "
            "\"load_origin\": null, \"load_destination\": null, "
            "\"rate_offered\": null}\n\n"
            "classification must be exactly one of: load_offer, positive, "
            "negative, question, unknown\n\n"
            f"Subject: {subject}\n"
            f"Body:\n{body[:3000]}"
        )
        msg = anthropic_client().messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=200,
            messages=[{"role": "user", "content": prompt_text}],
        )
        raw = msg.content[0].text.strip()
        extracted = json.loads(raw)
        if extracted.get("classification") not in {
            "load_offer", "positive", "negative", "question", "unknown"
        }:
            extracted["classification"] = "unknown"
        return extracted
    except Exception as exc:
        log.error('"classify_and_extract failed: %s"', str(exc))
        if hasattr(exc, 'response'):
            log.error('"classify_and_extract response body: %s"',
                      exc.response.text if hasattr(exc.response, 'text') else str(exc.response))
        return fallback


# ── Twilio SMS ─────────────────────────────────────────────────────────────────

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
        twilio_client().messages.create(
            body=body,
            from_=os.environ["TWILIO_FROM"],
            to=os.environ["TWILIO_TO"],
        )
        log.info('"SMS sent — known broker load offer from=%s"', email_data["from_email"])
    except Exception as exc:
        log.error('"send_load_offer_sms failed: %s"', exc)


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
        twilio_client().messages.create(
            body=body,
            from_=os.environ["TWILIO_FROM"],
            to=os.environ["TWILIO_TO"],
        )
        log.info('"SMS sent — unknown broker load offer from=%s"', email_data["from_email"])
    except Exception as exc:
        log.error('"send_unknown_broker_sms failed: %s"', exc)


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
        twilio_client().messages.create(
            body=body,
            from_=os.environ["TWILIO_FROM"],
            to=os.environ["TWILIO_TO"],
        )
        log.info(
            '"SMS sent — load board alert board=%s shipment=%s"',
            board_name, shipment,
        )
    except Exception as exc:
        log.error('"send_load_board_sms failed: %s"', exc)


# ── Thread helpers ────────────────────────────────────────────────────────────

def has_carrier_replied(thread_id: str) -> bool:
    """Return True if the carrier's own Gmail account has sent a message in this thread.
    Checks thread message headers for GMAIL_USER as the From address.
    Returns False on any exception so SMS is never suppressed due to an API error.
    """
    try:
        thread = (
            gmail_service()
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
        carrier_email = os.environ.get("GMAIL_USER", "").lower()
        for message in thread.get("messages", []):
            headers = message.get("payload", {}).get("headers", [])
            for h in headers:
                if h.get("name", "").lower() == "from" and carrier_email in h.get("value", "").lower():
                    return True
    except Exception as exc:
        log.error('"has_carrier_replied failed thread=%s: %s"', thread_id, exc)
    return False


# ── Core processing pipeline ───────────────────────────────────────────────────

def process_message(message_id: str, carrier_id: str) -> None:
    """Full pipeline for one Gmail message."""

    # Step 1 — deduplication FIRST, before any API calls or processing
    # Prevents 150x replay: if the message is already in either table, stop immediately.
    if is_duplicate(message_id):
        log.info('"duplicate message %s — skipping"', message_id)
        mark_as_read(message_id)
        return

    # Step 2 — fetch email content from Gmail API
    email_data = fetch_message(message_id)
    if not email_data:
        return

    log.info('"processing message %s from %s"', message_id, email_data["from_email"])

    # Step 3a — load board intercept (before broker lookup)
    if is_load_board_email(email_data["from_email"]):
        board_name = LOAD_BOARD_SENDERS[email_data["from_email"].lower().strip()]
        log.info('"load board email detected board=%s message=%s"', board_name, message_id)

        parsed = parse_load_board_email(email_data)
        if parsed is None:
            log.error('"load board parse failed — skipping message=%s"', message_id)
            mark_as_read(message_id)
            return
        carrier = get_carrier_profile(carrier_id)

        if carrier and not load_board_matches_carrier(parsed, carrier):
            log.info('"load board message skipped — equipment mismatch message=%s"', message_id)
            mark_as_read(message_id)
            return

        send_load_board_sms(email_data, parsed, board_name)
        mark_as_read(message_id)
        return

    # ── Pre-Claude noise filter — discard before API call ─────────────────────
    _sender = email_data["from_email"]
    _local = _sender.split("@")[0] if "@" in _sender else ""
    _domain = _sender.split("@")[-1] if "@" in _sender else ""
    _inbox_hard_noise_domains = {
        "xtxtransport.com", "xedge-ai.com", "xtxtec.com",
        "stripe.com", "paypal.com", "amazonaws.com", "github.com",
        "squarespace.com", "twilio.com", "supabase.io", "anthropic.com",
        "irs.gov", "dol.gov", "fmcsa.dot.gov", "dot.gov",
    }
    _inbox_noreply_prefixes = {
        "noreply", "no-reply", "donotreply", "do-not-reply",
        "notifications", "automated", "mailer", "bounce",
    }
    if (
        _local in _inbox_noreply_prefixes
        or _domain in _inbox_hard_noise_domains
        or any(_domain == d or _domain.endswith("." + d) for d in _inbox_hard_noise_domains)
    ):
        mark_as_read(message_id)
        return

    # Step 3 — broker lookup determines which path to take
    broker = lookup_broker(email_data["from_email"], carrier_id)

    if broker:
        # ── Known broker path ────────────────────────────────────────────────
        log.info('"known broker %s id=%s"', email_data["from_email"], broker.get("id"))

        classification = classify_reply(email_data)
        log.info('"classified %s as %s"', message_id, classification)

        # Insert into responses FIRST — this is the dedup record.
        # Must succeed before SMS so that any retry finds it and stops.
        log_response(email_data, classification, carrier_id, broker_id=broker.get("id"), broker_name=broker.get("name"))

        if classification == "load_offer":
            if not has_carrier_replied(email_data["thread_id"]):
                send_load_offer_sms(email_data)
            else:
                log.info('"SMS suppressed — carrier already replied in thread=%s"',
                         email_data["thread_id"])

        update_broker_status(broker["id"], classification)

    else:
        # ── Unknown broker path ──────────────────────────────────────────────
        log.info('"unknown broker %s — classifying and logging to unknown_brokers_inbox"',
                 email_data["from_email"])

        extracted = classify_and_extract(email_data)
        classification = extracted.get("classification", "unknown")
        log.info('"unknown broker classified %s as %s"', message_id, classification)

        log_unknown_broker_inbox(email_data, extracted, carrier_id)

        if classification == "load_offer":
            send_unknown_broker_sms(email_data, extracted)

    # Mark as read AFTER all logging and SMS complete
    mark_as_read(message_id)


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

        carrier_id = get_carrier_id_for_email(email_address)
        if not carrier_id:
            log.warning('"[WEBHOOK] no carrier found for email=%s — skipping"', email_address)
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
        new_messages = get_history(stored_history_id)
        print(f"[WEBHOOK] get_history returned — messageCount={len(new_messages)}", flush=True)

        if not new_messages:
            print(f"[WEBHOOK] messageCount=0 — triggering fallback now", flush=True)
            new_messages = get_unread_messages()
            print(f"[WEBHOOK] fallback returned — messageCount={len(new_messages)}", flush=True)

        # ── Process each message ──────────────────────────────────────────────
        for idx, msg in enumerate(new_messages):
            print(f"[WEBHOOK] dispatching message[{idx}] id={msg.get('id')}", flush=True)
            try:
                process_message(msg["id"], carrier_id)
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
    Renew Gmail Watch subscriptions for all emails tracked in gmail_sync.
    Gmail Watch expires every 7 days — invoke weekly via Cloud Scheduler.
    Always returns 200 so Cloud Scheduler does not retry on error.
    """
    count_success = 0
    count_errors = 0

    try:
        project = os.environ.get("GOOGLE_CLOUD_PROJECT", "edgeai-493115")
        topic_name = f"projects/{project}/topics/edgeai-gmail"

        # Fetch all tracked email addresses
        resp = supabase_client().table("gmail_sync").select("email").execute()
        emails = [row["email"] for row in (resp.data or [])]

        if not emails:
            log.warning('"renew_watches — no rows in gmail_sync, nothing to renew"')
            return jsonify({"renewed": 0, "errors": 0}), 200

        for email in emails:
            try:
                result = (
                    gmail_service()
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
        # Carrier identity — used to filter own info out of broker enrichment.
        # Primary: pulled from carriers table (populated after onboarding).
        # Fallback: derive company tokens from carrier email domain so the filter
        # works even before onboarding data is filled in.
        carrier_name    = (carrier.get("owner_name") or carrier.get("name") or "").strip()
        carrier_phone   = (carrier.get("phone") or "").strip()
        carrier_company = (carrier.get("company_name") or carrier.get("name") or "").strip().lower()
        _carrier_suffix_re = re.compile(
            r'(transport(ation)?|trucking?|freight|logistics|express|llc|inc|corp|co|group|services?)$',
            re.IGNORECASE,
        )
        if not carrier_company:
            # Derive unique identifier from email domain.
            # Strip common freight/legal suffixes to isolate the carrier's brand token.
            # e.g. contact@xtxtransport.com → "xtxtransport" → strip "transport" → "xtx"
            _domain = (carrier.get("email") or "").split("@")[-1].split(".")[0].lower()
            _unique = _carrier_suffix_re.sub("", _domain).strip()
            carrier_company = _unique if len(_unique) >= 2 else _domain
        else:
            # Strip suffixes from company_name to isolate brand token for matching.
            # e.g. "XTX LLC" → "xtx", "XTX Transport LLC" → "xtx"
            _unique = _carrier_suffix_re.sub("", carrier_company).strip()
            if len(_unique) >= 2:
                carrier_company = _unique
        log.info('[extract-brokers] carrier identity name=%r company=%r phone=****%s',
                 carrier_name, carrier_company, carrier_phone[-4:] if carrier_phone else "")

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
        email_touch_counts: dict[str, int] = {}  # total SENT messages to this broker
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
            # Count every SENT message to this broker — touch count indicator
            email_touch_counts[to_email] = email_touch_counts.get(to_email, 0) + 1

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
            .select("email,phone,company,title,last_load_origin,last_load_destination,touch_count")
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

        def _strip_reply_quotes(text: str) -> str:
            """Remove quoted reply chains — only cut on unambiguous separators."""
            import re
            # Only split on patterns that definitively mark a quoted block,
            # NOT on bare "From:" which commonly appears in signatures/addresses.
            pattern = re.compile(
                r'\n(?:'
                r'-{3,}\s*(?:Original Message|Forwarded Message)\s*-{3,}'  # --- Original Message ---
                r'|On\s.{10,80}?wrote:\s*$'      # On Mon Jan 1, Joe Smith wrote:  (end of line)
                r'|_{10,}'                        # ___________ (long underscores only)
                r')',
                re.IGNORECASE | re.MULTILINE,
            )
            match = pattern.search(text)
            if match:
                text = text[:match.start()]
            # Strip lines that are pure inline quotes (start with >)
            lines = [l for l in text.splitlines() if not l.strip().startswith(">")]
            return "\n".join(lines).strip()

        imported = 0
        enhanced = 0

        def _process_broker(email):
            nonlocal imported, enhanced
            import google.auth.transport.requests as _greq
            import requests as _rlib

            # ── 4a: Build thread-local Gmail service (httplib2 not thread-safe) ──
            # Also build a thread-local Anthropic client — avoids any shared-state
            # issues with httpx connection pools across concurrent threads.
            signature = ""
            sent_context = ""
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

                # Fetch broker's reply from INBOX — last 20 non-blank lines = signature
                inbox_resp = _svc.users().messages().list(
                    userId="me",
                    q=f'from:"{email}"',
                    maxResults=1,
                ).execute()
                inbox_msgs = inbox_resp.get("messages", [])
                if inbox_msgs:
                    inbox_msg = _svc.users().messages().get(
                        userId="me", id=inbox_msgs[0]["id"], format="full"
                    ).execute()
                    body = _extract_body_text(inbox_msg)
                    # Strip quoted reply chain so we only read the broker's own content
                    body = _strip_reply_quotes(body)
                    lines = [l.strip() for l in body.splitlines() if l.strip()]
                    signature = "\n".join(lines[-20:])

                # Fetch the carrier's own SENT email to this broker — first 30 non-blank
                # lines give Claude lane/load context (origin, destination, rate, etc.)
                sent_msg_id = email_message_ids.get(email)
                if sent_msg_id:
                    try:
                        sent_msg = _svc.users().messages().get(
                            userId="me", id=sent_msg_id, format="full"
                        ).execute()
                        sent_body = _extract_body_text(sent_msg)
                        sent_lines = [l.strip() for l in sent_body.splitlines() if l.strip()]
                        sent_context = "\n".join(sent_lines[:30])
                    except Exception as exc:
                        log.warning('[extract-brokers] sent body fetch failed email=%s: %s', email, exc)

            except Exception as exc:
                log.error('[extract-brokers] sig fetch failed email=%s: %s', email, exc)

            # ── 4b: Claude enrich (thread-local client) ───────────────────────────
            to_name = email_names.get(email, "")
            _anth = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
            prompt_text = (
                "Extract freight broker contact details from the email content below.\n\n"
                "Return a JSON object with exactly these fields:\n"
                "{\"name\": \"broker first last or null\", "
                "\"title\": \"job title max 25 chars or null\", "
                "\"company\": \"brokerage or company name or null\", "
                "\"phone\": \"mobile number only or null\", "
                "\"origin\": \"pickup city ST or null\", "
                "\"destination\": \"delivery city ST or null\"}\n\n"
                "Rules:\n"
                "- name/title/company/phone: extract from the broker's signature block\n"
                "- origin/destination: extract the freight lane (pickup → delivery city/state) "
                "from either the broker signature or the lane context — format 'City ST'\n"
                "- Phone: ONLY return a number labeled Mobile, Cell, or M. "
                "Return null for Office, Afterhours, Direct, Desk, Ext, or 800 numbers.\n"
                "- Title: max 25 characters — truncate if longer\n"
                "- Return ONLY valid JSON, no other text\n\n"
                f"Broker name hint (from To: header): {to_name or 'unknown'}\n\n"
                f"Broker signature (from their reply):\n{signature or 'not available'}\n\n"
                f"Lane context (outbound bid email):\n{sent_context or 'not available'}"
            )
            try:
                claude_msg = _anth.messages.create(
                    model="claude-haiku-4-5-20251001",
                    max_tokens=250,
                    messages=[{"role": "user", "content": prompt_text}],
                )
                raw_text = claude_msg.content[0].text.strip() if claude_msg.content else ""
                log.info('[extract-brokers] claude raw email=%s stop=%s text=%r',
                         email, claude_msg.stop_reason, raw_text[:300])
                # Strip markdown code fences if Claude wraps the JSON block
                if raw_text.startswith("```"):
                    raw_text = raw_text.split("```", 2)[1]          # drop opening fence
                    if raw_text.startswith("json"):
                        raw_text = raw_text[4:]                      # drop "json" label
                    raw_text = raw_text.rsplit("```", 1)[0].strip()  # drop closing fence
                enriched = json.loads(raw_text)
            except Exception as exc:
                log.error('[extract-brokers] enrich failed email=%s: %s', email, exc)
                enriched = {}

            # ── 4c: Carrier identity filter — null fields that are Ken's own info ──
            # When a broker never replied, Claude reads the SENT body and may extract
            # the carrier's own signature. Detect and clear those fields before writing.
            _carr_name_lower = (carrier_name or "").lower()
            _carr_phone_digits = "".join(c for c in (carrier_phone or "") if c.isdigit())
            def _is_carrier_field(val: str | None, field: str) -> bool:
                if not val:
                    return False
                v = val.lower().strip()
                if field == "name":
                    # Match if extracted name overlaps with carrier's name tokens
                    carr_tokens = set(_carr_name_lower.split())
                    return bool(carr_tokens & set(v.split()))
                if field == "phone":
                    digits = "".join(c for c in v if c.isdigit())
                    return bool(_carr_phone_digits and digits.endswith(_carr_phone_digits[-7:]))
                if field == "company":
                    # Match if extracted company contains the carrier's unique brand token
                    # carrier_company is already stripped to its unique core (e.g. "xtx")
                    return bool(carrier_company and len(carrier_company) >= 2 and carrier_company in v)
                return False

            if _is_carrier_field(enriched.get("name"), "name"):
                enriched["name"] = None
            if _is_carrier_field(enriched.get("phone"), "phone"):
                enriched["phone"] = None
            if _is_carrier_field(enriched.get("company"), "company"):
                enriched["company"] = None

            # ── 4d: Write to SB immediately ───────────────────────────────────────
            last_contacted = email_sent_dates.get(email)
            is_new = email not in known_map
            try:
                if is_new:
                    # Name priority: broker's reply signature > To: display name from SENT header
                    broker_name = enriched.get("name") or to_name or None
                    touch = email_touch_counts.get(email, 0)
                    supabase_client().table("brokers").insert({
                        "carrier_id": carrier_id,
                        "email": email,
                        "name": broker_name,
                        "title": (enriched.get("title") or "")[:25] or None,
                        "company": enriched.get("company"),
                        "phone": enriched.get("phone"),
                        "last_contacted": last_contacted,
                        "last_load_origin": enriched.get("origin"),
                        "last_load_destination": enriched.get("destination"),
                        "touch_count": touch,
                        "status": "warm",
                        "priority": "medium",
                        "days_cadence": 3,
                    }).execute()
                    imported += 1
                    log.info('[extract-brokers] inserted email=%s touches=%d', email, touch)
                else:
                    existing = known_map[email]
                    patch = {}
                    if not existing.get("phone") and enriched.get("phone"):
                        patch["phone"] = enriched["phone"]
                    if not existing.get("company") and enriched.get("company"):
                        patch["company"] = enriched["company"]
                    if not existing.get("title") and enriched.get("title"):
                        patch["title"] = (enriched["title"])[:25]
                    if not existing.get("last_load_origin") and enriched.get("origin"):
                        patch["last_load_origin"] = enriched["origin"]
                    if not existing.get("last_load_destination") and enriched.get("destination"):
                        patch["last_load_destination"] = enriched["destination"]
                    if last_contacted:
                        patch["last_contacted"] = last_contacted
                    # Always refresh touch count — reflects current SENT history
                    patch["touch_count"] = email_touch_counts.get(email, 0)
                    if patch:
                        supabase_client().table("brokers").update(patch).eq(
                            "carrier_id", carrier_id).eq("email", email).execute()
                        enhanced += 1
                        log.info('[extract-brokers] enhanced email=%s fields=%s', email, list(patch.keys()))
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

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    app.run(host="0.0.0.0", port=port)

# sync revision 2026-04-17 22:15:26
