// admin: Netlifys nye funktionsformat. Selve koden ligger uaendret i ../handlers/admin.js.
import h from '../handlers/admin.js';
import { tilV2 } from '../lib/v2.mjs';

export default tilV2(h.handler);
