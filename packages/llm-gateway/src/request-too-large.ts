import { readRequestSizeDetail, type RequestSizeDetail } from '@sentropic/llm-mesh';

/** Decimal conversion of the sourced 32 MB Messages/count_tokens gateway policy. */
export const GATEWAY_MAX_REQUEST_BODY_BYTES = 32_000_000;

export const requestTooLargeMessage = (detail?: RequestSizeDetail): string => {
  const safe = readRequestSizeDetail(detail);
  if (!safe) return 'Request size is unavailable; gateway limit is 32000000 bytes and the upstream rejecting limit is unavailable.';
  const { requestBytes: size, limitBytes: limit, sizeIsLowerBound: lower } = safe;
  if (limit !== undefined && size > limit) return lower
    ? `Request size is at least ${size} bytes and exceeds limit ${limit} bytes.`
    : `Request size ${size} bytes exceeds limit ${limit} bytes.`;
  return `${lower ? `Request size is at least ${size} bytes and` : `Request size ${size} bytes`} was rejected as too large upstream; gateway limit is ${GATEWAY_MAX_REQUEST_BODY_BYTES} bytes and the upstream rejecting limit is unavailable.`;
};
