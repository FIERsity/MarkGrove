import { describe, expect, it } from "vitest";
import { initialOrderKey, orderKeyBetween } from "./order";

describe("sparse workspace ordering", () => {
  it("creates lexically sortable keys and inserts between them", () => {
    const first = initialOrderKey(0); const second = initialOrderKey(1);
    const middle = orderKeyBetween(first, second);
    expect(first < middle!).toBe(true); expect(middle! < second).toBe(true);
    expect(orderKeyBetween(null, first)! < first).toBe(true);
  });
});
