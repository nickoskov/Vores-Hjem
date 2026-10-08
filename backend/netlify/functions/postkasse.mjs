// postkasse: Netlifys nye funktionsformat. Selve koden ligger i ../handlers/postkasse.js.
// Hvert andet minut. Goer kun noget paa en backend med support-mail (den tyske, se lib/side.js).
import h from '../handlers/postkasse.js';
import { tilV2 } from '../lib/v2.mjs';

export default tilV2(h.handler);
export const config = { schedule: '*/5 * * * *' };
