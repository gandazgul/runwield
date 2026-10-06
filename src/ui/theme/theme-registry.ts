/**
 * @module ui/theme/theme-registry
 * Small injectable theme registry/controller.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";

export interface ThemeRegistryDeps {
    defaultTheme: Theme;
    setGlobalTheme: (theme: Theme) => void;
    warn?: (message: string) => void;
}

export interface ThemeSelectionResult {
    success: boolean;
    error?: string;
}

export interface ThemeRegistry {
    onChange: (cb: () => void) => () => void;
    setRegisteredThemes: (themes: Theme[]) => void;
    setThemeInstance: (themeInstance: Theme) => void;
    setTheme: (name: string) => ThemeSelectionResult;
    applyPersistedThemeName: (name: string) => ThemeSelectionResult;
    getAvailableThemes: () => string[];
}

export function createThemeRegistry(
    { defaultTheme, setGlobalTheme, warn = console.warn }: ThemeRegistryDeps,
): ThemeRegistry {
    const registeredThemes = new Map<string, Theme>();
    const themeChangeListeners = new Set<() => void>();

    const defaultThemeName = defaultTheme.name;

    function resetToDefaultOnly() {
        registeredThemes.clear();
        if (defaultThemeName) registeredThemes.set(defaultThemeName, defaultTheme);
    }

    resetToDefaultOnly();

    function notifyGlobalTheme(themeInstance: Theme): void {
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

    /** Subscribe to successful theme changes. */
    function onChange(cb: () => void): () => void {
        themeChangeListeners.add(cb);
        return () => themeChangeListeners.delete(cb);
    }

    function setRegisteredThemes(themes: Theme[]): void {
        resetToDefaultOnly();
        for (const theme of themes) {
            if (!theme.name) continue;
            if (theme.name === defaultThemeName) continue;
            registeredThemes.set(theme.name, theme);
        }
    }

    function setThemeInstance(themeInstance: Theme): void {
        notifyGlobalTheme(themeInstance);
    }

    function setTheme(name: string): ThemeSelectionResult {
        const themeInstance = registeredThemes.get(name);
        if (!themeInstance) {
            return { success: false, error: `Theme "${name}" is not registered.` };
        }
        notifyGlobalTheme(themeInstance);
        return { success: true };
    }

    function applyPersistedThemeName(name: string): ThemeSelectionResult {
        const result = setTheme(name);
        if (!result.success) {
            warn(`Persisted theme "${name}" is not available. Keeping current theme.`);
        }
        return result;
    }

    function getAvailableThemes(): string[] {
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
