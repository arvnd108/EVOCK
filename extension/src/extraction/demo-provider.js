/**
 * EVOCK - Demo Extraction Provider
 *
 * Implements DemoExtractionProvider according to Plan/Role A.md A4 and
 * Plan/Building Plan.md §5.2.
 *
 * Provides deterministic, offline structured extraction without requiring
 * OpenRouter, a local bridge, or an internet connection.
 */

import { validateAndNormalizeExtraction } from "./schema.js";

/**
 * @typedef {Object} ExtractedMessage
 * @property {string|null} sender
 * @property {string|null} text
 * @property {string|null} visible_timestamp
 * @property {"incoming"|"outgoing"|null} type
 *
 * @typedef {Object} ExtractedData
 * @property {string|null} platform
 * @property {string|null} contact_name
 * @property {ExtractedMessage[]} messages
 * @property {string|null} visible_time
 * @property {string|null} date
 *
 * @typedef {Object} ExtractionResult
 * @property {"demo"|"vision"} provider
 * @property {string|null} model
 * @property {string|null} extractedAt
 * @property {ExtractedData|null} data
 * @property {"ok"|"failed"} status
 * @property {string|null} error
 */

/**
 * Helper to infer platform from capture domain for demo realism.
 * @param {string} domain
 * @returns {string}
 */
function inferPlatform(domain = "") {
  const d = domain.toLowerCase();
  if (d.includes("whatsapp")) return "WhatsApp";
  if (d.includes("instagram")) return "Instagram";
  if (d.includes("twitter") || d.includes("x.com")) return "X";
  if (d.includes("facebook") || d.includes("messenger")) return "Facebook Messenger";
  if (d.includes("telegram")) return "Telegram";
  return "Web Platform";
}

export class DemoExtractionProvider {
  constructor() {
    /** @type {"demo"} */
    this.id = "demo";
  }

  /**
   * Performs deterministic offline extraction.
   * Simulates ~600ms latency as specified in Plan/Role A.md A4.
   *
   * @param {Object} [capture] - The CaptureResult object from captureVisibleTab()
   * @returns {Promise<ExtractionResult>}
   */
  async extract(capture) {
    // Simulate ~600ms realistic processing delay
    await new Promise((resolve) => setTimeout(resolve, 600));

    const platform = inferPlatform(capture?.domain || "");

    // Determine platform-appropriate demo contact
    let contactName = "Mr. ABC B";
    let sampleSender = "Mr. ABC B";
    if (platform === "Instagram") {
      contactName = "instagram_user";
      sampleSender = "instagram_user";
    } else if (platform === "Telegram") {
      contactName = "telegram_user";
      sampleSender = "telegram_user";
    } else if (platform === "X") {
      contactName = "x_user";
      sampleSender = "x_user";
    }

    /** @type {ExtractedMessage[]} */
    const messages = [
      {
        sender: sampleSender,
        text: "Don't try to hide.....",
        visible_timestamp: "11:28 PM",
        type: "incoming"
      },
      {
        sender: sampleSender,
        text: "I know where you live",
        visible_timestamp: "11:28 PM",
        type: "incoming"
      }
    ];

    /** @type {ExtractedData} */
    const data = {
      platform,
      contact_name: contactName,
      messages,
      visible_time: "11:28 PM",
      date: "1 September 2026"
    };

    // Run the demo output through the same validator the vision path uses, so
    // both providers are guaranteed to return an identically-shaped result.
    /** @type {ExtractionResult} */
    return validateAndNormalizeExtraction(data, {
      provider: "demo",
      model: "demo-offline-v1"
    });
  }
}
