// index.js
require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  ActivityType,
} = require('discord.js');

// ===== клиент =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.GuildMember],
});

// ===== конфиг =====
const TOKEN = process.env.DISCORD_TOKEN || 'ВСТАВЬ_ТОКЕН_ЕСЛИ_БЕЗ_.ENV';
const TARGET_USER_ID = process.env.TARGET_USER_ID || 'ID_ПОЛЬЗОВАТЕЛЯ';
const CLEAN_ONLY_TARGET = true; // true — чистим только TARGET_USER_ID
const TZ = 'Europe/Riga';
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || ''; // <— ID текстового канала для журнала

if (!TOKEN || TOKEN === 'ВСТАВЬ_ТОКЕН_ЕСЛИ_БЕЗ_.ENV') {
  console.error('Нет токена. Укажи DISCORD_TOKEN в .env или вставь прямо в код.');
  process.exit(1);
}

// ===== presence (статусы) =====
const DEFAULT_PRESENCE = {
  activities: [{ name: 'за порядком', type: ActivityType.Watching }],
  status: 'online',
};
async function setCheckingPresence() {
  await client.user.setPresence({
    activities: [{ name: 'всё ли ок', type: ActivityType.Watching }],
    status: 'dnd',
  });
}
async function setDefaultPresence() {
  await client.user.setPresence(DEFAULT_PRESENCE);
}

client.once('ready', () => {
  console.log(`Залогинен как ${client.user.tag}`);
  client.user.setPresence(DEFAULT_PRESENCE);
});

// ===== утилиты времени =====
function toLocalDateStr(ts) {
  return new Date(ts).toLocaleDateString('ru-RU', { timeZone: TZ });
}
function isToday(ts) {
  const today = toLocalDateStr(Date.now());
  return toLocalDateStr(ts) === today;
}
function tsToHHMM(ts) {
  return new Date(ts).toLocaleTimeString('ru-RU', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: TZ,
  });
}

// ===== умная чистка "артур"-образного =====
function normalizeForArtur(s) {
  if (!s) return '';
  let x = s.toLowerCase();
  const map = {
    'а':'a','a':'a','@':'a',
    'р':'r','p':'r','r':'r',
    'т':'t','t':'t',
    'у':'u','y':'u','u':'u',
    'х':'h','h':'h',
    'о':'o','0':'o',
    'к':'k','k':'k',
    'и':'i','i':'i',
    'ч':'ch',
    'ь':'','ъ':'',
    'ё':'e','е':'e','e':'e',
    'й':'y',
    'я':'ya','ю':'yu','ы':'y'
  };
  x = x.replace(/./g, ch => map[ch] ?? ch);
  x = x.replace(/[\s._\\-|/\\]+/g, ''); // убираем разделители
  return x;
}
function containsArturLike(s) {
  const n = normalizeForArtur(s);
  return /arth?ur(ik|chik|chka|ka|a|u|e|y|ya|yu|om|oi)?/.test(n);
}
function countArturLike(s) {
  const A='[aа@]', R='[rрp]', T='[tт]', H='[hх]?', U='[uуy]', SEP='[\\s._\\-|/\\\\]*';
  const SUF='(?:'+SEP+'(?:ik|chik|chka|ka|a|u|e|y|ya|yu|om|oi|ик|чик|чка|ка|а|у|е|ый|ой|ом))?';
  const re = new RegExp(`${A}${SEP}${R}${SEP}${T}${SEP}${H}${U}${SEP}${R}${SUF}`, 'gi');
  const m = s.match(re);
  return m ? m.length : 0;
}
function removeArturLike(s, forChannel = false) {
  if (!s) return s;
  const A='[aа@]', R='[rрp]', T='[tт]', H='[hх]?', U='[uуy]', SEP='[\\s._\\-|/\\\\]*';
  const SUF='(?:'+SEP+'(?:ik|chik|chka|ka|a|u|e|y|ya|yu|om|oi|ик|чик|чка|ка|а|у|е|ый|ой|ом))?';
  const re = new RegExp(`${A}${SEP}${R}${SEP}${T}${SEP}${H}${U}${SEP}${R}${SUF}`, 'gi');

  let out = s.replace(re, '');

  if (forChannel) {
    out = out.replace(/\s+/g, ' ').trim();
    out = out || 'без-артура';
    out = out.replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  } else {
    out = out.replace(/\s+/g, ' ').replace(/ +([\-–—]) +/g, '$1').trim();
    out = out || 'БезАртура';
  }
  return out;
}

