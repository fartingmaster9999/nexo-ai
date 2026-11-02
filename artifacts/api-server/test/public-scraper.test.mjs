import test from "node:test";
import assert from "node:assert/strict";
import { isPublicAddress, isPublicUrl } from "../src/lib/public-scraper.ts";

test("public scraping rejects private, link-local, loopback and mapped private addresses", () => {
  for (const address of ["127.0.0.1","10.0.0.1","172.16.0.5","192.168.1.1","169.254.169.254","100.64.0.1","::1","fc00::1","fe80::1","::ffff:127.0.0.1"]) {
    assert.equal(isPublicAddress(address),false,address);
  }
  assert.equal(isPublicAddress("8.8.8.8"),true);
});

test("scraper allows only normal public HTTPS targets without embedded credentials", () => {
  for (const url of ["http://example.com","file:///etc/passwd","https://localhost/","https://service.internal/","https://127.0.0.1","https://[::1]/","https://user:pass@example.com","https://example.com:8080"]) {
    assert.equal(isPublicUrl(url),false,url);
  }
  assert.equal(isPublicUrl("https://www.python.org/downloads/"),true);
});
