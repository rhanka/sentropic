/**
 * Canonical box/circle geometry contracts (SPEC §4.3).
 *
 * Coordinates are exact base-ten decimal strings quantized to integer
 * millionths (scale S = 1,000,000), decoded as v = q / S. Boxes use normalized
 * x/W, y/H, width/W, height/H. Circles use normalized center cx/W, cy/H and
 * radius r / min(W, H). All checks use exact rational/integer arithmetic and
 * round ties upward; PG never rounds independently and browser helpers call
 * this same conversion.
 */

/** Immutable capture frame: positive integral intrinsic pixel dimensions. */
export type GeometryFrame = {
  readonly width: number;
  readonly height: number;
  /** Digest binding the frame/capture bytes the shape references. */
  readonly digest: string;
  /** Versioned crop transform; dimensions and positions are intrinsic integers. */
  readonly crop?:
    | {
        readonly version: string;
        readonly originX: number;
        readonly originY: number;
      }
    | undefined;
};

/** Normalized box as decimal strings: x, y, width, height. */
export type BoxGeometryInput = {
  readonly kind: 'box';
  readonly x: string;
  readonly y: string;
  readonly width: string;
  readonly height: string;
};

/** Normalized circle as decimal strings: cx, cy, r (r against min(W, H)). */
export type CircleGeometryInput = {
  readonly kind: 'circle';
  readonly cx: string;
  readonly cy: string;
  readonly r: string;
};

export type GeometryInput = BoxGeometryInput | CircleGeometryInput;

/** Canonical quantized box in millionths. */
export type QuantizedBox = {
  readonly kind: 'box';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/** Canonical quantized circle in millionths. */
export type QuantizedCircle = {
  readonly kind: 'circle';
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
};

export type QuantizedGeometry = QuantizedBox | QuantizedCircle;

/** Geometry validation error with a closed reason code. */
export class GeometryValidationError extends Error {
  constructor(
    public readonly code:
      | 'invalid-decimal'
      | 'invalid-frame'
      | 'out-of-frame'
      | 'collapsed-size'
      | 'circle-overflow'
      | 'unknown-shape',
    message: string,
  ) {
    super(message);
    this.name = 'GeometryValidationError';
  }
}

/** Quantization scale: integer millionths. */
export const GEOMETRY_SCALE = 1_000_000;

/**
 * Exact decimal-string grammar: optional leading '-', non-empty digit run,
 * optional fraction of at least one digit. Whitespace, exponents, leading
 * plus and other ambiguities are rejected; negative zero is only zero.
 */
const DECIMAL_PATTERN = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/;

/** Exact rational n/d parsed from a decimal string; sign folded into n. */
type Rational = { readonly n: bigint; readonly d: bigint };

const parseDecimal = (input: string): Rational => {
  if (typeof input !== 'string' || !DECIMAL_PATTERN.test(input)) {
    throw new GeometryValidationError('invalid-decimal', `Invalid decimal string: ${JSON.stringify(input)}`);
  }
  const negative = input.startsWith('-');
  const unsigned = negative ? input.slice(1) : input;
  const [integerPart, fractionPart = ''] = unsigned.split('.');
  const n = BigInt(integerPart + fractionPart) * (negative ? -1n : 1n);
  const d = 10n ** BigInt(fractionPart.length);
  return { n, d };
};

/** Round the exact rational n/d to integer millionths, ties upward (+infinity). */
const quantizeRational = (rational: Rational): number => {
  const n = rational.n * BigInt(GEOMETRY_SCALE);
  const d = rational.d * 2n;
  const t = n * 2n + rational.d;
  // BigInt division truncates toward zero; adjust for floor semantics.
  let q = t / d;
  if (t < 0n && t % d !== 0n) q -= 1n;
  const quantized = Number(q);
  if (!Number.isSafeInteger(quantized)) {
    throw new GeometryValidationError('invalid-decimal', 'Decimal value exceeds the safe integer range');
  }
  return quantized === 0 ? 0 : quantized;
};

/**
 * Quantize a base-ten decimal string to integer millionths with exact rational
 * arithmetic, rounding ties upward. "0.1234565" becomes 123457 and negative
 * zero becomes zero.
 */
export const quantizeMillionths = (input: string): number => quantizeRational(parseDecimal(input));

/** Exact rational sum of two decimal strings (used for box end edges). */
const addDecimals = (a: string, b: string): Rational => {
  const left = parseDecimal(a);
  const right = parseDecimal(b);
  return { n: left.n * right.d + right.n * left.d, d: left.d * right.d };
};

const validateFrame = (frame: GeometryFrame): void => {
  if (
    typeof frame !== 'object' ||
    frame === null ||
    !Number.isSafeInteger(frame.width) ||
    !Number.isSafeInteger(frame.height) ||
    frame.width <= 0 ||
    frame.height <= 0 ||
    typeof frame.digest !== 'string' ||
    frame.digest.length === 0
  ) {
    throw new GeometryValidationError('invalid-frame', 'Frame requires positive integral dimensions and a digest');
  }
  if (frame.crop !== undefined) {
    const { version, originX, originY } = frame.crop;
    if (
      typeof version !== 'string' ||
      version.length === 0 ||
      !Number.isSafeInteger(originX) ||
      !Number.isSafeInteger(originY) ||
      originX < 0 ||
      originY < 0
    ) {
      throw new GeometryValidationError('invalid-frame', 'Invalid crop transform');
    }
  }
};

