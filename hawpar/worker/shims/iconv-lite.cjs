/**
 * Minimal `iconv-lite` replacement for the Cloudflare Workers bundle.
 *
 * The real package fails to bundle for the edge runtime because it lazily wires
 * itself into `node:stream` at require time. Express only needs it to decode
 * request bodies, and the Workers runtime already ships a full WHATWG
 * `TextDecoder`, so we map the handful of used entry points onto that instead.
 *
 * Surface required by body-parser and raw-body:
 *   encodingExists(encoding) · decode(buffer, encoding) · getDecoder(encoding)
 */
'use strict';

function normalise(encoding) {
  return String(encoding || 'utf-8')
    .toLowerCase()
    .replace(/^latin1$/, 'iso-8859-1')
    .replace(/^utf8$/, 'utf-8');
}

function createDecoder(encoding) {
  try {
    return new TextDecoder(normalise(encoding), { fatal: false });
  } catch {
    throw new Error(`Encoding not recognized: '${encoding}' (searched as: '${normalise(encoding)}')`);
  }
}

exports.encodingExists = function encodingExists(encoding) {
  try {
    createDecoder(encoding);
    return true;
  } catch {
    return false;
  }
};

exports.decode = function decode(buffer, encoding) {
  return createDecoder(encoding).decode(buffer);
};

exports.encode = function encode(content, encoding) {
  const label = normalise(encoding);
  if (label !== 'utf-8') {
    throw new Error(`Encoding not supported for encoding: '${encoding}'`);
  }
  return Buffer.from(new TextEncoder().encode(String(content)));
};

/** Streaming decoder used by raw-body; `stream: true` keeps multi-byte chars intact. */
exports.getDecoder = function getDecoder(encoding) {
  const decoder = createDecoder(encoding);
  return {
    write(chunk) {
      return decoder.decode(chunk, { stream: true });
    },
    end() {
      return decoder.decode();
    }
  };
};

exports.supportsStreams = false;
