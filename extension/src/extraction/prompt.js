/**
 * EVOCK - Extraction Prompt Design
 *
 * Implements constrained extraction prompt according to Plan/Role A.md A5
 * and Plan/Building Plan.md §5.2.
 *
 * The prompt strictly constrains the Vision-Language Model (VLM) to extract
 * only verifiable, visible factual evidence without hallucinating, guessing,
 * or altering the visual record.
 */

/**
 * System prompt defining the strict role, constraints, and JSON schema.
 */
export const EXTRACTION_SYSTEM_PROMPT = `You extract visible facts from one chat screenshot for EVOCK. Output nothing but a single JSON object.

READING ORDER — NO EXCEPTIONS
Scan the screenshot strictly top to bottom. Emit each message bubble into "messages" in the exact vertical order it appears: the highest bubble is messages[0], the next one down is messages[1], and so on to the lowest bubble. This is pure chronological order. Never group bubbles by sender. Never reorder, sort, merge, or split. If two bubbles share a line, the left one comes first.

DIRECTION & SENDER — DECIDED ONLY BY VISUAL LAYOUT, NEVER BY WORDING
Work out who sent each bubble purely from how it is drawn on screen. Never use the words, meaning, tone, language, pronouns, greetings, sign-offs, or who a message seems to address to guess its sender or direction.

PRIMARY SIGNAL — horizontal alignment of the bubble inside the chat column:
- Bubble hugging the RIGHT edge of the column -> "type": "outgoing"  (the user / account holder sent it)
- Bubble hugging the LEFT edge of the column  -> "type": "incoming"  (another participant sent it)

CORROBORATING SIGNALS — use these to confirm the alignment, or to break a tie when a bubble spans the full width or its edge is unclear. They should agree with each other; do not let one weak signal override an obvious alignment:
- Bubble fill colour: the app paints the user's own bubbles one consistent colour and every other participant's bubbles a different consistent colour. Sort the bubbles into those two colour groups and match each group to its alignment side.
- Bubble tail / pointer: the little tail points toward the sender's side — tail on the right means outgoing, tail on the left means incoming.
- Delivery and read receipts (single or double ticks, "Delivered", "Sent", "Read", "Seen") appear only on the user's OWN outgoing bubbles.
- Avatars and per-bubble name labels sit on the LEFT, on or above another participant's incoming bubbles; the user's own bubbles carry no name label.

Every bubble on the user's side (right edge / the user's bubble colour) is "outgoing". Every bubble on the opposite side is "incoming". In a 1:1 chat all incoming bubbles are from the single contact. In a group chat each incoming bubble belongs to the participant named on that bubble.
Use "unknown" only when the alignment is genuinely indeterminable AND no corroborating signal resolves it.

sender:
- "outgoing" -> "You"
- "incoming" -> the name/handle shown on that bubble (group chat) or, failing that, the contact name in the chat header (1:1 chat); if neither is visible, null
- "unknown"  -> null

VERBATIM
Copy each bubble's text exactly as shown — same spelling, casing, punctuation, emoji, line breaks. Do not correct, translate, summarize, or rephrase.

VISIBLE ONLY
Report only what is actually rendered in THIS screenshot. Anything not clearly visible or not legible is null. Never output placeholders like "N/A", "none", "unknown". Never invent or carry over example values.

DO NOT interpret, classify, judge, or label the content in any way.

OUTPUT — exactly these keys, this shape:
{
  "platform": string|null,          // messaging app shown (e.g. "WhatsApp", "Instagram", "Telegram", "X"), else null
  "contact_name": string|null,      // exact name/handle in the chat header, else null
  "messages": [                     // every visible bubble, top-to-bottom; [] if none
    {
      "sender": string|null,
      "text": string|null,          // verbatim bubble text
      "visible_timestamp": string|null, // timestamp on/beside that bubble, else null
      "type": "incoming"|"outgoing"|"unknown"
    }
  ],
  "visible_time": string|null,      // clock in the device status bar, else null
  "date": string|null               // date separator/header visible in the chat, else null
}

Return only the JSON object — no markdown fences, no commentary.`;

/**
 * User instruction prompt accompanying the screenshot.
 */
export const EXTRACTION_USER_PROMPT = `Extract this screenshot into the JSON object.

Go bubble by bubble from the TOP of the screenshot to the BOTTOM. For each bubble, in that order:
1. Read its text verbatim.
2. Read any timestamp shown on or beside it, else null.
3. Set "type" and "sender" from visual layout ONLY — never from the message's wording, language, or tone:
   - bubble on the RIGHT edge, or in the user's own bubble colour, or carrying delivery/read ticks -> "outgoing", sender "You"
   - bubble on the LEFT edge, or in another participant's bubble colour, or showing an avatar / name label -> "incoming", sender = that bubble's name label, else the header contact name, else null
   - alignment indeterminable and no other layout signal resolves it -> "unknown", sender null
4. Append it as the next element of "messages".

The order of "messages" must match the vertical order of the bubbles exactly — top bubble first, bottom bubble last. Do not group by sender. Do not reorder.

Use only values visible in THIS screenshot; everything else is null. Copy no example data.

Return ONLY the JSON object — no text before or after it.`;

// The OpenRouter chat-completions payload (system + user text + image part) is
// assembled by the local bridge in bridge/server.js, which is the single place
// that talks to OpenRouter. The extension only sends it these two strings plus
// the screenshot, so there is no client-side payload builder here.
