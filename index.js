const { Client } = require('discord.js-selfbot-v13');
const axios = require('axios');
const fs = require('fs');

const config = JSON.parse(fs.readFileSync('./config.json', 'utf-8'));

function formatTime(ms) {
  const seconds = Math.floor(ms / 1000) % 60;
  const minutes = Math.floor(ms / (1000 * 60)) % 60;
  const hours = Math.floor(ms / (1000 * 60 * 60));
  return `${hours}h ${minutes}m ${seconds}s`;
}

function calculateNextMessageTime(delayMs) {
  const now = new Date();
  const nextTime = new Date(now.getTime() + delayMs);
  const utcOffset = 7;
  nextTime.setHours(nextTime.getUTCHours() + utcOffset);
  const hours = nextTime.getHours().toString().padStart(2, '0');
  const minutes = nextTime.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

async function logToWebhookEmbed(embedContent) {
  try {
    await axios.post(config.webhook, { embeds: [embedContent] });
    console.log(`[Webhook] Embed berhasil dikirim.`);
  } catch (error) {
    console.error(`[Webhook Error] ${error.message}`);
  }
}

function createEmbed(title, description, fields, color) {
  return {
    title: title,
    description: description,
    fields: fields,
    color: color,
    timestamp: new Date().toISOString()
  };
}

function formatMessage(messageArray) {
  if (Array.isArray(messageArray)) {
    return messageArray.join('\n');
  }
  return messageArray;
}

function getRandomDelay(minDelay, maxDelay) {
  return Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
}

async function sendMessageWithDelay(client, channel, accountConfig) {
  const randomDelay = getRandomDelay(accountConfig.mindelay, accountConfig.maxdelay);
  const formattedMessage = formatMessage(accountConfig.message);
  await channel.send(formattedMessage);
  console.log(`[${client.user.tag}] Pesan berhasil dikirim ke ${channel.name}`);
  const nextSendTime = calculateNextMessageTime(randomDelay);
  const nextSendDelay = formatTime(randomDelay);
  await logToWebhookEmbed(
    createEmbed(
      "Pesan Terkirim",
      `✅ **${client.user.tag}** berhasil mengirim pesan.`,
      [
        { name: "Server", value: channel.guild.name, inline: true },
        { name: "Channel", value: channel.name, inline: true },
        { name: "Next Message In", value: `${nextSendDelay} (${nextSendTime} WIB)`, inline: true },
        { name: "Message Content", value: formattedMessage, inline: false }
      ],
      0x00ff00
    )
  );
  setTimeout(() => {
    sendMessageWithDelay(client, channel, accountConfig);
  }, randomDelay);
}

function startAccount(accountConfig) {
  const client = new Client();

  client.on('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);
    const channel = client.channels.cache.get(accountConfig.channel);
    const guild = client.guilds.cache.get(accountConfig.guild);

    if (!channel || !guild) {
      console.error(`Guild atau Channel tidak ditemukan untuk ${client.user.tag}`);
      await logToWebhookEmbed(
        createEmbed(
          "Error: Guild atau Channel Tidak Ditemukan",
          `❌ **${client.user.tag}** gagal menemukan guild atau channel.`,
          [
            { name: "Guild ID", value: accountConfig.guild, inline: true },
            { name: "Channel ID", value: accountConfig.channel, inline: true }
          ],
          0xff0000
        )
      );
      client.destroy();
      return;
    }

    await logToWebhookEmbed(
      createEmbed(
        "Akun Berhasil Masuk",
        `✅ **${client.user.tag}** siap mengirim pesan.`,
        [
          { name: "Server", value: guild.name, inline: true },
          { name: "Channel", value: channel.name, inline: true },
          { name: "Delay Range", value: `${accountConfig.mindelay / 1000}s - ${accountConfig.maxdelay / 1000}s`, inline: true }
        ],
        0x00ff00
      )
    );
    sendMessageWithDelay(client, channel, accountConfig);
  });

  client.login(accountConfig.token).catch(async (error) => {
    console.error(`[Login Error] ${error.message}`);
    await logToWebhookEmbed(
      createEmbed(
        "Login Gagal",
        `❌ **${accountConfig.token}** gagal login.`,
        [
          { name: "Error", value: error.message, inline: false }
        ],
        0xff0000
      )
    );
  });
}

if (!config.webhook) {
  console.error("Webhook URL tidak ditemukan di config.json");
} else {
  config.accounts.forEach(account => {
    startAccount(account);
  });
}
