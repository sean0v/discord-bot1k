// index.js
require('dotenv').config();
const express = require('express');
const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  ActivityType,
} = require('discord.js');

// ===== мини-сервер для Replit =====
const app = express();
app.get('/', (req, res) => res.send('Anti-Artur bot is alive!'));
app.listen(3000, () => console.log('✅ Сервер для пинга запущен на порту 3000'));

// ===== клиент Discord =====
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
const TOKEN = process.env.DISCORD_TOKEN;
const TARGET_USER_ID = process.env.TARGET_USER_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;
const CLEAN_ONLY_TARGET = true;
const TZ = 'Europe/Riga';
const SCAN_INTERVAL_MIN = Number(process.env.SCAN_INTERVAL_MIN || 60);

// ===== presence =====
const DEFAULT_PRESENCE = {
  activities: [{ name: 'за порядком', type: ActivityType.Watching }],
  status: 'online',
};
async function setCheckingPresence(text = 'всё ли ок', status = 'dnd') {
  await client.user.setPresence({
    activities: [{ name: text, type: ActivityType.Watching }],
    status,
  });
}
async function setDefaultPresence() {
  await client.user.setPresence(DEFAULT_PRESENCE);
}

// ===== утилиты =====
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

// ===== функции чистки =====
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
  x = x.replace(/[\s._\\-|/\\]+/g, '');
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
    out = out.replace(/\s+/g, ' ').trim() || 'без-артура';
    out = out.replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  } else {
    out = out.replace(/\s+/g, ' ').replace(/ +([\-–—]) +/g, '$1').trim() || 'БезАртура';
  }
  return out;
}

// ===== журнал =====
const logs = [];
async function logToChannel(entry) {
  if (!LOG_CHANNEL_ID) return;
  const guild = client.guilds.cache.get(entry.guildId);
  if (!guild) return;
  const ch = guild.channels.cache.get(LOG_CHANNEL_ID) || await guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
  if (!ch || !ch.isTextBased()) return;
  const time = tsToHHMM(entry.ts);
  const text = entry.type === 'nick'
    ? `🧹 **Ник очищен** [${time}]\nПользователь: <@${entry.userId}>\nБыло: \`${entry.before}\`\nСтало: \`${entry.after}\``
    : `🧹 **Канал очищен** [${time}]\nКанал: <#${entry.channelId}>\nБыло: \`${entry.before}\`\nСтало: \`${entry.after}\``;
  await ch.send({ content: text }).catch(() => {});
}
function pushLog(entry) {
  logs.push(entry);
  logToChannel(entry);
}

// ===== очистка при событиях =====
client.on('guildMemberUpdate', async (_oldMember, newMember) => {
  try {
    if (CLEAN_ONLY_TARGET && newMember.id !== TARGET_USER_ID) return;
    const current = newMember.nickname || newMember.user.username;
    const c = countArturLike(current);
    if (!c) return;
    const cleaned = removeArturLike(current, false);
    if (cleaned !== current) {
      await newMember.setNickname(cleaned);
      pushLog({ ts: Date.now(), type: 'nick', guildId: newMember.guild.id, userId: newMember.id, before: current, after: cleaned, count: c });
    }
  } catch (e) { console.error(e); }
});
client.on('channelCreate', async ch => {
  try {
    const name = ch.name;
    const c = countArturLike(name);
    if (!c) return;
    const cleaned = removeArturLike(name, true);
    if (cleaned !== name) {
      await ch.setName(cleaned);
      pushLog({ ts: Date.now(), type: 'channel', guildId: ch.guild.id, channelId: ch.id, before: name, after: cleaned, count: c });
    }
  } catch (e) { console.error(e); }
});

// ===== авто-проверка =====
async function runFullScanForGuild(guild) {
  await setCheckingPresence('плановая проверка', 'online');
  try {
    const members = await guild.members.fetch();
    for (const [, m] of members) {
      if (CLEAN_ONLY_TARGET && m.id !== TARGET_USER_ID) continue;
      const current = m.nickname || m.user.username;
      const c = countArturLike(current);
      if (!c) continue;
      const cleaned = removeArturLike(current, false);
      if (cleaned !== current) {
        await m.setNickname(cleaned).catch(() => {});
        pushLog({ ts: Date.now(), type: 'nick', guildId: guild.id, userId: m.id, before: current, after: cleaned, count: c });
      }
    }
    for (const [, ch] of guild.channels.cache) {
      const name = ch.name;
      const c = countArturLike(name);
      if (!c) continue;
      const cleaned = removeArturLike(name, true);
      if (cleaned !== name) {
        await ch.setName(cleaned).catch(() => {});
        pushLog({ ts: Date.now(), type: 'channel', guildId: guild.id, channelId: ch.id, before: name, after: cleaned, count: c });
      }
    }
  } finally {
    await setDefaultPresence();
  }
}

function scheduleHourlyScan() {
  const intervalMs = SCAN_INTERVAL_MIN * 60 * 1000;
  setInterval(async () => {
    for (const [, g] of client.guilds.cache) await runFullScanForGuild(g);
  }, intervalMs);
}

// ===== команды =====
client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;
  const isMod = message.member.permissions.has(PermissionsBitField.Flags.ManageGuild);

  if (isMod && message.content.trim().toLowerCase() === '!cleanartur') {
    await message.reply('Запускаю ручную чистку...');
    await runFullScanForGuild(message.guild);
    await message.reply('Чистка завершена ✅');
  }
});

// ===== запуск =====
client.once('ready', async () => {
  console.log(`Залогинен как ${client.user.tag}`);
  await client.user.setPresence(DEFAULT_PRESENCE);
  // сообщение о перезапуске
  try {
    if (LOG_CHANNEL_ID) {
      const logChannel = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
      if (logChannel && logChannel.isTextBased()) {
        const time = new Date().toLocaleTimeString('ru-RU', { timeZone: TZ });
        await logChannel.send(`🌀 **Бот перезапущен** (${client.user.tag})\nВремя: ${time}\nПроверка начнётся в ближайший час ⏱️`);
      }
    }
  } catch (err) { console.error('Ошибка уведомления о старте:', err); }
  scheduleHourlyScan();
});

client.login(TOKEN);
