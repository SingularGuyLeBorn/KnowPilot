import { describe, it, expect } from "vitest";
import { isBackendDown, isTransientTrpcFailure } from "../backendReachability";

describe("backendReachability", () => {
  it("429 / TOO_MANY_REQUESTS 是瞬态，不算后端宕机", () => {
    expect(isTransientTrpcFailure({ data: { httpStatus: 429 } })).toBe(true);
    expect(isTransientTrpcFailure({ message: "TOO_MANY_REQUESTS" })).toBe(true);
    expect(isBackendDown([{ data: { httpStatus: 429 } }])).toBe(false);
  });

  it("网络类硬失败才算后端宕机", () => {
    expect(isBackendDown([{ data: { httpStatus: 500 }, message: "boom" }])).toBe(true);
    expect(isBackendDown([null, { data: { httpStatus: 429 } }])).toBe(false);
    expect(isBackendDown([null, null])).toBe(false);
  });
});
