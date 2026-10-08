// hent: Netlifys nye funktionsformat. Selve koden ligger i ../handlers/hent.js.
import h from '../handlers/hent.js';
import { tilV2 } from '../lib/v2.mjs';

export default tilV2(h.handler);
export const config = { path: '/hent/*' };
