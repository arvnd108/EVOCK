// @vitest-environment jsdom
/**
 * EVOCK — vault page controller (Role C, step 03 / C3).
 *
 * initVault is exercised against an injected `vaultApi` seam — no service
 * worker, no IndexedDB, no decryption.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { assertNoCiphertext, chromeVaultApi, initVault } from "../../extension/src/vault/vault.js";
import { makeVaultList } from "../helpers/make-vault.js";

const NOW = Date.parse("2026-09-08T12:00:00+05:30");

function mountDom() {
  document.body.innerHTML = `
    <div class="nk-vault">
      <span id="vault-count"></span>
      <div id="vault-filters"></div>
      <main id="vault-body"></main>
    </div>`;
  return document.getElementById("vault-body");
}

function fakeApi(items) {
  return { list: vi.fn(async () => items) };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("initVault", () => {
  it("renders vault.50 as a grouped timeline with a record count", async () => {
    const mount = mountDom();
    const api = fakeApi(makeVaultList(50));

    await initVault(mount, { vaultApi: api, now: NOW });

    expect(api.list).toHaveBeenCalledTimes(1);
    expect(document.getElementById("vault-count").textContent).toBe("50 records");
    expect(mount.querySelectorAll(".nk-day").length).toBeGreaterThanOrEqual(10);
    expect(mount.querySelectorAll(".nk-record")).toHaveLength(50);
    expect(mount.querySelectorAll("img")).toHaveLength(0);
  });

  it("shows the empty state (and no filters) when the vault is empty", async () => {
    const mount = mountDom();
    await initVault(mount, { vaultApi: fakeApi([]), now: NOW });

    expect(mount.querySelector(".nk-empty")).not.toBeNull();
    expect(mount.textContent).toMatch(/Preserve Evidence in the EVOCK popup/);
    expect(document.getElementById("vault-count").textContent).toBe("");
    expect(document.getElementById("vault-filters").children).toHaveLength(0);
  });

  it("renders a null-field row without a blank cell", async () => {
    const mount = mountDom();
    const item = {
      evidence_id: "NK-0003",
      created_at: "2026-09-05T20:41:03+05:30",
      platform_label: "Unknown",
      contact_label: null,
      source: null,
      capture: null,
      extraction_status: "ok",
      last_verification: null
    };
    await initVault(mount, { vaultApi: fakeApi([item]), now: NOW });

    const row = mount.querySelector(".nk-record");
    expect(row.querySelector(".nk-record__platform").textContent).toBe("Unknown");
    expect(row.querySelector(".nk-record__contact").textContent).toBe("unknown account");
  });

  it("applies a filter change without re-fetching", async () => {
    const mount = mountDom();
    const api = fakeApi(makeVaultList(50));
    await initVault(mount, { vaultApi: api, now: NOW });

    const select = document
      .getElementById("vault-filters")
      .querySelector('select[aria-label="Verification status"]');
    select.value = "never";
    select.dispatchEvent(new Event("change"));

    expect(api.list).toHaveBeenCalledTimes(1); // no second fetch
    expect(mount.querySelectorAll(".nk-record")).toHaveLength(10);
    expect(document.getElementById("vault-count").textContent).toBe("10 of 50 records");
  });

  it("clicking a row calls onSelect and bubbles vault:select", async () => {
    const mount = mountDom();
    const onSelect = vi.fn();
    const heard = vi.fn();
    mount.addEventListener("vault:select", heard);

    await initVault(mount, { vaultApi: fakeApi(makeVaultList(3)), now: NOW, onSelect });
    mount.querySelector(".nk-record").click();

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(heard.mock.calls[0][0].detail.evidence_id).toMatch(/^NK-\d{4}$/);
  });

  it("renders 50 rows well under a time budget and touches the api exactly once", async () => {
    const mount = mountDom();
    const api = fakeApi(makeVaultList(50));
    const t0 = performance.now();
    await initVault(mount, { vaultApi: api, now: NOW });
    expect(performance.now() - t0).toBeLessThan(500);
    expect(api.list).toHaveBeenCalledTimes(1);
  });
});

describe("assertNoCiphertext", () => {
  it("passes a clean metadata list", () => {
    expect(() => assertNoCiphertext(makeVaultList(5))).not.toThrow();
  });

  it("throws if a list item carries screenshot bytes", () => {
    expect(() => assertNoCiphertext([{ evidence_id: "x", screenshot_ciphertext: "AAAA" }])).toThrow(
      /metadata only/
    );
    expect(() => assertNoCiphertext([{ evidence_id: "x", iv: "AAAA" }])).toThrow();
  });
});

describe("chromeVaultApi", () => {
  it("unwraps { ok, items } and rejects a failed response", async () => {
    const send = vi.fn(async () => ({ ok: true, items: [{ evidence_id: "NK-0001" }] }));
    vi.stubGlobal("chrome", { runtime: { sendMessage: send } });

    await expect(chromeVaultApi.list({ sort: "newest" })).resolves.toEqual([
      { evidence_id: "NK-0001" }
    ]);
    expect(send).toHaveBeenCalledWith({
      type: "LIST_EVIDENCE",
      payload: { sort: "newest" }
    });

    send.mockResolvedValueOnce({ ok: false, error: "boom" });
    await expect(chromeVaultApi.list()).rejects.toThrow("boom");

    vi.unstubAllGlobals();
  });
});
