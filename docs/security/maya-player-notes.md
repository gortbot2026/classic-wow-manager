# Security: Maya Player Notes Extraction (`bot_player_notes`)

## Feature Overview
`extractPlayerNotes()` in `scripts/persona-bot.cjs` — fires after every Maya DM reply to extract and store personal player facts for future context.

## Authentication & Authorization
- Triggered internally only — no HTTP endpoint, no user-facing API
- Discord user identity is the `discordId` passed from the authenticated message handler (passport-discord session already validated upstream)
- Notes are scoped per `discord_id` — players cannot read or write each other's notes through this path

## Input Handling
- `playerMessage` and `mayaReply` are interpolated into the LLM extraction prompt as quoted context strings
- **Prompt injection risk is LOW**: even if a player crafts a message to confuse the LLM, the blast radius is limited to their own notes being stored (false or noisy, not harmful)
- Output notes are individually trimmed to 500 characters before insertion

## SQL Injection
- Query uses parameterized statements (`$1`, `$2`, `$3`) — no injection risk

## Error Handling & Data Leakage
- Entire function is fire-and-forget: `.catch(err => console.error(...))` — failures log server-side only, never surface to the Discord user
- JSON parse errors are silently swallowed within the function body

## Data Stored
- Only personal, non-queryable facts (enforced by LLM prompt)
- DO NOT store list explicitly excludes: gold, raids, loot, character data, guild join date
- Max 500 chars per note

## Deduplication
- Up to 20 most recent existing notes are passed into the extraction prompt
- LLM instructed to skip semantically similar, rephrased, or subset notes

## Known Dependency Concerns (Pre-existing, not this PR)
- `multer ≤2.0.2`: DoS via incomplete cleanup (used in file upload routes — unrelated to notes extraction). Flag for future sprint.
- `fast-xml-parser` (via AWS SDK): Critical DoS CVE — not in the request path for this feature.
- `qs` and `axios`: DoS vulnerabilities, pre-existing.

## Audit Logging
- Successful note insertions emit a `maya:note-added` Socket.IO event to `/maya-admin` namespace for real-time admin visibility

---
*Last reviewed: 2026-03-04 by Security Gort*
