/**
 * Desktop capability seam — the boundary between the desktop tool executors
 * (eyes + hands) and the platform-specific native implementations.
 *
 * The real eyes/hands only run on Windows (native screen capture + SendInput),
 * but dev/CI is Linux/Docker and headless. Every executor therefore depends on
 * this interface, NOT on the native libraries directly:
 *  - the real Windows provider (`createWindowsCapabilityProvider`) lazy-loads
 *    native libs via dynamic import (declared as optionalDependencies);
 *  - a mock provider (`createMockCapabilityProvider`) backs all unit tests with
 *    no native libs and no display.
 */

/** A captured screen image, returned by {@link DesktopCapabilityProvider.captureScreen}. */
export interface ScreenCapture {
    /** Base64-encoded image bytes (no data-URI prefix). */
    base64: string;
    /** Image MIME type, e.g. `image/png`. */
    mimeType: string;
    /** Captured pixel width. */
    width: number;
    /** Captured pixel height. */
    height: number;
}

export type TargetedNativeInput = {
    kind: 'click';
    x: number;
    y: number;
    button: MouseButton;
};

export interface NativeActuationGuard {
    recheckAfterNativeAwait(): Promise<void>;
    /** Fails closed when an absolute click falls outside the measured HWND client area. */
    assertClickInBounds?(x: number, y: number): void;
    /** Windows-only HWND-targeted guard-and-act primitive; absent support denies real clicks. */
    targetedInput?(input: TargetedNativeInput): Promise<void>;
}

/** A rectangular capture region in screen pixels. */
export interface CaptureRegion {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** Options for a screen capture. */
export interface CaptureOptions {
    /** Target display index (0-based). Defaults to the primary display. */
    screen?: number;
    /** Optional sub-region to crop. When omitted, the whole screen is returned. */
    region?: CaptureRegion;
}

/** Mouse buttons supported by {@link DesktopCapabilityProvider.mouseClick}. */
export type MouseButton = 'left' | 'right' | 'middle';

/**
 * Platform capability provider for desktop eyes (capture) and hands
 * (mouse/keyboard). Implementations must be safe to construct on any platform;
 * native loading happens lazily inside the methods so that simply importing the
 * module never requires a display or a native binary.
 */
export interface DesktopCapabilityProvider {
    /** Human-readable provider name, surfaced in errors and diagnostics. */
    readonly name: string;

    /** Capture a screen (or region) and return a base64 image. */
    captureScreen(options: CaptureOptions | undefined, guard: NativeActuationGuard): Promise<ScreenCapture>;

    /** Click at absolute screen coordinates with the given button (default left). */
    mouseClick(x: number, y: number, button: MouseButton | undefined, guard: NativeActuationGuard): Promise<void>;

    /** Type a literal text string at the current focus. */
    type(text: string, guard: NativeActuationGuard): Promise<void>;

    /** Scroll by a relative delta (positive dy = down, positive dx = right). */
    scroll(dx: number, dy: number, guard: NativeActuationGuard): Promise<void>;

    /**
     * Press a key combination, e.g. `"Ctrl+C"`, `"Enter"`, `"Alt+Tab"`.
     * Modifiers and the final key are `+`-separated.
     */
    key(combo: string, guard: NativeActuationGuard): Promise<void>;
}

/**
 * Raised when a capability is requested on a platform/build that cannot provide
 * it (e.g. the native screen-capture lib is missing on Linux/CI). Surfaced back
 * to the model as a structured tool error rather than crashing the runner.
 */
export class CapabilityUnavailableError extends Error {
    readonly capability: string;

    constructor(capability: string, detail: string) {
        super(`Desktop capability "${capability}" is unavailable: ${detail}`);
        this.name = 'CapabilityUnavailableError';
        this.capability = capability;
    }
}
