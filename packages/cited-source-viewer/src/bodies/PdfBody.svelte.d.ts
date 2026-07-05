import type { Component } from "svelte";
import type { CitedSourceBodyProps, PdfSourcePayload } from "../types.js";

/** v1 PDF text-layer body renderer (payload kind: "pdf"). */
declare const PdfBody: Component<CitedSourceBodyProps<PdfSourcePayload>>;
export default PdfBody;
