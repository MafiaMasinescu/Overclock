import { expect, test } from "@playwright/test";

interface BrowserCodecResult {
  readonly noneHash: string;
  readonly gzipHash: string;
  readonly stateHash: string;
  readonly nativeCrypto: boolean;
  readonly nativeCompression: boolean;
}

test("round-trips none and gzip saves through native Chromium primitives", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async (): Promise<BrowserCodecResult> => {
    const moduleUrl = "/tests/e2e/saveCodecBrowserHarness.ts";
    const harness = (await import(moduleUrl)) as {
      runBrowserSaveCodecRoundTrip: () => Promise<BrowserCodecResult>;
    };
    return harness.runBrowserSaveCodecRoundTrip();
  });

  expect(result.nativeCrypto).toBe(true);
  expect(result.nativeCompression).toBe(true);
  expect(result.noneHash).toMatch(/^[0-9a-f]{64}$/);
  expect(result.gzipHash).toBe(result.noneHash);
  expect(result.stateHash).toMatch(/^[0-9a-f]{16}$/);
});