// ===== журналирование =====
const logs = []; // { ts, type: 'nick'|'channel', guildId, userId?, channelId?, before, after, count }

async function logToChannel(entry) {
  if (!LOG_CHANNEL_ID) return; // канал не задан — просто пропускаем
  const guild = client.guilds.cache.get(entry.guildId);
  if (!guild) return;
  const ch = guild.channels.cache.get(LOG_CHANNEL_ID) || await guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
  if (!ch || !ch.isTextBased()) return;

  const time = tsToHHMM(entry.ts);
  let text;
  if (entry.type === 'nick') {
    text =
      `🧹 **Ник очищен** [${time}]\n` +
      `Пользователь: ${entry.userId ? `<@${entry.userId}>` : '—'}\n` +
      `Было: \`${entry.before}\`\n` +
      `Стало: \`${entry.after}\`\n` +
      `Удалено фрагментов: **${entry.count}**`;
  } else {
    text =
      `🧹 **Канал очищен** [${time}]\n` +
      `Канал: ${entry.channelId ? `<#${entry.channelId}>` : '—'}\n` +
      `Было: \`${entry.before}\`\n` +
      `Стало: \`${entry.after}\`\n` +
      `Удалено фрагментов: **${entry.count}**`;
  }
  await ch.send({ content: text }).catch(() => {});
}

function pushLog(entry) {
  logs.push(entry);
  // отправляем в канал
  logToChannel(entry);
}

// ===== агрегаты за сегодня =====
function getTodayStats() {
  const todayLogs = logs.filter(l => isToday(l.ts));
  const totalRemoved = todayLogs.reduce((acc, l) => acc + (l.count || 0), 0);
  const nickOps = todayLogs.filter(l => l.type === 'nick').length;
  const chOps = todayLogs.filter(l => l.type === 'channel').length;
  return { totalRemoved, nickOps, chOps, todayLogs };
}

// ===== авто-чистка ника =====
client.on('guildMemberUpdate', async (_oldMember, newMember) => {
  try {
    if (CLEAN_ONLY_TARGET && newMember.id !== TARGET_USER_ID) return;

    const current = newMember.nickname || newMember.user.username;
    const c = countArturLike(current);
    if (!c) return;

    const cleaned = removeArturLike(current, false);
    if (cleaned && cleaned !== current) {
      await newMember.setNickname(cleaned);
      const entry = {
        ts: Date.now(),
        type: 'nick',
        guildId: newMember.guild.id,
        userId: newMember.id,
        before: current,
        after: cleaned,
        count: c,
      };
      pushLog(entry);
      console.log(`Ник: "${current}" -> "${cleaned}" (−${c})`);
    }
  } catch (err) {
    console.error('Ошибка при смене ника:', err);
  }
});

// ===== авто-чистка названий каналов =====
function cleanChannelName(name) {
  return containsArturLike(name) ? removeArturLike(name, true) : name;
}
client.on('channelCreate', async (channel) => {
  try {
    const original = channel.name;
    const c = countArturLike(original);
    if (!c) return;
    const cleaned = cleanChannelName(original);
    if (cleaned !== original) {
      await channel.setName(cleaned);
      const entry = {
        ts: Date.now(),
        type: 'channel',
        guildId: channel.guild.id,
        channelId: channel.id,
        before: original,
        after: cleaned,
        count: c,
      };
      pushLog(entry);
      console.log(`Канал создан: "${original}" -> "${cleaned}" (−${c})`);
    }
  } catch (err) {
    console.error('Ошибка при смене имени канала:', err);
  }
});
client.on('channelUpdate', async (_oldChannel, newChannel) => {
  try {
    const original = newChannel.name;
    const c = countArturLike(original);
    if (!c) return;
    const cleaned = cleanChannelName(original);
    if (cleaned !== original) {
      await newChannel.setName(cleaned);
      const entry = {
        ts: Date.now(),
        type: 'channel',
        guildId: newChannel.guild.id,
        channelId: newChannel.id,
        before: original,
        after: cleaned,
        count: c,
      };
      pushLog(entry);
      console.log(`Канал обновлён: "${original}" -> "${cleaned}" (−${c})`);
    }
  } catch (err) {
    console.error('Ошибка при смене имени канала (update):', err);
  }
});

