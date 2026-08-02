import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { canWriteDelta, validateDeltaPayload } from "../app/lib/validation.mjs";


test("declares the private Alpha sign-in boundary", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /PRIVATE ALPHA/);
  assert.match(page, /使用 ChatGPT 登录/);
  assert.match(page, /chatGPTSignInPath/);
});

test("does not retain the starter preview in product sources", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(page, /JudgmentWorkbench/);
  assert.match(page, /force-dynamic/);
  assert.match(layout, /思考情报台/);
  assert.doesNotMatch(page, /SkeletonPreview|codex-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});

test("rejects an empty or unknown judgment response", () => {
  assert.ok(validateDeltaPayload({ questionId: "q", materialId: "m", responseType: "park", responseText: "" }).error);
  assert.ok(validateDeltaPayload({ questionId: "q", materialId: "m", responseType: "invented", responseText: "because" }).error);
});

test("requires a validation scenario for real-world verification", () => {
  assert.match(validateDeltaPayload({ questionId: "q", materialId: "m", responseType: "validate_in_context", responseText: "test it" }).error, /validationScenario/);
  assert.deepEqual(validateDeltaPayload({ questionId: "q", materialId: "m", responseType: "validate_in_context", responseText: "test it", validationScenario: "next interview" }).value, { questionId: "q", materialId: "m", responseType: "validate_in_context", responseText: "test it", validationScenario: "next interview" });
});

test("refuses cross-owner and mismatched-material writes", () => {
  const material = { ownerId: "owner-a", questionId: "question-a" };
  assert.equal(canWriteDelta(material, "question-a", "owner-a"), true);
  assert.equal(canWriteDelta(material, "question-b", "owner-a"), false);
  assert.equal(canWriteDelta(material, "question-a", "owner-b"), false);
});
