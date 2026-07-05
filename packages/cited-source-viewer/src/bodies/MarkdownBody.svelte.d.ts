import type { Component } from "svelte";
import type { CitedSourceBodyProps, TextSourcePayload } from "../types.js";

/** v1 markdown / plain-text body renderer (payload kinds: "markdown", "text"). */
declare const MarkdownBody: Component<CitedSourceBodyProps<TextSourcePayload>>;
export default MarkdownBody;
