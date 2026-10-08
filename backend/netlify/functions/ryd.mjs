// ryd: Netlifys nye funktionsformat. Selve koden ligger uaendret i ../handlers/ryd.js.
import h from '../handlers/ryd.js';
import { tilV2 } from '../lib/v2.mjs';

export default tilV2(h.handler);
export const config = { schedule: '0 3 * * *' };
