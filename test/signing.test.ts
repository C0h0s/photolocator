import assert from "node:assert/strict";
import { test } from "node:test";
import { safeReturnTo, signToken, verifyToken } from "../src/lib/signing.ts";

const SECRET = "test-secret-that-is-at-least-32-characters";
const future = () => Math.floor(Date.now() / 1000) + 60;

test("round-trips a signed payload", () => {
  const token = signToken({ uid: 7, name: "mapper", exp: future() }, SECRET);
  assert.deepEqual(verifyToken<{ uid: number; name: string }>(token, SECRET)?.uid, 7);
});

test("rejects tampered payloads and signatures", () => {
  const token = signToken({ uid: 7, exp: future() }, SECRET);
  const [body, mac] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ uid: 1, exp: future() })).toString("base64url");
  assert.equal(verifyToken(`${forged}.${mac}`, SECRET), null);
  assert.equal(verifyToken(`${body}.${mac.slice(0, -2)}xx`, SECRET), null);
  assert.equal(verifyToken(token, "another-secret-that-is-32-characters!!"), null);
});

test("rejects expired, missing-exp and malformed tokens", () => {
  assert.equal(verifyToken(signToken({ uid: 7, exp: Math.floor(Date.now() / 1000) - 1 }, SECRET), SECRET), null);
  assert.equal(verifyToken(signToken({ uid: 7 }, SECRET), SECRET), null);
  for (const bad of [undefined, "", "abc", ".abc", "abc."]) assert.equal(verifyToken(bad, SECRET), null);
});

test("only allows same-site relative return paths", () => {
  assert.equal(safeReturnTo("/history"), "/history");
  assert.equal(safeReturnTo("/search/abc?x=1"), "/search/abc?x=1");
  for (const bad of [null, undefined, "", "https://evil.example", "//evil.example", "/\\evil.example", "history"]) {
    assert.equal(safeReturnTo(bad), "/");
  }
});
