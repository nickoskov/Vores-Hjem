// blokvagt: Netlifys nye funktionsformat. Selve koden ligger i ../handlers/blokvagt.js.
import h from '../handlers/blokvagt.js';
import { tilV2 } from '../lib/v2.mjs';

export default tilV2(h.handler);
export const config = { schedule: '20 6 * * *' };
