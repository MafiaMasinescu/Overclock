import { describe, expectTypeOf, test } from "vitest";

import type { DesignDraftOperation, JsonObject } from "../../src/sim/core/types.ts";

describe("authoritative state contracts", () => {
  test("restricts design draft payloads to serializable JSON data", () => {
    expectTypeOf<DesignDraftOperation["payload"]>().toEqualTypeOf<JsonObject>();
  });
});
