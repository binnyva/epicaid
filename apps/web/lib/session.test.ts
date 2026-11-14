import { describe, expect, it } from "vitest";
import { isBootstrapAdmin, maySignIn } from "./access";
import { parseOrderPositions } from "./reading-order";
import { decodeSession, encodeSession, newSession } from "./session";

const secret = "x".repeat(40);

describe("session cookies", () => {
  it("round-trips a session", () => {
    const s = newSession("reader-1", 0);
    expect(decodeSession(encodeSession(s, secret), secret, 0)).toEqual(s);
  });

  it("rejects a tampered or foreign cookie", () => {
    const token = encodeSession(newSession("reader-1", 0), secret);
    const [, mac] = token.split(".");
    const forged = `${Buffer.from(JSON.stringify({ readerId: "admin", exp: 9e9 })).toString("base64url")}.${mac}`;
    expect(decodeSession(forged, secret, 0)).toBeNull();
    expect(decodeSession(token, "y".repeat(40), 0)).toBeNull();
    expect(decodeSession("garbage", secret, 0)).toBeNull();
  });

  it("rejects an expired session", () => {
    const token = encodeSession({ readerId: "r", exp: 100 }, secret);
    expect(decodeSession(token, secret, 101_000)).toBeNull();
  });
});

describe("sign-in access", () => {
  it("lets the bootstrap admin in without the allow-list, ignoring case", () => {
    expect(maySignIn("Me@Example.com", [], "me@example.com")).toBe(true);
    expect(isBootstrapAdmin("someone@example.com", "me@example.com")).toBe(false);
  });

  it("needs the allow-list for everyone else", () => {
    expect(maySignIn("friend@example.com", [], "me@example.com")).toBe(false);
    expect(maySignIn("Friend@example.com", ["friend@example.com"], "me@example.com")).toBe(true);
  });

  it("lets nobody in by default when ADMIN_EMAIL is unset", () => {
    expect(maySignIn("me@example.com", [], undefined)).toBe(false);
  });
});

describe("parseOrderPositions", () => {
  it("leaves out blank boxes and renumbers from 0", () => {
    const order = parseOrderPositions([
      ["name", "Publication"],
      ["pos:b", "3"],
      ["pos:a", "1"],
      ["pos:c", ""],
      ["pos:d", "10"],
    ]);
    expect(order).toEqual([
      { bookId: "a", position: 0 },
      { bookId: "b", position: 1 },
      { bookId: "d", position: 2 },
    ]);
  });
});
