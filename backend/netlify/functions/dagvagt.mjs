// dagvagt: Netlifys nye funktionsformat. Selve koden ligger uaendret i ../handlers/dagvagt.js.
import h from '../handlers/dagvagt.js';
import { tilV2 } from '../lib/v2.mjs';

export default tilV2(h.handler);
export const config = { schedule: '0 7 * * *' };
