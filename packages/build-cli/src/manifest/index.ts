/**
 * Manifest loaders public entry point.
 *
 * Exposes the default chat-app scaffold manifest (loaded from the embedded
 * `templates/chat-app/**` subtree) and its zero-arg provider thunk.
 */

export {
    CHAT_APP_TEMPLATE_DIR,
    loadChatAppManifest,
    defaultChatAppManifestProvider,
} from './chat-app.js';
