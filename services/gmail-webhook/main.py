"""
EDGEai Gmail Webhook Service
Receives Gmail Push Notifications via Google Cloud Pub/Sub,
classifies broker replies using Claude, and triggers carrier actions.
"""

import os
import json
import base64
import logging
import sys
from datetime import datetime, timezone, timedelta
from email import message_from_bytes
from email.utils import parseaddr
from flask_cors import CORS

import anthropic
from flask import Flask, request, jsonify
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

@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "https://edgeai-dashboard.vercel.app"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return response

CORS(app, origins=["https://edgeai-dashboard.vercel.app", "http://localhost:5173"])

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


def lookup_broker(from_email: str) -> dict | None:
    """Return broker row if the sender is a known broker for this carrier."""
    resp = (
        supabase_client()
        .table("brokers")
        .select("*")
        .eq("email", from_email)
        .eq("carrier_id", os.environ["CARRIER_UUID"])
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


def log_response(email_data: dict, classification: str, broker_id: str | None = None, broker_name: str | None = None) -> None:
    try:
        row = {
            "gmail_message_id": email_data["message_id"],
            "thread_id": email_data["thread_id"],
            "broker_email": email_data["from_email"],
            "subject": email_data["subject"],
            "body": email_data["body"],
            "classification": classification,
            "carrier_id": os.environ["CARRIER_UUID"],
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


def log_load_win(email_data: dict) -> None:
    supabase_client().table("load_wins").insert(
        {
            "broker_email": email_data["from_email"],
            "subject": email_data["subject"],
            "body": email_data["body"],
            "gmail_message_id": email_data["message_id"],
            "carrier_id": os.environ["CARRIER_UUID"],
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


def log_unknown_broker_inbox(email_data: dict, extracted: dict) -> None:
    """Insert an unrecognised sender into unknown_brokers_inbox for carrier review."""
    try:
        supabase_client().table("unknown_brokers_inbox").insert(
            {
                "carrier_id": os.environ["CARRIER_UUID"],
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
    """Known broker load offer alert."""
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
    """Unknown broker load offer alert with extracted load details."""
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


def get_carrier_profile() -> dict | None:
    """Query the carriers table for the current carrier's profile.
    Returns the first row (equipment_type, max_radius, home_base_zip) or None.
    """
    try:
        resp = (
            supabase_client()
            .table("carriers")
            .select("equipment_type, max_radius, home_base_zip")
            .eq("id", os.environ["CARRIER_UUID"])
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
cd C:\Users\korbs\EDGEai\services\gmail-webhook
$env_vars = (Get-Content .env | Where-Object { $_ -match "^[A-Z]" } | ForEach-Object { $_ -replace '\s*#.*$', '' } | Where-Object { $_ -match "=" }) -join ","
gcloud run services update edgeai-gmail-webhook --set-env-vars $env_vars --region us-central1 --project edgeai-493115
    """Send a load board alert SMS to the carrier."""
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

def process_message(message_id: str) -> None:
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
        carrier = get_carrier_profile()

        if carrier and not load_board_matches_carrier(parsed, carrier):
            log.info('"load board message skipped — equipment mismatch message=%s"', message_id)
            mark_as_read(message_id)
            return

        send_load_board_sms(email_data, parsed, board_name)
        mark_as_read(message_id)
        return

    # ── Pre-Claude noise filter — discard before API call ─────────────────────
    _sender = email_data["from_email"]
    _subject = email_data["subject"].lower()
    _domain = _sender.split("@")[-1] if "@" in _sender else ""
    _noise_senders = {"system@ucr.gov"}
    _noise_domains = {"apple.com", "icloud.com"}
    _noise_subjects = {
        "invoice", "statement", "payment due", "remittance",
        "pod", "proof of delivery", "signed bol", "bill of lading", "receipt",
    }
    if (
        _sender in _noise_senders
        or _domain in _noise_domains
        or any(kw in _subject for kw in _noise_subjects)
    ):
        mark_as_read(message_id)
        return

    # Step 3 — broker lookup determines which path to take
    broker = lookup_broker(email_data["from_email"])

    if broker:
        # ── Known broker path ────────────────────────────────────────────────
        log.info('"known broker %s id=%s"', email_data["from_email"], broker.get("id"))

        classification = classify_reply(email_data)
        log.info('"classified %s as %s"', message_id, classification)

        # Insert into responses FIRST — this is the dedup record.
        # Must succeed before SMS so that any retry finds it and stops.
        log_response(email_data, classification, broker_id=broker.get("id"), broker_name=broker.get("name"))

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

        if classification in ("negative", "unknown"):
            log.info('"unknown broker discarded — classification=%s sender=%s"',
                     classification, email_data["from_email"])
            return

        log_unknown_broker_inbox(email_data, extracted)

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
                process_message(msg["id"])
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
            .eq("carrier_id", os.environ["CARRIER_UUID"])
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
        })

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


@app.route("/extract-brokers", methods=["POST"])
def extract_brokers():
    """
    Scan SENT emails for broker contacts not yet in the brokers table.
    Accepts JSON body: {"carrier_id": "<uuid>", "days": <int>}.

    Pipeline:
      1. Page through SENT message IDs (messages.list, no body download)
      2. Metadata fetch per message (To: + Subject: headers only — fast path)
      3. Deduplicate recipient emails; batch-check against brokers table
      4. Claude called ONCE per unique unknown email to enrich contact details
    Never returns 5xx.
    """
    try:
        data = request.get_json(silent=True) or {}

        carrier_id = data.get("carrier_id")
        if not carrier_id:
            return jsonify({"error": "carrier_id required"}), 400

        carrier_resp = (
            supabase_client()
            .table("carriers")
            .select("*")
            .eq("id", carrier_id)
            .limit(1)
            .execute()
        )
        if not carrier_resp.data:
            return jsonify({"error": "carrier not found"}), 404
        carrier = carrier_resp.data[0]

        days = int(data.get("days", 7))
        cutoff_date = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y/%m/%d")

        # ── Build per-carrier Gmail service ───────────────────────────────────
        refresh_token = carrier.get("gmail_token") or os.environ["GMAIL_OAUTH_REFRESH_TOKEN"]
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

        # ── Step 1: Page through SENT message IDs ─────────────────────────────
        message_ids: list[str] = []
        page_token = None
        pages_fetched = 0

        while True:
            list_kwargs: dict = {
                "userId": "me",
                "labelIds": ["SENT"],
                "q": f"after:{cutoff_date}",
                "maxResults": 500,
            }
            if page_token:
                list_kwargs["pageToken"] = page_token

            try:
                list_resp = svc.users().messages().list(**list_kwargs).execute()
            except Exception as exc:
                log.error('"extract_brokers — gmail list failed page=%d: %s"', pages_fetched + 1, exc)
                break

            pages_fetched += 1
            batch = list_resp.get("messages", [])
            message_ids.extend(m["id"] for m in batch)
            page_token = list_resp.get("nextPageToken")
            log.info(
                '"extract_brokers — pages_fetched=%d page_size=%d total_ids=%d"',
                pages_fetched, len(batch), len(message_ids),
            )
            if not page_token:
                break

        log.info('"extract_brokers — step1 done pages=%d messages_scanned=%d"',
                 pages_fetched, len(message_ids))

        # ── Step 2: Metadata fetch — batched 100 IDs per chunk ───────────────────
        # email -> list of unique subjects seen across all messages sent to them
        email_subjects: dict[str, list[str]] = {}
        # email -> display name captured from To: header
        email_names: dict[str, str] = {}

        _NOISE_DOMAINS = {
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
            "xtxtransport.com", "xedge-ai.com",
        }
        _CHUNK_SIZE = 100

        def _handle_meta(request_id, response, exception):
            if exception or not response:
                log.error('"extract_brokers — metadata fetch failed id=%s: %s"', request_id, exception)
                return
            headers = response.get("payload", {}).get("headers", [])
            to_val = subject_val = ""
            for h in headers:
                name_lower = h.get("name", "").lower()
                if name_lower == "to":
                    to_val = h.get("value", "")
                elif name_lower == "subject":
                    subject_val = h.get("value", "")
            if not to_val:
                return
            to_name, to_email = parseaddr(to_val)
            to_email = to_email.lower().strip()
            if not to_email:
                return
            domain = to_email.split("@")[-1] if "@" in to_email else ""
            if domain in _NOISE_DOMAINS:
                return
            if to_email not in email_names and to_name:
                email_names[to_email] = to_name.strip()
            if to_email not in email_subjects:
                email_subjects[to_email] = []
            if subject_val and subject_val not in email_subjects[to_email]:
                email_subjects[to_email].append(subject_val)

        chunks = [message_ids[i:i + _CHUNK_SIZE] for i in range(0, len(message_ids), _CHUNK_SIZE)]
        for chunk_idx, chunk in enumerate(chunks):
            batch = svc.new_batch_http_request(callback=_handle_meta)
            for msg_id in chunk:
                batch.add(
                    svc.users().messages().get(
                        userId="me",
                        id=msg_id,
                        format="metadata",
                        metadataHeaders=["To", "Subject"],
                    ),
                    request_id=msg_id,
                )
            try:
                batch.execute()
            except Exception as exc:
                log.error('"extract_brokers — batch execute failed chunk=%d: %s"', chunk_idx + 1, exc)
            log.info(
                '"extract_brokers — step2 chunk=%d/%d msgs_processed=%d unique_emails=%d"',
                chunk_idx + 1, len(chunks), min((chunk_idx + 1) * _CHUNK_SIZE, len(message_ids)), len(email_subjects),
            )

        unique_emails = list(email_subjects.keys())
        log.info('"extract_brokers — step2 done unique_emails=%d"', len(unique_emails))

        # ── Step 3: Batch-check which recipients are already in network ────────
        known_resp = (
            supabase_client()
            .table("brokers")
            .select("email")
            .eq("carrier_id", carrier_id)
            .execute()
        )
        known_set: set[str] = {row["email"].lower() for row in (known_resp.data or [])}

        unknown_emails = [e for e in unique_emails if e not in known_set]
        already_in_network = len(unique_emails) - len(unknown_emails)
        log.info(
            '"extract_brokers — step3 done already_in_network=%d unknown=%d"',
            already_in_network, len(unknown_emails),
        )

        # ── Step 4: Claude enrichment — ONE call per unique unknown email ──────
        brokers = []
        enrich_count = 0

        for email in unknown_emails:
            subjects_str = "; ".join(email_subjects[email][:5]) or "none"
            to_name = email_names.get(email)
            prompt_text = (
                "Given the broker's email address, display name (if known), "
                "and subjects of emails sent to them, extract what you can.\n\n"
                "Return a JSON object with exactly these fields:\n"
                "{\"name\": \"first last or null\", "
                "\"title\": \"job title or null\", "
                "\"company\": \"company name or null\", "
                "\"mobile\": \"mobile phone or null\", "
                "\"direct\": \"direct phone or null\"}\n\n"
                "Return ONLY valid JSON, no other text.\n\n"
                f"Email: {email}\n"
                f"Name hint: {to_name or ''}\n"
                f"Subjects: {subjects_str}"
            )
            try:
                claude_msg = anthropic_client().messages.create(
                    model="claude-haiku-4-5-20251001",
                    max_tokens=200,
                    messages=[{"role": "user", "content": prompt_text}],
                )
                enriched = json.loads(claude_msg.content[0].text.strip())
                enrich_count += 1
            except Exception as exc:
                log.error('"extract_brokers — enrich failed email=%s: %s"', email, exc)
                enriched = {}

            brokers.append({
                "email": email,
                "name": enriched.get("name") or to_name or None,
                "title": enriched.get("title"),
                "company": enriched.get("company"),
                "mobile": enriched.get("mobile"),
                "direct": enriched.get("direct"),
            })

        log.info(
            '"extract_brokers — step4 done claude_enrichments=%d final_broker_count=%d"',
            enrich_count, len(brokers),
        )

        return jsonify({
            "ok": True,
            "brokers": brokers,
            "total": len(brokers),
            "messages_scanned": len(message_ids),
            "already_in_network": already_in_network,
        }), 200

    except Exception as exc:
        log.error('"extract_brokers — unhandled exception: %s"', exc, exc_info=True)
        return jsonify({"ok": False, "error": "internal error", "brokers": []}), 200


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

        # Pre-fetch existing emails for this carrier to detect duplicates without
        # relying on DB constraint errors in the hot path.
        existing_resp = (
            supabase_client()
            .table("brokers")
            .select("email")
            .eq("carrier_id", carrier_id)
            .execute()
        )
        existing_set: set[str] = {row["email"].lower() for row in (existing_resp.data or [])}

        for broker in broker_list:
            email = (broker.get("email") or "").lower().strip()
            if not email:
                log.error('"import_brokers — skipping entry with no email"')
                errors += 1
                continue

            if email in existing_set:
                duplicates += 1
                continue

            try:
                supabase_client().table("brokers").insert({
                    "carrier_id": carrier_id,
                    "email": email,
                    "name": broker.get("name"),
                    "company": broker.get("company"),
                    "phone": broker.get("mobile") or broker.get("direct"),
                    "status": "warm",
                    "priority": "medium",
                    "days_cadence": 3,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }).execute()
                existing_set.add(email)
                imported += 1
            except Exception as exc:
                log.error('"import_brokers — insert failed email=%s: %s"', email, exc)
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
        carrier_id = session["metadata"].get("carrier_id")
        tier = session["metadata"].get("tier")

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
                    "stripe_customer_id": session.get("customer"),
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
