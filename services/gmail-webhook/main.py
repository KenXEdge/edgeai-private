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
from datetime import datetime, timezone
from email import message_from_bytes
from email.utils import parseaddr

import anthropic
from flask import Flask, request, jsonify
from supabase import create_client, Client
from twilio.rest import Client as TwilioClient
from google.oauth2.credentials import Credentials as OAuthCredentials
from google.auth.transport.requests import Request as GoogleAuthRequest
from googleapiclient.discovery import build

# ── Structured JSON logging for Cloud Run ─────────────────────────────────────
logging.basicConfig(
    stream=sys.stdout,
    level=logging.INFO,
    format='{"time":"%(asctime)s","level":"%(levelname)s","msg":%(message)s}',
)
log = logging.getLogger(__name__)

app = Flask(__name__)

# ── Lazy singletons (initialised once per container cold start) ────────────────
_supabase: Client | None = None
_anthropic: anthropic.Anthropic | None = None
_twilio: TwilioClient | None = None
_gmail = None  # googleapiclient resource


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
    """
    Build Gmail API service using OAuth 2.0 refresh token.
    Reads GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_OAUTH_REFRESH_TOKEN
    from environment. Token is refreshed eagerly on first use so any
    credential errors surface at startup rather than mid-request.
    """
    global _gmail
    if _gmail is None:
        log.info('"building gmail OAuth credentials — user=%s"', os.environ.get("GMAIL_USER"))

        creds = OAuthCredentials(
            token=None,
            refresh_token=os.environ["GMAIL_OAUTH_REFRESH_TOKEN"],
            token_uri="https://oauth2.googleapis.com/token",
            client_id=os.environ["GMAIL_CLIENT_ID"],
            client_secret=os.environ["GMAIL_CLIENT_SECRET"],
            scopes=["https://www.googleapis.com/auth/gmail.modify"],
        )

        creds.refresh(GoogleAuthRequest())
        log.info('"OAuth token refreshed — valid=%s"', creds.valid)

        _gmail = build("gmail", "v1", credentials=creds, cache_discovery=False)

        try:
            profile = _gmail.users().getProfile(userId="me").execute()
            log.info('"OAuth verified — connectedAs=%s messagesTotal=%s"',
                     profile.get("emailAddress"), profile.get("messagesTotal"))
        except Exception as exc:
            log.error('"OAuth verification FAILED — %s"', exc)
            _gmail = None
            raise

    return _gmail


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
                q="in:inbox newer_than:1h",
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


def log_response(email_data: dict, classification: str) -> None:
    supabase_client().table("responses").insert(
        {
            "gmail_message_id": email_data["message_id"],
            "thread_id": email_data["thread_id"],
            "broker_email": email_data["from_email"],
            "subject": email_data["subject"],
            "body": email_data["body"],
            "classification": classification,
            "carrier_id": os.environ["CARRIER_UUID"],
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
    ).execute()


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


EXTRACT_PROMPT = """You are analyzing a freight broker email sent to a carrier.

Return a JSON object with exactly these fields:
{{
  "classification": "<label>",
  "sender_name": "<name or null>",
  "load_origin": "<city, state or null>",
  "load_destination": "<city, state or null>",
  "rate_offered": "<amount or null>"
}}

Classification labels:
- load_offer   : offering a specific load, lane, or rate
- positive     : interested/positive but no specific load offered
- negative     : not interested, DNC, out of network
- question     : asking a clarifying question
- unknown      : cannot determine intent

Extraction rules:
- sender_name: full name from email signature, null if not present
- load_origin: pickup city/state e.g. "Dallas, TX", null if not mentioned
- load_destination: delivery city/state e.g. "Chicago, IL", null if not mentioned
- rate_offered: dollar rate e.g. "$2.50/mile" or "$1,500 flat", null if not mentioned

Return ONLY valid JSON, no other text.

Subject: {subject}
Body:
{body}"""


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
        msg = anthropic_client().messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=200,
            messages=[
                {
                    "role": "user",
                    "content": EXTRACT_PROMPT.format(
                        subject=email_data["subject"],
                        body=email_data["body"],
                    ),
                }
            ],
        )
        raw = msg.content[0].text.strip()
        extracted = json.loads(raw)
        if extracted.get("classification") not in {
            "load_offer", "positive", "negative", "question", "unknown"
        }:
            extracted["classification"] = "unknown"
        return extracted
    except Exception as exc:
        log.error('"classify_and_extract failed: %s"', exc)
        return fallback


# ── Twilio SMS ─────────────────────────────────────────────────────────────────

def send_load_offer_sms(email_data: dict) -> None:
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


# ── Core processing pipeline ───────────────────────────────────────────────────

def process_message(message_id: str) -> None:
    """Full pipeline for one Gmail message."""

    # Step 1 — deduplication FIRST, before any API calls or processing
    # Prevents 150x replay: if the message is already in either table, stop immediately.
    if is_duplicate(message_id):
        log.info('"duplicate message %s — skipping"', message_id)
        return

    # Step 2 — fetch email content from Gmail API
    email_data = fetch_message(message_id)
    if not email_data:
        return

    log.info('"processing message %s from %s"', message_id, email_data["from_email"])

    # Step 3 — broker lookup determines which path to take
    broker = lookup_broker(email_data["from_email"])

    if broker:
        # ── Known broker path ────────────────────────────────────────────────
        log.info('"known broker %s id=%s"', email_data["from_email"], broker.get("id"))

        classification = classify_reply(email_data)
        log.info('"classified %s as %s"', message_id, classification)

        # Insert into responses FIRST — this is the dedup record.
        # Must succeed before SMS so that any retry finds it and stops.
        log_response(email_data, classification)

        if classification == "load_offer":
            send_load_offer_sms(email_data)
            log_load_win(email_data)

        update_broker_status(broker["id"], classification)

    else:
        # ── Unknown broker path ──────────────────────────────────────────────
        log.info('"unknown broker %s — classifying and logging to unknown_brokers_inbox"',
                 email_data["from_email"])

        extracted = classify_and_extract(email_data)
        classification = extracted.get("classification", "unknown")
        log.info('"unknown broker classified %s as %s"', message_id, classification)

        # Insert into unknown_brokers_inbox FIRST — this is the dedup record.
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


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    app.run(host="0.0.0.0", port=port)
