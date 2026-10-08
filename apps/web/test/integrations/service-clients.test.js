import { test, expect } from "bun:test";
import {
  splitEntries,
  mergeReturnOrigins,
  mergeOrganizationIds,
  validateOrganizationIds,
  validateReturnOrigins,
  validateServiceClient,
} from "../../src/features/billing/integrations/service-clients-api";
const payload = {
  enabled: true,
  products: ["balanz_cfdi"],
  organizationScope: "organizations",
  organizationIds: ["63a13f20-5774-4e85-9bf1-079d83046ed5"],
  allowedReturnOrigins: ["https://balanz.test"],
  allowSharedCheckouts: false,
};

test("accepts a concrete consumer and normalizes multiline entries without duplication", () => {
  expect(splitEntries("balanz_cfdi, balanz_cfdi\nother")).toEqual([
    "balanz_cfdi",
    "other",
  ]);
  expect(validateServiceClient("balanz-service", payload)).toEqual({});
});
test("requires organizations only for the restricted scope", () => {
  expect(
    validateServiceClient("balanz-service", {
      ...payload,
      organizationIds: [],
    }),
  ).toHaveProperty("organizationIds");
  expect(
    validateServiceClient("balanz-service", {
      ...payload,
      organizationScope: "all_for_allowed_products",
      organizationIds: undefined,
    }),
  ).toEqual({});
});
test("rejects return paths, wildcards, credentials and nonlocal HTTP", () => {
  for (const origin of [
    "https://balanz.test/path",
    "https://*.test",
    "https://user:secret@balanz.test",
    "http://balanz.test",
    "https://balanz.test?x=1",
  ])
    expect(
      validateServiceClient("balanz-service", {
        ...payload,
        allowedReturnOrigins: [origin],
      }),
    ).toHaveProperty("allowedReturnOrigins");
});
test("rejects unknown organization IDs, empty origins and wildcard products", () => {
  expect(
    validateServiceClient("invalid client", {
      ...payload,
      products: ["*"],
      organizationIds: ["bad"],
      allowedReturnOrigins: [],
    }),
  ).toEqual({
    clientId: expect.any(String),
    products: expect.any(String),
    organizationIds: expect.any(String),
    allowedReturnOrigins: expect.any(String),
  });
});

test("adds pasted return origins without losing selections or introducing duplicates", () => {
  const origins = mergeReturnOrigins(["https://balanz.test"], "https://other.test, https://balanz.test\nhttp://localhost:5175");
  expect(origins).toEqual(["https://balanz.test", "https://other.test", "http://localhost:5175"]);
  expect(validateReturnOrigins(origins)).toBeUndefined();
  expect(validateReturnOrigins(mergeReturnOrigins(origins, "https://other.test/path"))).toBeDefined();
  expect(validateReturnOrigins([])).toBeDefined();
});

test("adds pasted organization UUIDs with case-insensitive deduplication and validation", () => {
  const id = "63a13f20-5774-4e85-9bf1-079d83046ed5";
  const other = "73a13f20-5774-4e85-9bf1-079d83046ed5";
  const ids = mergeOrganizationIds([id], `${id.toUpperCase()},\n${other}`);
  expect(ids).toEqual([id, other]);
  expect(validateOrganizationIds(ids)).toBeUndefined();
  expect(validateOrganizationIds(mergeOrganizationIds(ids, "bad-uuid"))).toBeDefined();
  expect(validateOrganizationIds([])).toBeDefined();
  expect(validateOrganizationIds(Array(1001).fill(id))).toBeDefined();
});
