/** @module ui/workspace/server/owner-connections */

export interface OwnerLiveConnection {
    close(): void;
}

export interface OwnerConnectionRegistry {
    register(deviceId: string, connection: OwnerLiveConnection): () => boolean | undefined;
    closeDevice(deviceId: string): number;
    closeAll(): number;
}

export function createOwnerConnectionRegistry(): OwnerConnectionRegistry {
    const byDevice = new Map<string, Set<OwnerLiveConnection>>();
    return {
        register(deviceId, connection) {
            let connections = byDevice.get(deviceId);
            if (!connections) {
                connections = new Set();
                byDevice.set(deviceId, connections);
            }
            connections.add(connection);
            return () => byDevice.get(deviceId)?.delete(connection);
        },
        closeDevice(deviceId) {
            const connections = [...(byDevice.get(deviceId) || [])];
            byDevice.delete(deviceId);
            for (const connection of connections) connection.close();
            return connections.length;
        },
        closeAll() {
            let count = 0;
            for (const deviceId of [...byDevice.keys()]) count += this.closeDevice(deviceId);
            return count;
        },
    };
}
