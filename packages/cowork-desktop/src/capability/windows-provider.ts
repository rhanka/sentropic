import {
    CapabilityUnavailableError,
    type CaptureOptions,
    type DesktopCapabilityProvider,
    type MouseButton,
    type ScreenCapture,
} from './types.js';
import { assertLiteralText } from '../tools/literal-text.js';

/**
 * Real Windows capability provider. The native modules are loaded via dynamic
 * `import()` ONLY inside the methods, so this file imports cleanly on Linux/CI
 * (where the optionalDependencies are not installed). A missing module surfaces
 * as a {@link CapabilityUnavailableError}, never a hard crash.
 *
 * Capture: `screenshot-desktop` (returns a PNG/JPEG Buffer).
 * Input:   `@nut-tree-fork/nut-js` (mouse/keyboard via the OS automation API).
 *
 * Real eyes/hands behavior is verified on Windows at UAT (BR-41a Lot N-2); on
 * any non-Windows host the native libs are simply absent.
 */

type ScreenshotModule = {
    default?: (opts?: { format?: string; screen?: number }) => Promise<Buffer>;
    (opts?: { format?: string; screen?: number }): Promise<Buffer>;
};

const pngDimensions = (buffer: Buffer): { width: number; height: number } => {
    if (buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG' || buffer.toString('ascii', 12, 16) !== 'IHDR') {
        throw new CapabilityUnavailableError('screen_capture', 'native capture did not return a PNG image.');
    }
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    if (width < 1 || height < 1) throw new CapabilityUnavailableError('screen_capture', 'native capture returned invalid dimensions.');
    return { width, height };
};

// The nut-js surface we actually use, declared structurally so we never need the
// package's types at build time on Linux.
type NutModule = {
    mouse: {
        setPosition(point: { x: number; y: number }): Promise<unknown>;
    };
    Point: new (x: number, y: number) => { x: number; y: number };
    Button: Record<string, unknown>;
    keyboard: {
        type(text: string): Promise<unknown>;
        pressKey(...keys: unknown[]): Promise<unknown>;
        releaseKey(...keys: unknown[]): Promise<unknown>;
    };
    Key: Record<string, unknown>;
    straightTo?: unknown;
    leftClick?: () => Promise<unknown>;
};

/** Resolve a `+`-separated combo (e.g. "Ctrl+Shift+S") to nut.js Key constants. */
const resolveKeyCombo = (combo: string, Key: Record<string, unknown>): unknown[] => {
    const aliases: Record<string, string> = {
        ctrl: 'LeftControl',
        control: 'LeftControl',
        cmd: 'LeftSuper',
        command: 'LeftSuper',
        win: 'LeftSuper',
        meta: 'LeftSuper',
        super: 'LeftSuper',
        alt: 'LeftAlt',
        option: 'LeftAlt',
        shift: 'LeftShift',
        esc: 'Escape',
        return: 'Enter',
        del: 'Delete',
    };
    const tokens = combo
        .split('+')
        .map((t) => t.trim())
        .filter(Boolean);
    return tokens.map((token) => {
        const lower = token.toLowerCase();
        const nutName = aliases[lower] ?? token.charAt(0).toUpperCase() + token.slice(1);
        const resolved = Key[nutName];
        if (resolved === undefined) {
            throw new CapabilityUnavailableError('input_action.key', `unknown key "${token}"`);
        }
        return resolved;
    });
};

export interface WindowsProviderOptions {
    /**
     * Maps a bare native specifier to its import target. Default: identity (bare
     * name, resolved from `node_modules`). The single-file exe injects a resolver
     * that returns an absolute `file://` URL under the extracted native cache.
     */
    resolveNativeModule?: (bareSpecifier: string) => string;
}

export const createWindowsCapabilityProvider = (
    options: WindowsProviderOptions = {},
): DesktopCapabilityProvider => {
    const resolveNative = options.resolveNativeModule ?? ((name: string) => name);

    const loadOptional = async <T>(moduleName: string, capability: string): Promise<T> => {
        try {
            return (await import(resolveNative(moduleName))) as T;
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            throw new CapabilityUnavailableError(
                capability,
                `native module "${moduleName}" could not be loaded (Windows-only). ${detail}`,
            );
        }
    };

    return {
        name: 'windows',

        async captureScreen(options?: CaptureOptions): Promise<ScreenCapture> {
            if (options?.screen !== undefined && options.screen !== 0 || options?.region) {
                throw new CapabilityUnavailableError('screen_capture', 'only the default full primary display is available in this MVP.');
            }
            const mod = await loadOptional<ScreenshotModule>(
                'screenshot-desktop',
                'screen_capture',
            );
            const screenshot = (mod.default ?? mod) as ScreenshotModule;
            const buffer = await screenshot({ format: 'png', screen: options?.screen });
            const { width, height } = pngDimensions(buffer);
            return {
                base64: Buffer.from(buffer).toString('base64'),
                mimeType: 'image/png',
                width,
                height,
            };
        },

        async mouseClick(x: number, y: number, button: MouseButton = 'left'): Promise<void> {
            const nut = await loadOptional<NutModule>('@nut-tree-fork/nut-js', 'input_action');
            await nut.mouse.setPosition(new nut.Point(x, y));
            const buttonName = button === 'left' ? 'LEFT' : button === 'right' ? 'RIGHT' : 'MIDDLE';
            const nutButton = nut.Button[buttonName];
            // nut.js exposes click helpers off the default export in some builds;
            // fall back to press/release semantics through the mouse facade.
            const mouseFacade = nut.mouse as unknown as {
                click?: (b: unknown) => Promise<unknown>;
            };
            if (typeof mouseFacade.click === 'function') {
                await mouseFacade.click(nutButton);
            } else if (typeof nut.leftClick === 'function' && button === 'left') {
                await nut.leftClick();
            } else {
                throw new CapabilityUnavailableError(
                    'input_action.click',
                    'no click primitive on the loaded native input module',
                );
            }
        },

        async type(text: string): Promise<void> {
            assertLiteralText(text);
            const nut = await loadOptional<NutModule>('@nut-tree-fork/nut-js', 'input_action');
            // This is the only literal-text primitive. Do not add clipboard,
            // IME, pressKey, or key-combo fallbacks: those turn text into
            // submission/navigation controls on a kiosk surface.
            await nut.keyboard.type(text);
        },

        async scroll(dx: number, dy: number): Promise<void> {
            const nut = await loadOptional<NutModule>('@nut-tree-fork/nut-js', 'input_action');
            const mouseFacade = nut.mouse as unknown as {
                scrollDown?: (n: number) => Promise<unknown>;
                scrollUp?: (n: number) => Promise<unknown>;
                scrollLeft?: (n: number) => Promise<unknown>;
                scrollRight?: (n: number) => Promise<unknown>;
            };
            if (dy > 0 && mouseFacade.scrollDown) await mouseFacade.scrollDown(dy);
            else if (dy < 0 && mouseFacade.scrollUp) await mouseFacade.scrollUp(-dy);
            if (dx > 0 && mouseFacade.scrollRight) await mouseFacade.scrollRight(dx);
            else if (dx < 0 && mouseFacade.scrollLeft) await mouseFacade.scrollLeft(-dx);
        },

        async key(combo: string): Promise<void> {
            const nut = await loadOptional<NutModule>('@nut-tree-fork/nut-js', 'input_action');
            const keys = resolveKeyCombo(combo, nut.Key);
            await nut.keyboard.pressKey(...keys);
            await nut.keyboard.releaseKey(...keys.slice().reverse());
        },
    };
};
