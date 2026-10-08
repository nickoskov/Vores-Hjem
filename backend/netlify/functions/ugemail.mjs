// ugemail: Netlifys nye funktionsformat. Selve koden ligger uaendret i ../handlers/ugemail.js.
import h from '../handlers/ugemail.js';
import { tilV2 } from '../lib/v2.mjs';

export default tilV2(h.handler);
export const config = { schedule: '0 6 * * 1' };
