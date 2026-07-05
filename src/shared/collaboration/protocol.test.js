import { assertEquals, assertThrows } from "@std/assert";
import {
    normalizeApiErrorPayload,
    normalizeAppendCommentPayload,
    normalizeAppendRevisionPayload,
    normalizeCapabilityRecord,
    normalizeCommentStateChangePayload,
    normalizeCreateSharedSpacePayload,
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
        normalizeEncryptedPlanPayload({
            planId: " plan-1 ",
            title: " Draft ",
            metadata: { status: "approved", order: 4 },
            body: " encrypted-body ",
        }),
        {
            planId: "plan-1",
            title: "Draft",
            metadata: { status: "approved", order: 4 },
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

Deno.test("protocol helpers normalize remote API payloads and reject plaintext fields", () => {
    assertEquals(
        normalizeCreateSharedSpacePayload({
            planId: "plan-1",
            initialRevision: { payloadCiphertext: "cipher-plan" },
            capabilities: [
                { scope: "reviewer", capabilityHash: "sha256:reviewer" },
                { scope: "maintainer", capabilityHash: "sha256:maintainer" },
            ],
        }).initialRevision.payloadCiphertext,
        "cipher-plan",
    );
    assertEquals(normalizeAppendRevisionPayload({ payloadCiphertext: "cipher-rev", expectedRevision: 2 }), {
        payloadCiphertext: "cipher-rev",
        expectedRevision: 2,
    });
    assertEquals(normalizeAppendCommentPayload({ ciphertext: "cipher-comment" }), { ciphertext: "cipher-comment" });
    assertThrows(() =>
        normalizeCreateSharedSpacePayload({
            planId: "plan-1",
            body: "plaintext",
            initialRevision: { payloadCiphertext: "cipher-plan" },
            capabilities: [{ scope: "reviewer", capabilityHash: "sha256:reviewer" }],
        })
    );
    assertThrows(() => normalizeAppendCommentPayload({ ciphertext: "cipher-comment", authorName: "Alice" }));
});
