import { EmbedBuilder } from 'discord.js';
import { AdminService } from '../services/admin.service';

export async function renderStats() {
    const stats = await AdminService.getStats();
    const now = Math.floor(Date.now() / 1000 - 1);

    const embed = new EmbedBuilder()
        .setDescription(`
## <a:GREEN_CROWN:1306056562435035190> **GLOBAL STATISTICS** <a:GREEN_CROWN:1306056562435035190>
\u200b
<a:arrow:1306059259615903826> Total Users      : **${stats.totalUsers.toLocaleString()}**
<a:arrow:1306059259615903826> Total Accounts   : **${stats.totalAccounts.toLocaleString()}**
<a:arrow:1306059259615903826> Active Workers   : **${stats.activeTasks.toLocaleString()}**
<a:arrow:1306059259615903826> Total Messages Sent : **${(stats.totalMessagesSent + 392).toLocaleString()}**


Last Update: <t:${now}:R>
`)
        .setColor(0x57F287) // Discord Green
        .setFooter({ text: 'AutoPost | Powered by Frey' })
        .setTimestamp()
        .setImage('https://cdn.discordapp.com/attachments/1420156741059874818/1453538221584551936/standard_1.gif?ex=6979fab5&is=6978a935&hm=91e3d4d0ed490273106ddf8b3d55562f4e450074f3afa51e28a61b18d1fe4f05&');

    return { content: null, embeds: [embed] };
}