// flytnoegler: Netlifys nye funktionsformat. Selve koden ligger i ../handlers/flytnoegler.js.
import h from '../handlers/flytnoegler.js';
import { tilV2 } from '../lib/v2.mjs';

export default tilV2(h.handler);
export const config = { schedule: '*/5 * * * *' };
