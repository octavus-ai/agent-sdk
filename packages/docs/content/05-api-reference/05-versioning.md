---
title: Versioning
description: What the platform may change without notice, what it never changes, and how to read the wire so an update never breaks you.
---

# Versioning

The Octavus API and the SDK packages share one contract: the stream events, the stored `UIMessage` parts, the request and response bodies, and the error body. This page is the rule for how that contract moves.

## What is additive

The platform adds to the wire without a version change, and a reader must tolerate every one of these:

| Addition             | Example                                                      | What a reader does                                            |
| -------------------- | ------------------------------------------------------------ | ------------------------------------------------------------- |
| A field on an object | `tool-input-start` gains `display`; a part gains `title`     | Keeps it when storing, ignores it when rendering              |
| An event type        | A new lifecycle event on the stream                          | Ignores it, or forwards it unchanged                          |
| A part type          | A new kind of `UIMessage` part                               | Keeps it in `parts`, renders nothing for it                   |
| An enum value        | A new `finishReason`, `errorType`, `display`, or part status | Falls back to a documented default (`other`, `unknown_error`) |
| An error code        | A new `code` in the error body                               | Acts on the `type` and `retryable`, shows the `error` message |

These never need a new header value, a new SDK major, or a migration.

## What is not additive

Removing a field, renaming one, changing a field's type or meaning, changing an enum value's meaning, or changing what a display mode reveals is a breaking change. It ships behind the wire-format header ([`X-Octavus-Sdk-Version`](/docs/api-reference/overview#wire-format-versioning)) or an SDK major, and the previous shape keeps being served to clients that still speak it.

## How the SDK reads the wire

`@octavus/core` is schema-first and tolerant, and every SDK package reads through it:

- Every object schema keeps the fields it does not know (`safeParseStreamEvent`, `safeParseUIMessage`, `safeParseUIMessages`).
- An event of an unknown `type` parses as `{ kind: 'unknown', event }`; only a malformed known event or a non-event is `{ kind: 'invalid' }`. The client SDK ignores unknown events, the server SDK forwards them.
- A part of an unknown `type` is kept in `parts`. The TypeScript unions (`StreamEvent`, `UIMessagePart`) name the known shapes only, so a value of a type added later reaches your code outside the union: switch on `type` with a `default` branch that ignores the value, and never make that switch exhaustive - an `assertNever` in `default` throws the first time the platform adds a type.
- An enum value the package does not know reads as its fallback and is reported once per value (`setUnknownWireValueReporter` routes the report into your telemetry, or silences it).
- `UIMessage.createdAt` is an ISO 8601 string on the wire and in the types; nothing is coerced.

If you read the wire yourself, follow the same rules.

## Errors and request IDs

Every error is the one [error body](/docs/api-reference/overview#error-response): `error`, `code`, `type`, `retryable`, `requestId`, plus `issues` and `retryAfter` when they apply. The `code` set and the `type` set grow; neither shrinks. Every response carries `Request-Id`, and a stream `error` event the platform raises carries the same `requestId`. The SDK surfaces both as `OctavusError`.

## Unsupported clients

A client version the platform no longer serves is answered with `426` (type `unsupported_error`); on a stream, the same arrives as an `error` event with `errorType: 'unsupported_error'`. Treat it as a prompt to update, not as a transient failure.
