import type { ToolExecutionContext } from '@sentropic/cowork-bridge/tools';
import type { DesktopCapabilityProvider } from '../capability/index.js';

/**
 * Desktop tool execution context. Extends the portable bridge base with the
 * platform capability provider that backs eyes/hands. Tests inject the mock
 * provider; the real runner injects the Windows provider.
 */
export interface DesktopToolContext extends ToolExecutionContext {
    provider: DesktopCapabilityProvider;
}

/** Tool name constants — mirror the `localToolDefinitions` advertised to the model. */
export const SCREEN_CAPTURE_TOOL = 'screen_capture';
export const INPUT_ACTION_TOOL = 'input_action';
