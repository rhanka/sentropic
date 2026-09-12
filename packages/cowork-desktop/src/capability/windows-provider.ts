import {
    CapabilityUnavailableError,
    type CaptureOptions,
    type DesktopCapabilityProvider,
    type MouseButton,
    type NativeActuationGuard,
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

/**
 * Native libraries do not expose a common cancellation API. Never race them: a
 * race could report PAS-FAIT while their OS side effect continues. Instead wait
 * for the in-flight native promise to settle, then observe the lease signal
 * before allowing any further actuation or terminal result.
 */
const awaitNativeQuiescence = async <T>(guard: NativeActuationGuard, operation: () => Promise<T>): Promise<T> => {
    guard.throwIfAborted();
    const result = await operation();
    await guard.recheckAfterNativeAwait();
    guard.throwIfAborted();
    return result;
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

        async captureScreen(options: CaptureOptions | undefined, guard: NativeActuationGuard): Promise<ScreenCapture> {
            if (options?.screen !== undefined && options.screen !== 0 || options?.region) {
                throw new CapabilityUnavailableError('screen_capture', 'only the default full primary display is available in this MVP.');
            }
            const mod = await loadOptional<ScreenshotModule>(
                'screenshot-desktop',
                'screen_capture',
            );
            await guard.recheckAfterNativeAwait();
            const screenshot = (mod.default ?? mod) as ScreenshotModule;
            const buffer = await awaitNativeQuiescence(guard, () => screenshot({ format: 'png', screen: options?.screen }));
            const { width, height } = pngDimensions(buffer);
            return {
                base64: Buffer.from(buffer).toString('base64'),
                mimeType: 'image/png',
                width,
                height,
            };
        },

        async mouseClick(x: number, y: number, button: MouseButton | undefined, guard: NativeActuationGuard): Promise<void> {
            await guard.recheckAfterNativeAwait();
            const selectedButton = button ?? 'left';
            if (!guard.assertClickInBounds || !guard.targetedInput) {
                throw new CapabilityUnavailableError(
                    'input_action.click',
                    'the measured HWND-targeted click primitive is unavailable.',
                );
            }
            guard.assertClickInBounds(x, y);
            await awaitNativeQuiescence(guard, () => guard.targetedInput!({ kind: 'click', x, y, button: selectedButton }));
        },

        async type(text: string, guard: NativeActuationGuard): Promise<void> {
            assertLiteralText(text);
            await guard.recheckAfterNativeAwait();
            if (!guard.targetedInput) {
                throw new CapabilityUnavailableError(
                    'input_action.type',
                    'the measured HWND-targeted type primitive is unavailable.',
                );
            }
            // Chunk literal text so each chunk runs in bounded wall-clock time (<= 250ms)
            // and cancellation is observed promptly between chunks.
            const CHUNK_SIZE = 10;
            for (let i = 0; i < text.length; i += CHUNK_SIZE) {
                guard.throwIfAborted();
                const chunk = text.slice(i, i + CHUNK_SIZE);
                await awaitNativeQuiescence(guard, () => guard.targetedInput!({ kind: 'type', text: chunk }));
                guard.throwIfAborted();
            }
        },

        async scroll(dx: number, dy: number, guard: NativeActuationGuard): Promise<void> {
            await guard.recheckAfterNativeAwait();
            if (!guard.targetedInput) {
                throw new CapabilityUnavailableError(
                    'input_action.scroll',
                    'the measured HWND-targeted scroll primitive is unavailable.',
                );
            }
            const MAX_STEP = 5;
            let remX = dx;
            let remY = dy;
            while (remX !== 0 || remY !== 0) {
                guard.throwIfAborted();
                const stepX = Math.sign(remX) * Math.min(Math.abs(remX), MAX_STEP);
                const stepY = Math.sign(remY) * Math.min(Math.abs(remY), MAX_STEP);
                remX -= stepX;
                remY -= stepY;
                await awaitNativeQuiescence(guard, () => guard.targetedInput!({ kind: 'scroll', dx: stepX, dy: stepY }));
                guard.throwIfAborted();
            }
        },
    };
};
