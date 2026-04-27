2FA and Bot Detection Considerations
Sylectus may implement:

Standard username/password only — Playwright handles cleanly
2FA mobile authenticator — same problem as BEON, same Chrome Extension solution
Bot/scraping detection — requires User-Agent spoofing, randomized timing, session management

Assess at build time. If 2FA present — Chrome Extension is primary path, same as BEON Phase 2. If no 2FA — Playwright with stored credentials runs server-side cleanly.

New carriers Table Fields Required
FieldTypePurposesylectus_usernametextCarrier Sylectus loginsylectus_passwordtext encryptedEncrypted at rest, never plaintextsylectus_enabledbooleanMaster toggle — carrier opts insylectus_scrape_intervalintegerMinutes between scrape runssylectus_session_cookietext encryptedStored session for headless reusesylectus_session_expires_attimestampSession expiry tracking

load_alerts Table — Sylectus Source Tag
Existing load_alerts table handles Sylectus with source field:
ColumnValue for Sylectussourcesylectusload_idSylectus internal listing IDdecisionalert / skipoutcomecarrier_clicked / expired / ignored

Broker Harvesting — Table Impact
TableImpactunknown_brokers_inboxNew broker contacts land here pending carrier reviewbrokersApproved contacts move here with source = sylectusresponsesOnce in brokers table, Gmail Watch monitors inbound email from them

Risk Register
RiskSeverityMitigationSylectus ToS violationHighExplicit carrier opt-in with disclosure. Carrier accepts risk.Bot detectionMediumRandomized timing, User-Agent management, Chrome Extension fallback2FA barrierMediumChrome Extension path eliminates — same as BEON Phase 2Credential exposureHighEncrypted at rest, never logged, never plaintextScrape frequency rate limitingMediumConfigurable interval, back-off on 429 responsesListing format changeLowClaude-assisted parsing flexible to layout changesDuplicate broker entriesLowDeduplication check on email before insert

Competitive Moat
Sylectus broker harvesting is a direct pipeline into ACE's core function. Every load scrape potentially adds new broker contacts to the carrier's network — contacts that ACE then monitors via Gmail 24/7. The platform gets smarter and more valuable the longer the carrier uses it. Combined with BEON Phase 1 load alerts, ACE is monitoring two major load sources simultaneously with zero carrier involvement.

Relationship to BEON Build
ComponentBEONSylectusTriggerInbound email pushScheduled Playwright pullLoad sourceNTG load alert emailsSylectus load boardBroker discoveryNoYes — harvests broker emailsAuto-bookYes — Phase 2 Chrome ExtensionNo — alert + deep link onlySMS alertYesYesload_alerts tableYesYes — source = sylectus
Both features share the same load_alerts table, same SMS pipeline, same carrier rules check. Build BEON Phase 1 first — Sylectus Phase 1 reuses most of the same infrastructure.

References

PRD v4.5 Section 12 — BEON architecture (Sylectus to be added as Section 13)
BEON_AutoBook_April27.md — parallel session note
carriers table migration required before Phase 1
Telnyx must be live before SMS alerts deliver value
Chrome Extension (BEON Phase 2) reusable for Sylectus Phase 3


SYLECTUS Load Board Automation Session Note | April 27 2026 | XEdge / XTX LLC
