/**
 * @module ui/theme/theme-registry
 * Small injectable theme registry/controller.
 */

/** @typedef {import('@earendil-works/pi-coding-agent').Theme} ThemeInstance */

/**
 * @param {{ defaultTheme: ThemeInstance, setGlobalTheme: (theme: ThemeInstance) => void, warn?: (message: string) => void }} deps
 */
export function createThemeRegistry({ defaultTheme, setGlobalTheme, warn = console.warn }) {
    /** @type {Map<string, ThemeInstance>} */
    const registeredThemes = new Map();
    /** @type {Set<() => void>} */
    const themeChangeListeners = new Set();

    const defaultThemeName = defaultTheme.name;

    function resetToDefaultOnly() {
        registeredThemes.clear();
        if (defaultThemeName) registeredThemes.set(defaultThemeName, defaultTheme);
    }

    resetToDefaultOnly();

    /** @param {ThemeInstance} themeInstance */
    function notifyGlobalTheme(themeInstance) {
        setGlobalTheme(themeInstance);
        for (const cb of themeChangeListeners) {
            try {
                cb();
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                warn(`Theme change listener threw: ${msg}`);
            }
        }
    }

    /**
     * Subscribe to successful theme changes.
     * @param {() => void} cb
     * @returns {() => void}
     */
    function onChange(cb) {
        themeChangeListeners.add(cb);
        return () => themeChangeListeners.delete(cb);
    }

    /** @param {ThemeInstance[]} themes */
    function setRegisteredThemes(themes) {
        resetToDefaultOnly();
        for (const theme of themes) {
            if (!theme.name) continue;
            if (theme.name === defaultThemeName) continue;
            registeredThemes.set(theme.name, theme);
        }
    }

    /** @param {ThemeInstance} themeInstance */
    function setThemeInstance(themeInstance) {
        notifyGlobalTheme(themeInstance);
    }

    /**
     * @param {string} name
     * @returns {{ success: boolean, error?: string }}
     */
    function setTheme(name) {
        const themeInstance = registeredThemes.get(name);
        if (!themeInstance) {
            return { success: false, error: `Theme "${name}" is not registered.` };
        }
        notifyGlobalTheme(themeInstance);
        return { success: true };
    }

    /**
     * @param {string} name
     * @returns {{ success: boolean, error?: string }}
     */
    function applyPersistedThemeName(name) {
        const result = setTheme(name);
        if (!result.success) {
            warn(`Persisted theme "${name}" is not available. Keeping current theme.`);
        }
        return result;
    }

    /** @returns {string[]} */
    function getAvailableThemes() {
        return Array.from(registeredThemes.keys()).sort();
    }

    return {
        onChange,
        setRegisteredThemes,
        setThemeInstance,
        setTheme,
        applyPersistedThemeName,
        getAvailableThemes,
    };
}
