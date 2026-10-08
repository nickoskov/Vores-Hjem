// chat-bot: kun paa den tyske backend. vaerktoej/udgiv-backend.mjs --de laegger filen i netlify/functions/ og
// kopierer chatbottens kode (chatbot/netlify/functions/chat-bot.js) til ../handlers/chat-bot.js. Saa er der
// kun en bot at rette, og den danske bot (voreshjem-bot.netlify.app) er uaendret.
// Her faar botten profilens marked (side.js, chat), backendens egen database gennem db.js (med ejermaerket),
// og alarm-mailen peger paa dette panel. Widgeten (widget.js) kalder /.netlify/functions/chat-bot.
import h from '../handlers/chat-bot.js';
import db from '../lib/db.js';
import profil from '../lib/side.js';
import { tilV2 } from '../lib/v2.mjs';

h.brug({ site: profil.chat, sql: db.sql, panel: profil.backend + '/#chat' });

// en backend uden sin egen bot (side.js, botEgen), fx hvis SIDE er glemt, svarer slet ikke
export default tilV2(profil.botEgen ? h.handler : async () => ({ statusCode: 404, body: '' }));
