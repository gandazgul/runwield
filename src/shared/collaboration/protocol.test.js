import { assertEquals, assertThrows } from "@std/assert";
import {
    normalizeApiErrorPayload,
    normalizeCapabilityRecord,
    normalizeCommentStateChangePayload,
    normalizeEncryptedCommentRecord,
    normalizeEncryptedPlanPayload,
    normalizeLocalSecretRecord,
    normalizeRevisionMetadata,
    normalizeSharedSpaceLifecyclePayload,
    normalizeSharedSpaceMetadata,
} from "./protocol.js";

Deno.test("protocol helpers normalize shared space metadata", () => {
    assertEquals(
        normalizeSharedSpaceMetadata({
            spaceId: "space-1",
            planId: "plan-1",
            createdAt: "now",
            updatedAt: "later",
            latestRevision: 1,
        }).spaceId,
        "space-1",
    );
});

Deno.test("protocol helpers normalize revision metadata and reject invalid revisions", () => {
    assertEquals(
        normalizeRevisionMetadata({
            spaceId: "space-1",
            revision: 2,
            createdAt: "now",
            payloadCiphertext: "ciphertext",
        }).revision,
        2,
    );
    assertThrows(() =>
        normalizeRevisionMetadata({ spaceId: "space-1", revision: 0, createdAt: "now", payloadCiphertext: "x" })
    );
});

Deno.test("protocol helpers normalize capability, encrypted plan, encrypted comment, and local secret records", () => {
    assertEquals(normalizeCapabilityRecord({ scope: "maintainer", capabilityHash: "sha256:abc" }), {
        scope: "maintainer",
        capabilityHash: "sha256:abc",
    });
    assertEquals(
        normalizeEncryptedPlanPayload({ planId: " plan-1 ", title: " Draft ", body: " encrypted-body " }),
        {
            planId: "plan-1",
            title: "Draft",
            body: "encrypted-body",
        },
    );
    assertEquals(
        normalizeEncryptedCommentRecord({
            id: "comment-1",
            spaceId: "space-1",
            ciphertext: "ciphertext",
            createdAt: "now",
            resolved: false,
        }),
        {
            id: "comment-1",
            spaceId: "space-1",
            ciphertext: "ciphertext",
            createdAt: "now",
            resolved: false,
        },
    );
    assertEquals(normalizeLocalSecretRecord({ planId: "plan", contentKey: "key", updatedAt: "now" }), {
        planId: "plan",
        contentKey: "key",
        updatedAt: "now",
    });
});

Deno.test("protocol helpers normalize comment, lifecycle, and API error payloads", () => {
    assertEquals(normalizeCommentStateChangePayload({ commentId: "comment-1", action: "resolve" }), {
        commentId: "comment-1",
        action: "resolve",
    });
    assertEquals(normalizeSharedSpaceLifecyclePayload({ spaceId: "space-1", action: "close" }), {
        spaceId: "space-1",
        action: "close",
    });
    assertEquals(normalizeApiErrorPayload({ error: "forbidden", message: "Denied", status: 403 }), {
        error: "forbidden",
        message: "Denied",
        status: 403,
    });
});

Deno.test("protocol helpers reject invalid records", () => {
    assertThrows(() => normalizeSharedSpaceMetadata(null));
    assertThrows(() => normalizeCapabilityRecord({ scope: "owner", capabilityHash: "x" }));
    assertThrows(() => normalizeEncryptedPlanPayload({ planId: "plan", title: "Draft", body: "" }));
    assertThrows(() =>
        normalizeEncryptedCommentRecord({ id: "comment", spaceId: "space", ciphertext: "x", createdAt: "now" })
    );
    assertThrows(() => normalizeLocalSecretRecord({ planId: "plan" }));
});
