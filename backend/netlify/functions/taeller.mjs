// taeller: Netlifys nye funktionsformat. Selve koden ligger uaendret i ../handlers/taeller.js.
import h from '../handlers/taeller.js';
import { tilV2 } from '../lib/v2.mjs';

export default tilV2(h.handler);
