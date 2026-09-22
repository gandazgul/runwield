import { FileSessionStoreOwner } from "../file-session-store-owner.ts";
import type { SessionRuntimeComposition } from "./types.ts";

export class RuntimeServices {
    readonly sessionHost;
    readonly sessionStoreOwner;
    readonly ownerProcessKind;
    readonly ownerInstanceId;

    constructor(composition: SessionRuntimeComposition) {
        this.sessionHost = composition.sessionHost;
        this.sessionStoreOwner = new FileSessionStoreOwner(composition.sessionStore, composition.ownsSessionStore);
        this.ownerProcessKind = composition.ownerProcessKind;
        this.ownerInstanceId = composition.ownerInstanceId;
    }

    get sessionStore() {
        return this.sessionStoreOwner.current();
    }
}
