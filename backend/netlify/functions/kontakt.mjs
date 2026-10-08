// kontakt: Netlifys nye funktionsformat. Selve koden ligger uaendret i ../handlers/kontakt.js.
import h from '../handlers/kontakt.js';
import { tilV2 } from '../lib/v2.mjs';

export default tilV2(h.handler);
