// sorovagt: Netlifys nye funktionsformat. Selve koden ligger uaendret i ../handlers/sorovagt.js.
import h from '../handlers/sorovagt.js';
import { tilV2 } from '../lib/v2.mjs';

export default tilV2(h.handler);
export const config = { schedule: '10 * * * *' };
