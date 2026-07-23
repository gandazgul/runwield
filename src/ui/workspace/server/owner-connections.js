/** @module ui/workspace/server/owner-connections */

/**
 * @typedef {Object} OwnerLiveConnection
 * @property {() => void} close
 */

export function createOwnerConnectionRegistry() {
    /** @type {Map<string, Set<OwnerLiveConnection>>} */
    const byDevice = new Map();
    return {
        /** @param {string} deviceId @param {OwnerLiveConnection} connection */
        register(deviceId, connection) {
            let connections = byDevice.get(deviceId);
            if (!connections) {
                connections = new Set();
                byDevice.set(deviceId, connections);
            }
            connections.add(connection);
            return () => byDevice.get(deviceId)?.delete(connection);
        },
        /** @param {string} deviceId */
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
