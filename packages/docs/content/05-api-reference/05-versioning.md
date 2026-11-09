---
title: Versioning
description: What the platform may change without notice, what it never changes, and how to read the wire so an update never breaks you.
---

# Versioning

The Octavus API and the SDK packages share one contract: the stream events, the stored `UIMessage` parts, the request and response bodies, and the error body. This page is the rule for how that contract moves.

## The path is the version

Every endpoint lives under `/api/v1`, and the prefix is the only version a request carries: no header negotiates a shape, and every caller of `v1` is served the same wire. Within `v1` the contract only ever grows, as the next section lists. A change that would break a client - a removed or renamed field, a changed meaning - is a new prefix (`/api/v2`), and `v1` keeps being served as it was for as long as it is supported.

## What is additive

The platform adds to the wire without a version change, and a reader must tolerate every one of these:

| Addition             | Example                                                      | What a reader does                                            |
| -------------------- | ------------------------------------------------------------ | ------------------------------------------------------------- |
| A field on an object | `tool-input-start` gains `display`; a part gains `title`     | Keeps it when storing, ignores it when rendering              |
| An event type        | A new lifecycle event on the stream                          | Ignores it, or forwards it unchanged                          |
| A part type          | A new kind of `UIMessage` part                               | Keeps it in `parts`, renders nothing for it                   |
| An enum value        | A new `finishReason`, `errorType`, `display`, or part status | Falls back to a documented default (`other`, `unknown_error`) |
| An error code        | A new `code` in the error body                               | Acts on the `type` and `retryable`, shows the `error` message |

These never need a new path prefix, a new SDK major, or a migration.

## What is not additive

Removing a field, renaming one, changing a field's type or meaning, changing an enum value's meaning, or changing what a display mode reveals is a breaking change. It ships under a new path prefix and an SDK major, and the previous prefix keeps serving the previous shape to the clients that still speak it.

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

## Retired prefixes

Nothing a request carries identifies the SDK or its version: the path prefix is the only thing the platform reads. When a prefix is eventually retired, every request to it is answered with `426` (type `unsupported_error`, not retryable), and on a stream the same arrives as an `error` event with `errorType: 'unsupported_error'`. Treat it as a prompt to move to the current prefix, not as a transient failure. `v1` is the current prefix and keeps being served after a `v2` exists.
