import assert from "node:assert/strict";
import test from "node:test";
import { resolveWebsiteOpenRequest } from "../src/lib/open-website.ts";

test("opens common site names from a direct Nexo command", () => {
  assert.deepEqual(
    resolveWebsiteOpenRequest("Nexo, can you open Google Classroom in a new tab for me?"),
    {
      kind: "website",
      label: "Google Classroom",
      url: "https://classroom.google.com/",
    },
  );
});

test("opens a supplied HTTPS URL and a bare domain", () => {
  assert.deepEqual(
    resolveWebsiteOpenRequest("Open https://school.example.edu/classes"),
    {
      kind: "website",
      label: "school.example.edu",
      url: "https://school.example.edu/classes",
    },
  );
  assert.deepEqual(
    resolveWebsiteOpenRequest("Visit www.example.org"),
    {
      kind: "website",
      label: "example.org",
      url: "https://www.example.org/",
    },
  );
  assert.deepEqual(
    resolveWebsiteOpenRequest("Open chatgpt.com"),
    {
      kind: "website",
      label: "chatgpt.com",
      url: "https://chatgpt.com/",
    },
  );
  assert.deepEqual(
    resolveWebsiteOpenRequest("Open example.net/docs"),
    {
      kind: "website",
      label: "example.net",
      url: "https://example.net/docs",
    },
  );
  assert.deepEqual(
    resolveWebsiteOpenRequest("Open this link: https://example.net/a-page"),
    {
      kind: "website",
      label: "example.net",
      url: "https://example.net/a-page",
    },
  );
});

test("opens a user-saved class link by label or alternate name", () => {
  const classLinks = [{
    id: "english-work",
    label: "English classwork",
    url: "https://classroom.google.com/u/3/w/course-id/t/all",
    aliases: ["literacy assignments", "ela work"],
  }];
  assert.deepEqual(
    resolveWebsiteOpenRequest("Nexo, open English classwork", classLinks),
    {
      kind: "website",
      label: "English classwork",
      url: "https://classroom.google.com/u/3/w/course-id/t/all",
    },
  );
  assert.deepEqual(
    resolveWebsiteOpenRequest("Open literacy assignments", classLinks),
    {
      kind: "website",
      label: "English classwork",
      url: "https://classroom.google.com/u/3/w/course-id/t/all",
    },
  );
  assert.deepEqual(
    resolveWebsiteOpenRequest("Open the classroom calendar", [{
      id: "class-calendar",
      label: "Classroom calendar",
      url: "https://classroom.google.com/u/3/calendar/this-week/course/all",
      aliases: ["calendar"],
    }]),
    {
      kind: "website",
      label: "Classroom calendar",
      url: "https://classroom.google.com/u/3/calendar/this-week/course/all",
    },
  );
});

test("searches for an unknown site only when the user says it is a website", () => {
  const target = resolveWebsiteOpenRequest("Open the website for Northside High");
  assert.equal(target?.kind, "search");
  assert.match(target?.url ?? "", /^https:\/\/www\.google\.com\/search\?/);
  assert.equal(target?.label, "Northside High");
});

test("does not turn ordinary open requests into website navigation", () => {
  assert.equal(resolveWebsiteOpenRequest("Can you open the conversation about biology?"), null);
  assert.equal(resolveWebsiteOpenRequest("What is Google Classroom?"), null);
});

test("does not allow non-web protocols", () => {
  assert.equal(resolveWebsiteOpenRequest("Open javascript:alert(1)"), null);
  assert.equal(resolveWebsiteOpenRequest("Open data:text/html,hello"), null);
});
