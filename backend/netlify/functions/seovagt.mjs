// seovagt: Netlifys nye funktionsformat. Selve koden ligger uaendret i ../handlers/seovagt.js.
import h from '../handlers/seovagt.js';
import { tilV2 } from '../lib/v2.mjs';

export default tilV2(h.handler);
export const config = { schedule: '0 5 * * 1' };
