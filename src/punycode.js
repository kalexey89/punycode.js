
/**
 * @file punycode.js
 * @author Kuznetsov Aleksey <kyznecov.alexey@gmail.com>
 */

/**
 * Contains methods to work with Punycode strings.
 *
 * @namespace punycode
 */
(function (name, scope, factory) {

  // CommonJS
  if (typeof module === 'object' && module.exports)
      module.exports = factory();
  // AMD
  else if (typeof define === 'function' && define.amd)
      define(name, () => factory());
  // Global
  else (typeof root === 'object')
      scope[name] = factory();

}('punycode', this || window, function() {

  // Highest positive signed 32-bit float value
  const MAX_INTEGER = 2147483647; // 0x7FFFFFFF or 2^31-1

  // Punycode bootstring parameters
  const BASE = 36;
  const TMIN = 1;
  const TMAX = 26;
  const SKEW = 38;
  const DAMP = 700;
  const INITIAL_BIAS = 72;
  const INITIAL_N = 128; // 0x80

  // Punycode delimiter
  const DELIMITER_CHAR = '-'; // Delimiter as char
  const DELIMITER_CODE = 0x2D; // Delimiter as char code

  /**
   * Contains methods to convert from JS internal character
   * representation (UCS-2) to Unicode code points, and back.
   *
   * @namespace punycode.ucs2
   * @memberof punycode
   * @private
   */
  var ucs2;
  (function (ucs2) {

    /**
     * Creates an array containing the numeric code points of each Unicode
     * character in the string. While JavaScript uses UCS-2 internally,
     * this function will convert a pair of surrogate halves (each of which
     * UCS-2 exposes as separate characters) into a single code point,
     * matching UTF-16.
     *
     * @memberof punycode.ucs2
     * @param {string} input The Unicode input string (UCS-2)
     * @return {array} The new array of code points
     */
    const decode = (input) => {
      if (typeof input !== 'string')
        throw new TypeError('\"input\" must be a string');

      if (!input)
        return [];

      const output = [];
      for (let i = 0, length = input.length; i < length; ++i) {
        let code = input.charCodeAt(i);
        let hi = NaN;
        let low = NaN;
        // High surrogate
        if (code >= 0xD800 && code <= 0xDBFF) {
          hi = code;
          low = input.charCodeAt(++i);
          if (isNaN(low))
            throw new Error('high surrogate not followed by low surrogate');

          output.push(((hi - 0xD800) * 0x400) + (low - 0xDC00) + 0x10000);
        }
        // Low surrogate
        else if (code >= 0xDC00 && code <= 0xDFFF) {
          continue;
        }
        // Not surrogate
        else {
          output.push(code);
        }
      }

      return output;
    }

    /**
     * Creates a string based on an array of numeric code points.
     *
     * @memberof punycode.ucs2
     * @param {array} input The array of numeric code points
     * @return {string} The new Unicode string (UCS-2)
     */
    const encode = (input) => String.fromCodePoint(...input);

    ucs2.decode = decode;
    ucs2.encode = encode;

  }(ucs2 || (ucs2 = {})));

  /**
   * Bias adaptation function as per [section 3.4]{@link https://tools.ietf.org/html/rfc3492#section-3.4} of RFC 3492.
   *
   * @memberof punycode
   * @private
   * @param {number} delta
   * @param {number} numPoints
   * @param {boolean} firstTime
   * @return {number}
   */
  const adapt = (delta, numPoints, firstTime) => {
    const x = ~~(((BASE - TMIN) * TMAX) >> 1);

    delta = firstTime ? delta / DAMP : delta >> 1;
    delta += ~~(delta / numPoints);

    let k = 0;
    for (/* no initialization */; delta > x; k += BASE)
        delta = ~~(delta / (BASE - TMIN));

    return k + ~~(((BASE - TMIN + 1) * delta) / (delta + SKEW));
  }

  /**
   * Converts a Punycode string of ASCII-only symbols to a string of Unicode symbols.
   *
   * @memberof punycode
   * @param {string} input The Punycode string of ASCII-only symbols
   * @return {string} The resulting string of Unicode symbols
   */
  const decode = (input) => {
    if (typeof input !== 'string')
        throw new TypeError('\"input\" must be a string');

    if (!input)
        return '';

    let basic = input.lastIndexOf(DELIMITER_CHAR) + 1;
    var input = input.split('').map((str) => str.charCodeAt(0));
    const output = input.slice(0, basic ? (basic - 1) : 0);

    var bias = INITIAL_BIAS;
    var n = INITIAL_N;
    for (let i = 0, length = input.length; basic < length; ++i) {

      let oldi = i;
      for (let k = BASE, w = 1;/* no condition */; k += BASE) {

        if (basic >= length)
          throw new Error('invalid input');

        let digit = input[basic++];
        digit -= digit >= 0x30 && digit <= 0x39 ? 0x16 : 0; // 0..9
        digit -= digit >= 0x41 && digit <= 0x5A ? 0x41 : 0; // A..Z
        digit -= digit >= 0x61 && digit <= 0x7A ? 0x61 : 0; // a..z
        if (digit >= BASE || digit > ~~((MAX_INTEGER - i) / w))
          throw new Error('overflow detected');

        i += digit * w;

        const t = (k <= bias + TMIN ? TMIN : (k >= bias + TMAX ? TMAX : k - bias));
        if (digit < t)
          break;

        const x = BASE - t;
        if (w > ~~(MAX_INTEGER / x))
          throw new Error('overflow detected');

        w *= x;
      }

      const out = output.length + 1;
      bias = adapt(i - oldi, out, oldi === 0);
      if (~~(i / out) > (MAX_INTEGER - n))
        throw new Error('overflow detected');

      n += ~~(i / out);
      i %= out;

      output.splice(i, 0, n);
    }

    return String.fromCodePoint(...output);
  }

  /**
   * Converts a string of Unicode symbols (e.g. a domain name label) to a
   * Punycode string of ASCII-only symbols.
   *
   * @memberof punycode
   * @param {string} input The string of Unicode symbols
   * @return {string} The resulting Punycode string of ASCII-only symbols
   */
  const encode = (input) => {
    if (typeof input !== 'string')
      throw new TypeError('\"input\" must be a string');

    if (!input)
      return '';

    var input = ucs2.decode(input);
    let output = input.filter((code) => code < 0x80);
    let nonBasic = input.filter((code) => code >= 0x80);

    let basic = output.length;
    if (basic > 0)
      output.push(DELIMITER_CODE);

    let delta = 0;
    let bias = INITIAL_BIAS;
    let n = INITIAL_N;
    for (let h = basic, length = input.length; h < length; ++delta, ++n) {
      let m = 0x110000;
      nonBasic.forEach((code) => m = code >= n && code < m ? code : m);

      delta += (m - n) * (h + 1);
      n = m;
      input.forEach((c) => {
        delta += c < n ? 1 : 0;

        if (c === n) {
          for (let k = BASE, q = delta;/* no condition */; k += BASE) {
            let t = k <= bias + TMIN ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
            if (q < t) {
              output.push(q + (q < 0x1A ? 0x61 : 0x16));
              break;
            }

            let d = t + ((q - t) % (BASE - t));
            output.push(d + (d < 0x1A ? 0x61 : 0x16));

            q = ~~((q - t) / (BASE - t));
          }

          bias = adapt(delta, h + 1, h === basic);
          delta = 0;
          h += 1;
        }
      });
    }

    return String.fromCharCode(...output);
  }

  /**
   * Converts a Punycode string representing a domain name or an email address
   * to Unicode. Only the Punycoded parts of the input will be converted, i.e.
   * it doesn't matter if you call it on a string that has already been
   * converted to Unicode.
   *
   * @memberof punycode
   * @param {string} input The Punycoded domain name or email address to convert to Unicode
   * @return {string} The Unicode representation of the given Punycode string
   */
  function unicode(input) {
    if (typeof input !== 'string')
      throw new TypeError('\"input\" must be a string');

    if (!input)
      return '';

    return input.split('.').map(function (domain) {
      return /^xn--/.test(domain) ? decode(domain.substring(4).toLowerCase()) : domain;
    }).join('.');
  }

  /**
   * Converts a Unicode string representing a domain name or an email address to
   * Punycode. Only the non-ASCII parts of the domain name will be converted,
   * i.e. it doesn't matter if you call it with a domain that's already in
   * ASCII.
   *
   * @memberof punycode
   * @param {string} input The domain name or email address to convert, as a Unicode string
   * @return {string} The Punycode representation of the given domain name or email address
   */
  function ascii(input) {
    if (typeof input !== 'string')
      throw new TypeError('\"input\" must be a string');

    if (!input)
      return '';

    return input.split('.').map(function (domain) {
      return /[^\0-\x7E]/g.test(domain) ? 'xn--' /* punycode separators */ + encode(domain) : domain;
    }).join('.');
  }

  // Public API
  return { decode, encode, unicode, ascii };

}));