// ===== команды =====
client.on('messageCreate', async (message) => {
  try {
    if (message.author.bot || !message.guild) return;

    const isMod = message.member.permissions.has(PermissionsBitField.Flags.ManageGuild);

    // !status
    if (message.content.trim().toLowerCase() === '!status') {
      if (!isMod) return;
      const { totalRemoved, nickOps, chOps } = getTodayStats();
      await message.reply(
        `Статистика за сегодня:\n` +
        `• Вырезано «артур»-фрагментов: **${totalRemoved}**\n` +
        `• Изменений ников: **${nickOps}**\n` +
        `• Переименований каналов: **${chOps}**`
      );
      return;
    }

    // !statusfull
    if (message.content.trim().toLowerCase() === '!statusfull') {
      if (!isMod) return;
      const { todayLogs } = getTodayStats();
      if (todayLogs.length === 0) {
        await message.reply('За сегодня ещё нет изменений.');
        return;
      }
      const MAX = 50;
      const slice = todayLogs.slice(-MAX);
      const lines = slice.map((l, i) => {
        const time = tsToHHMM(l.ts);
        if (l.type === 'nick') {
          return `${i+1}. [${time}] Ник ${l.userId ? `<@${l.userId}>` : ''}: "${l.before}" → "${l.after}" (−${l.count})`;
        } else {
          return `${i+1}. [${time}] Канал ${l.channelId ? `<#${l.channelId}>` : ''}: "${l.before}" → "${l.after}" (−${l.count})`;
        }
      });
      await message.reply(
        `Подробности за сегодня (показаны последние ${Math.min(MAX, todayLogs.length)}):\n` +
        lines.join('\n')
      );
      return;
    }

    // !cleanartur
    if (isMod && message.content.trim().toLowerCase() === '!cleanartur') {
      await setCheckingPresence();
      try {
        // 1) ники
        const members = await message.guild.members.fetch();
        for (const [, m] of members) {
          if (CLEAN_ONLY_TARGET && m.id !== TARGET_USER_ID) continue;
          const current = m.nickname || m.user.username;
          const c = countArturLike(current);
          if (!c) continue;
          const cleaned = removeArturLike(current, false);
          if (cleaned && cleaned !== current) {
            await m.setNickname(cleaned).catch(() => {});
            const entry = {
              ts: Date.now(),
              type: 'nick',
              guildId: message.guild.id,
              userId: m.id,
              before: current,
              after: cleaned,
              count: c,
            };
            pushLog(entry);
          }
        }
        // 2) каналы
        for (const [, ch] of message.guild.channels.cache) {
          const name = ch.name;
          const c = countArturLike(name);
          if (!c) continue;
          const cleaned = removeArturLike(name, true);
          if (cleaned !== name) {
            await ch.setName(cleaned).catch(() => {});
            const entry = {
              ts: Date.now(),
              type: 'channel',
              guildId: message.guild.id,
              channelId: ch.id,
              before: name,
              after: cleaned,
              count: c,
            };
            pushLog(entry);
          }
        }
        await message.reply('Готово: всё, похожее на «артур», почищено ✅');
      } catch (err) {
        console.error('Ошибка при ручной чистке:', err);
        await message.reply('Что-то пошло не так при чистке.');
      } finally {
        await setDefaultPresence();
      }
    }
  } catch (err) {
    console.error('Ошибка messageCreate:', err);
  }
});

// ===== запуск =====
client.login(TOKEN);
