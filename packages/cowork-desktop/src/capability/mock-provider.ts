import type {
    CaptureOptions,
    DesktopCapabilityProvider,
    MouseButton,
    ScreenCapture,
} from './types.js';

/** A single recorded capability invocation, for test assertions. */
export type MockProviderCall =
    | { kind: 'captureScreen'; options?: CaptureOptions }
    | { kind: 'mouseClick'; x: number; y: number; button: MouseButton }
    | { kind: 'type'; text: string }
    | { kind: 'scroll'; dx: number; dy: number }
    | { kind: 'key'; combo: string };

export interface MockCapabilityProvider extends DesktopCapabilityProvider {
    /** Ordered log of every capability call, for assertions. */
    readonly calls: MockProviderCall[];
}

export interface MockProviderOptions {
    /** Fixed capture payload returned by `captureScreen`. */
    capture?: Partial<ScreenCapture>;
}

const DEFAULT_CAPTURE: ScreenCapture = {
    // 1x1 transparent PNG.
    base64:
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    mimeType: 'image/png',
    width: 1,
    height: 1,
};

/**
 * Headless, display-free capability provider used by all unit tests. It records
 * every call and returns deterministic results — it never touches a native
 * library or a real screen/input device.
 */
export const createMockCapabilityProvider = (
    options?: MockProviderOptions,
): MockCapabilityProvider => {
    const calls: MockProviderCall[] = [];
    const capture: ScreenCapture = { ...DEFAULT_CAPTURE, ...options?.capture };

    return {
        name: 'mock',
        calls,
        async captureScreen(captureOptions?: CaptureOptions): Promise<ScreenCapture> {
            calls.push({ kind: 'captureScreen', options: captureOptions });
            return { ...capture };
        },
        async mouseClick(x: number, y: number, button: MouseButton = 'left'): Promise<void> {
            calls.push({ kind: 'mouseClick', x, y, button });
        },
        async type(text: string): Promise<void> {
            calls.push({ kind: 'type', text });
        },
        async scroll(dx: number, dy: number): Promise<void> {
            calls.push({ kind: 'scroll', dx, dy });
        },
        async key(combo: string): Promise<void> {
            calls.push({ kind: 'key', combo });
        },
    };
};
